import ExpenseReceiptAssistance from './ExpenseReceiptAssistance';
import { useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  CreditCard,
  Download,
  FileText,
  History,
  LoaderCircle,
  Pencil,
  ReceiptText,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { useExpenseDetail, useWorkspace } from '../store';
import { useRecordDraft, useUserDraftState, type RecordDraftMemory } from './useRecordDraft';
import type { Expense, Person } from '../types';
import { budgetUsage, formatMoney } from '../data/finance';
import { validDate } from '../data/imports';
import {
  dateLabel,
  departmentName,
  ErrorMessage,
  Field,
  Modal,
  personName,
  relativeTime,
  today,
} from './UI';
import { ExpenseStatus, financeManager, validateFinanceText } from './FinanceForms';

type Decision = 'approve' | 'reject' | 'pay' | 'void';
const paymentNames: Record<string, string> = {
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  card: 'Card',
  cash: 'Cash',
  other: 'Other',
};

export default function FinanceDetail(props: {
  expense: Expense;
  onClose: () => void;
  onEdit: (expense: Expense) => void;
  onOpenTask: (id: string) => void;
}) {
  const detail = useExpenseDetail(props.expense.id);
  const store = useWorkspace();
  const data = store.data;
  const memory = useRecordDraft(
    JSON.stringify([
      store.mode,
      store.session?.user.id,
      store.companyId,
      props.expense.id,
      data?.readBasis,
      data?.me.role,
      data?.me.departmentId,
      data?.me.managerId,
    ]),
    detail.accessRevoked || (!!data && !data.expenses.some((e) => e.id === props.expense.id)),
  );
  if (!detail.expense)
    return (
      <div role="dialog" aria-label="Expense details">
        <button onClick={props.onClose}>Close</button>
        <p role={detail.error ? 'alert' : 'status'}>{detail.error || 'Loading expense details…'}</p>
      </div>
    );
  return (
    <FinanceDetailBody
      {...props}
      memory={memory}
      expense={detail.expense}
      resolvedPeople={detail.people}
      onEdit={() => props.onEdit(detail.expense!)}
    />
  );
}
function FinanceDetailBody({
  memory,
  resolvedPeople,
  expense,
  onClose,
  onEdit,
  onOpenTask,
}: {
  memory: RecordDraftMemory;
  resolvedPeople?: Person[];
  expense: Expense;
  onClose: () => void;
  onEdit: () => void;
  onOpenTask: (id: string) => void;
}) {
  const store = useWorkspace();
  const data = {
    ...store.data!,
    people: Array.from(
      new Map([...store.data!.people, ...(resolvedPeople ?? [])].map((p) => [p.id, p])).values(),
    ),
  };
  const [error, setError] = useState('');
  const [action, setAction] = useUserDraftState<Decision | null>(memory, 'action', null);
  const [actionVersion, setActionVersion] = useUserDraftState(
    memory,
    'actionVersion',
    expense.version,
  );
  const [note, setNote] = useUserDraftState(memory, 'note', '');
  const [overrideReason, setOverrideReason] = useUserDraftState(memory, 'overrideReason', '');
  const [authoriseOverride, setAuthoriseOverride] = useUserDraftState(
    memory,
    'authoriseOverride',
    false,
  );
  const [paidDate, setPaidDate] = useUserDraftState(
    memory,
    'paidDate',
    today(data.company.timezone),
  );
  const [paymentMethod, setPaymentMethod] = useUserDraftState(
    memory,
    'paymentMethod',
    'bank_transfer',
  );
  const [paymentReference, setPaymentReference] = useUserDraftState(memory, 'paymentReference', '');
  const fileRef = useRef<HTMLInputElement>(null);
  const own = expense.createdBy === data.me.id;
  const manager = financeManager(data);
  const approver =
    !own && (manager || (data.me.role === 'head' && expense.departmentId === data.me.departmentId));
  const editable = own && ['draft', 'rejected'].includes(expense.status);
  const canUpload = own || manager;
  const canVoid =
    (own && ['draft', 'rejected', 'submitted'].includes(expense.status)) ||
    (approver && expense.status === 'approved');
  const category = data.expenseCategories.find((item) => item.id === expense.categoryId);
  const missingReceipt = !!category?.receiptRequired && expense.receipts.length === 0;
  const acknowledgeException = !!expense.receiptExceptionReason.trim();
  const exceptionRecorded = Array.from(expense.receiptExceptionReason.trim()).length >= 12;
  const budget = data.budgets.find(
    (item) =>
      item.departmentId === expense.departmentId &&
      item.startDate <= expense.expenseDate &&
      item.endDate >= expense.expenseDate,
  );
  const usage = budget ? budgetUsage(budget, data.expenses) : undefined;
  const needsOverride =
    !budget || budget.status !== 'active' || (usage?.availableMinor ?? 0) < expense.amountMinor;
  const remainingAfterApproval =
    (budget?.status !== 'draft' ? (usage?.availableMinor ?? 0) : 0) - expense.amountMinor;
  const approvalBlocked = needsOverride && !manager;
  const changedDuringAction = !!action && actionVersion !== expense.version;
  const events = data.financeEvents
    .filter((event) => event.entityId === expense.id)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const task = data.tasks.find((item) => item.id === expense.taskId);
  const project = data.projects.find((item) => item.id === expense.projectId);

  function begin(decision: Decision) {
    setAction(decision);
    setActionVersion(expense.version);
    setNote('');
    setOverrideReason('');
    setAuthoriseOverride(false);
    setPaymentReference('');
    setPaidDate(today(data.company.timezone));
    setError('');
  }
  async function transition(next: string, fields: Record<string, unknown> = {}) {
    setError('');
    try {
      await store.mutate(`/expenses/${expense.id}/transition`, {
        version: expense.version,
        action: next,
        ...fields,
      });
      setAction(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update this expense.');
    }
  }
  async function decide(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      if (!action) return;
      if (changedDuringAction)
        throw new Error(
          'This expense changed. Review the latest details before starting this decision again.',
        );
      validateFinanceText(note, 'Decision note', 4000);
      validateFinanceText(overrideReason, 'Budget override reason', 4000);
      validateFinanceText(paymentReference, 'Payment reference', 240);
      if (
        (action === 'reject' ||
          action === 'void' ||
          (action === 'approve' && acknowledgeException)) &&
        Array.from(note.trim()).length < 12
      )
        throw new Error('Explain this decision in at least 12 characters.');
      if (action === 'approve' && needsOverride) {
        if (!manager)
          throw new Error('A company finance authority must approve this budget exception.');
        if (!authoriseOverride || Array.from(overrideReason.trim()).length < 12)
          throw new Error(
            'Explicitly authorise the budget override and explain it in at least 12 characters.',
          );
      }
      if (action === 'pay') {
        if (
          !validDate(paidDate) ||
          paidDate < expense.expenseDate ||
          paidDate > today(data.company.timezone)
        )
          throw new Error('Use a payment date between the expense date and today.');
        if (!paymentReference.trim())
          throw new Error('Enter the reference for the external payment.');
      }
      await store.mutate(`/expenses/${expense.id}/transition`, {
        version: actionVersion,
        action,
        note: note.trim(),
        ...(action === 'approve' && needsOverride ? { overrideReason: overrideReason.trim() } : {}),
        ...(action === 'pay'
          ? { paidDate, paymentMethod, paymentReference: paymentReference.trim() }
          : {}),
      });
      setAction(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record this decision.');
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={expense.title}
      description={`${expense.code} · Created by ${personName(data, expense.createdBy)} · Version ${expense.version}`}
    >
      <div className="finance-detail">
        <ErrorMessage error={error} />
        <div className="finance-detail-total">
          <div>
            <span>EXPENSE AMOUNT · {expense.currency}</span>
            <strong>{formatMoney(expense.amountMinor, expense.currency)}</strong>
          </div>
          <ExpenseStatus status={expense.status} />
        </div>
        <dl className="finance-facts">
          <div>
            <dt>Vendor / payee</dt>
            <dd>{expense.vendor || 'Not entered'}</dd>
          </div>
          <div>
            <dt>Expense date</dt>
            <dd>
              {dateLabel(expense.expenseDate, { day: 'numeric', month: 'short', year: 'numeric' })}
            </dd>
          </div>
          <div>
            <dt>Department</dt>
            <dd>{departmentName(data, expense.departmentId)}</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>
              <span
                className="finance-category-dot"
                style={{ background: category?.color || '#7e8b9c' }}
              />
              {category?.name || 'Unavailable category'}
            </dd>
          </div>
          <div>
            <dt>Invoice / bill number</dt>
            <dd>{expense.invoiceNumber || 'Not supplied'}</dd>
          </div>
          <div>
            <dt>Submitted by</dt>
            <dd>{personName(data, expense.createdBy)}</dd>
          </div>
        </dl>
        {expense.description && (
          <div className="finance-detail-description">
            <h3>Business purpose</h3>
            <p>{expense.description}</p>
          </div>
        )}
        {(project || task) && (
          <div className="finance-linked-work">
            {project && (
              <span>
                <FileText size={14} />
                {project.name}
              </span>
            )}
            {task && (
              <button
                className="text-button"
                onClick={() => {
                  onClose();
                  onOpenTask(task.id);
                }}
              >
                Open {task.code}
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        )}

        {expense.status === 'rejected' && expense.reviewNote && (
          <div className="finance-notice finance-notice-warning">
            <CircleAlert size={18} />
            <div>
              <strong>Changes requested by {personName(data, expense.reviewedBy)}</strong>
              <p>{expense.reviewNote}</p>
              <p>The creator can edit this expense and submit it again.</p>
            </div>
          </div>
        )}
        {expense.receiptExceptionReason && (
          <div className="finance-notice finance-notice-warning">
            <ReceiptText size={18} />
            <div>
              <strong>Recorded receipt exception</strong>
              <p>{expense.receiptExceptionReason}</p>
              {acknowledgeException && (
                <p>
                  An independent reviewer must explicitly acknowledge this exception in their
                  approval note.
                </p>
              )}
            </div>
          </div>
        )}
        {!action && (
          <div className="finance-detail-actions">
            {editable && (
              <button className="button button-secondary" disabled={store.saving} onClick={onEdit}>
                <Pencil size={15} />
                Edit expense
              </button>
            )}
            {editable && (
              <button
                className="button button-primary"
                disabled={store.saving || (missingReceipt && !exceptionRecorded)}
                onClick={() => transition('submit')}
              >
                <ShieldCheck size={15} />
                Submit for approval
              </button>
            )}
            {own && expense.status === 'submitted' && (
              <button
                className="button button-secondary"
                disabled={store.saving}
                onClick={() => transition('withdraw')}
              >
                Withdraw to draft
              </button>
            )}
            {approver && expense.status === 'submitted' && (
              <>
                <button
                  className="button button-primary"
                  disabled={store.saving}
                  onClick={() => begin('approve')}
                >
                  <ShieldCheck size={15} />
                  Review & approve
                </button>
                <button
                  className="button button-secondary"
                  disabled={store.saving}
                  onClick={() => begin('reject')}
                >
                  Request changes
                </button>
              </>
            )}
            {manager && !own && expense.status === 'approved' && (
              <button
                className="button button-primary"
                disabled={store.saving}
                onClick={() => begin('pay')}
              >
                <CreditCard size={15} />
                Record payment
              </button>
            )}
            {canVoid && (
              <button
                className="text-button finance-danger-button"
                disabled={store.saving}
                onClick={() => begin('void')}
              >
                Void expense
              </button>
            )}
          </div>
        )}
        {editable && missingReceipt && !exceptionRecorded && !action && (
          <p className="finance-action-hint">
            <ReceiptText size={15} />
            Attach a receipt, or edit the expense to record why it is unavailable, before
            submitting.
          </p>
        )}
        {own && ['submitted', 'approved'].includes(expense.status) && !action && (
          <p className="finance-action-hint">
            <ShieldCheck size={15} />
            Another authorised person must approve your expense and record its payment.
          </p>
        )}
        {expense.status === 'void' && (
          <div className="finance-notice">
            <X size={18} />
            <p>This expense is void. It stays in the history and does not use budget.</p>
          </div>
        )}

        {action && (
          <form className="finance-decision-form finance-form" onSubmit={decide}>
            <div className="finance-decision-heading">
              <div>
                <span className="eyebrow">INDEPENDENT FINANCIAL CONTROL</span>
                <h3>
                  {action === 'approve'
                    ? 'Review expense for approval'
                    : action === 'pay'
                      ? 'Record an external payment'
                      : action === 'reject'
                        ? 'Request expense changes'
                        : 'Void this expense'}
                </h3>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Cancel decision"
                onClick={() => setAction(null)}
              >
                <X size={17} />
              </button>
            </div>
            {changedDuringAction && (
              <div className="finance-notice finance-notice-warning">
                <CircleAlert size={18} />
                <div>
                  <strong>This expense changed while you were reviewing it.</strong>
                  <p>Review the latest details, then start the decision again.</p>
                  <button type="button" className="text-button" onClick={() => setAction(null)}>
                    Review latest version
                  </button>
                </div>
              </div>
            )}
            <div className="finance-decision-summary">
              <strong>{formatMoney(expense.amountMinor, expense.currency)}</strong>
              <span>
                {expense.vendor} · {category?.name || 'Unavailable category'}
              </span>
            </div>
            {action === 'approve' && (
              <>
                <div className="finance-budget-impact">
                  <h4>Budget impact</h4>
                  <p>
                    {budget
                      ? `${budget.name} · ${dateLabel(budget.startDate)} – ${dateLabel(budget.endDate)} · ${budget.status}`
                      : 'No department budget covers this expense date.'}
                  </p>
                  <div>
                    <span>Available before approval</span>
                    <strong>
                      {formatMoney(
                        budget?.status !== 'draft' ? (usage?.availableMinor ?? 0) : 0,
                        expense.currency,
                      )}
                    </strong>
                  </div>
                  <div className={remainingAfterApproval < 0 ? 'finance-negative' : ''}>
                    <span>Available after approval</span>
                    <strong>{formatMoney(remainingAfterApproval, expense.currency)}</strong>
                  </div>
                  <small>
                    Other pending requests do not reserve funds. Approval rechecks the current
                    budget.
                  </small>
                </div>
                {needsOverride && (
                  <div className="finance-notice finance-notice-warning">
                    <CircleAlert size={18} />
                    <div>
                      <strong>
                        {!budget || budget.status === 'draft'
                          ? 'No active allocation'
                          : budget.status === 'closed'
                            ? 'This budget is closed'
                            : 'This approval exceeds the available budget'}
                      </strong>
                      <p>
                        {manager
                          ? 'An explicit budget override and reason are required to proceed.'
                          : 'A founder, CEO, company admin or finance colleague must decide this exception.'}
                      </p>
                    </div>
                  </div>
                )}
                {needsOverride && manager && (
                  <>
                    <label className="check-field finance-check-field">
                      <input
                        required
                        type="checkbox"
                        checked={authoriseOverride}
                        onChange={(event) => setAuthoriseOverride(event.target.checked)}
                      />
                      Authorise this budget override
                    </label>
                    <Field
                      label="Budget override reason"
                      hint="At least 12 characters. The exception remains in the finance history."
                    >
                      <textarea
                        required
                        minLength={12}
                        rows={3}
                        maxLength={4000 * 2}
                        value={overrideReason}
                        onChange={(event) => setOverrideReason(event.target.value)}
                      />
                    </Field>
                  </>
                )}
                {missingReceipt && (
                  <div className="finance-notice finance-notice-warning">
                    <ReceiptText size={18} />
                    <div>
                      <strong>No supporting receipt is attached</strong>
                      <p>
                        {expense.receiptExceptionReason ||
                          'A receipt exception has not been recorded.'}
                      </p>
                      <p>Your approval note must explain why this exception is accepted.</p>
                    </div>
                  </div>
                )}
                <Field
                  label="Approval note"
                  hint={
                    acknowledgeException
                      ? 'Required: acknowledge the receipt exception in at least 12 characters.'
                      : 'Optional context for the approval record.'
                  }
                >
                  <textarea
                    rows={3}
                    required={acknowledgeException}
                    minLength={acknowledgeException ? 12 : undefined}
                    maxLength={4000 * 2}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </Field>
              </>
            )}
            {action === 'pay' && (
              <>
                <p className="finance-form-hint">
                  Record a payment that has already been made outside this workspace. This action
                  does not transfer money. The expense moves from approved to paid without using the
                  budget twice.
                </p>
                <div className="form-grid">
                  <Field label="Payment date">
                    <input
                      type="date"
                      required
                      min={expense.expenseDate}
                      max={today(data.company.timezone)}
                      value={paidDate}
                      onChange={(event) => setPaidDate(event.target.value)}
                    />
                  </Field>
                  <Field label="Payment method">
                    <select
                      value={paymentMethod}
                      onChange={(event) => setPaymentMethod(event.target.value)}
                    >
                      {Object.entries(paymentNames).map(([value, name]) => (
                        <option key={value} value={value}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field
                  label="Payment reference"
                  hint="Use a transaction reference, bank reference or cash voucher number."
                >
                  <input
                    required
                    maxLength={240 * 2}
                    value={paymentReference}
                    onChange={(event) => setPaymentReference(event.target.value)}
                    placeholder="External payment reference"
                  />
                </Field>
              </>
            )}
            {(action === 'reject' || action === 'void') && (
              <>
                <p className="finance-form-hint">
                  {action === 'reject'
                    ? 'Explain what the creator needs to correct before resubmitting.'
                    : expense.status === 'approved'
                      ? 'Voiding releases this commitment from the budget. The expense stays in the audit history and cannot be restored.'
                      : 'The expense stays in the audit history and cannot be restored.'}
                </p>
                <Field
                  label={action === 'reject' ? 'Changes required' : 'Reason for voiding'}
                  hint="Explain the decision in at least 12 characters."
                >
                  <textarea
                    required
                    minLength={12}
                    rows={3}
                    maxLength={4000 * 2}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </Field>
              </>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setAction(null)}
              >
                Cancel
              </button>
              <button
                className={`button ${action === 'void' ? 'finance-button-danger' : 'button-primary'}`}
                disabled={
                  store.saving ||
                  changedDuringAction ||
                  (action === 'approve' &&
                    (approvalBlocked || (missingReceipt && !exceptionRecorded)))
                }
                type="submit"
              >
                {store.saving ? (
                  <LoaderCircle size={15} className="spin" />
                ) : action === 'pay' ? (
                  <CreditCard size={15} />
                ) : action === 'void' ? (
                  <X size={15} />
                ) : (
                  <Check size={15} />
                )}
                {action === 'approve'
                  ? 'Approve expense'
                  : action === 'pay'
                    ? 'Confirm payment record'
                    : action === 'reject'
                      ? 'Request changes'
                      : 'Confirm void'}
              </button>
            </div>
          </form>
        )}

        {expense.reviewedBy && ['approved', 'paid'].includes(expense.status) && (
          <section className="finance-record-section">
            <div className="finance-inline-heading">
              <ShieldCheck size={18} />
              <h3>Approval record</h3>
            </div>
            <p>
              Approved by <strong>{personName(data, expense.reviewedBy)}</strong>
              {expense.reviewedAt ? ` · ${relativeTime(expense.reviewedAt)}` : ''}
            </p>
            {expense.reviewNote && <p className="finance-preserve-lines">{expense.reviewNote}</p>}
            {expense.budgetOverrideReason && (
              <div className="finance-notice finance-notice-warning">
                <CircleAlert size={17} />
                <div>
                  <strong>Budget override recorded</strong>
                  <p>{expense.budgetOverrideReason}</p>
                </div>
              </div>
            )}
          </section>
        )}
        {expense.status === 'paid' && (
          <section className="finance-record-section finance-paid-record">
            <div className="finance-inline-heading">
              <CreditCard size={18} />
              <h3>Recorded payment</h3>
            </div>
            <dl className="finance-facts">
              <div>
                <dt>Payment date</dt>
                <dd>
                  {dateLabel(expense.paidDate, { day: 'numeric', month: 'short', year: 'numeric' })}
                </dd>
              </div>
              <div>
                <dt>Method</dt>
                <dd>{paymentNames[expense.paymentMethod] || expense.paymentMethod}</dd>
              </div>
              <div>
                <dt>Reference</dt>
                <dd>{expense.paymentReference}</dd>
              </div>
              <div>
                <dt>Recorded by</dt>
                <dd>{personName(data, expense.paidBy)}</dd>
              </div>
            </dl>
            <p className="finance-form-hint">
              This is an internal record of an external payment. It has not been reconciled with a
              bank statement.
            </p>
          </section>
        )}

        <section className="finance-record-section">
          <div className="finance-inline-heading finance-receipts-heading">
            <ReceiptText size={18} />
            <h3>Receipts & evidence</h3>
            <span>{expense.receipts.length}</span>
            {canUpload && (
              <button
                className="button button-secondary"
                disabled={store.saving}
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={14} />
                Attach receipt
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv"
            aria-label="Upload expense receipt"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              setError('');
              try {
                if (file.size > 10 * 1024 * 1024)
                  throw new Error('Choose a receipt no larger than 10 MiB.');
                await store.uploadExpenseReceipt(expense.id, file);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Unable to attach this receipt.');
              }
            }}
          />
          {expense.receipts.length ? (
            <div className="finance-receipt-list">
              {expense.receipts.map((receipt) => (
                <div key={receipt.id}>
                  <div className="finance-receipt-row">
                    <span className="finance-file-icon">
                      <FileText size={20} />
                    </span>
                    <div>
                      <strong>{receipt.fileName}</strong>
                      <span>
                        {Math.max(1, Math.ceil(receipt.size / 1024))} KB ·{' '}
                        {personName(data, receipt.uploadedBy)} · {relativeTime(receipt.createdAt)}
                      </span>
                    </div>
                    <button
                      className="icon-button bordered"
                      aria-label={`Download ${receipt.fileName}`}
                      onClick={async () => {
                        setError('');
                        try {
                          await store.downloadExpenseReceipt(receipt);
                        } catch (err) {
                          setError(
                            err instanceof Error ? err.message : 'Unable to download this receipt.',
                          );
                        }
                      }}
                    >
                      <Download size={16} />
                    </button>
                  </div>
                  <ExpenseReceiptAssistance expense={expense} receiptId={receipt.id} />
                </div>
              ))}
            </div>
          ) : (
            <div className="finance-empty-receipts">
              <ReceiptText size={24} />
              <p>No receipts attached.</p>
              <span>
                {category?.receiptRequired
                  ? 'This category requires a receipt or a recorded exception before submission.'
                  : 'Attach supporting evidence when available.'}
              </span>
            </div>
          )}
          {canUpload && (
            <p className="finance-form-hint">
              PDF, PNG, JPG, WebP, TXT or CSV · up to 10 MiB each. Receipts are added to the history
              and cannot be replaced.
            </p>
          )}
        </section>

        <section className="finance-record-section">
          <div className="finance-inline-heading">
            <History size={18} />
            <h3>Expense history</h3>
          </div>
          <div className="finance-history">
            {events.map((event) => (
              <article key={event.id}>
                <span className="finance-history-icon">
                  <Clock3 size={13} />
                </span>
                <div>
                  <strong>
                    {event.action
                      .replace(/[_-]/g, ' ')
                      .replace(/^./, (character) => character.toUpperCase())}
                  </strong>
                  <p>{event.detail}</p>
                  <span>
                    {personName(data, event.userId)} ·{' '}
                    <time dateTime={event.createdAt} title={event.createdAt}>
                      {relativeTime(event.createdAt)}
                    </time>
                  </span>
                </div>
              </article>
            ))}
            {!events.length && (
              <p className="finance-form-hint">
                No events for this expense are present in the recent history.
              </p>
            )}
          </div>
          <p className="finance-history-limit">
            This view uses the latest 1,000 finance events available in your access scope. Earlier
            records remain in saved finance history.
          </p>
        </section>
      </div>
    </Modal>
  );
}
