import { useExecutionMutation } from '../data/execution';
import { useExecutionInput } from '../data/executionInput';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, CircleAlert, Pencil, Plus, ReceiptText, ShieldCheck, Tags } from 'lucide-react';
import { useWorkspace } from '../store';
import type { Budget, Expense, ExpenseCategory, WorkspaceData } from '../types';
import { fiscalYearRange, fiscalYearStart, formatMoney, parseMoney } from '../data/finance';
import { validDate } from '../data/imports';
import { departmentName, EmptyState, ErrorMessage, Field, Modal, SaveButton, today } from './UI';

export const expenseStatusLabels: Record<Expense['status'], string> = {
  draft: 'Draft',
  submitted: 'Awaiting approval',
  approved: 'Approved · unpaid',
  paid: 'Paid',
  rejected: 'Changes requested',
  void: 'Void',
};

export function financeManager(data: WorkspaceData) {
  return ['founder', 'ceo', 'admin', 'finance'].includes(data.me.role);
}

// HTML maxLength counts UTF-16 code units. Doubled browser caps allow every valid
// Unicode character; these checks enforce the same character limits as the API.
export function validateFinanceText(value: string, label: string, maximum: number) {
  if (Array.from(value.trim()).length > maximum)
    throw new Error(`${label} must contain at most ${maximum} characters.`);
}

export function ExpenseStatus({ status }: { status: Expense['status'] }) {
  return (
    <span className={`finance-status finance-status-${status}`}>
      <span aria-hidden="true" />
      {expenseStatusLabels[status]}
    </span>
  );
}

type ExpenseDraft = {
  title: string;
  description: string;
  vendor: string;
  invoiceNumber: string;
  departmentId: string;
  categoryId: string;
  expenseDate: string;
  amount: string;
  projectId: string;
  taskId: string;
  receiptExceptionReason: string;
};

export function ExpenseForm({
  item,
  initialDepartment = '',
  onClose,
  onSaved,
}: {
  item?: Expense;
  initialDepartment?: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const store = useWorkspace();
  const data = store.data!;
  const departments = data.departments.filter(
    (department) => financeManager(data) || department.id === data.me.departmentId,
  );
  const makeDraft = (expense?: Expense): ExpenseDraft => ({
    title: expense?.title || '',
    description: expense?.description || '',
    vendor: expense?.vendor || '',
    invoiceNumber: expense?.invoiceNumber || '',
    departmentId:
      expense?.departmentId ||
      (departments.some((department) => department.id === initialDepartment)
        ? initialDepartment
        : departments.some((department) => department.id === data.me.departmentId)
          ? data.me.departmentId
          : departments[0]?.id || ''),
    categoryId:
      expense?.categoryId || data.expenseCategories.find((category) => category.active)?.id || '',
    expenseDate: expense?.expenseDate || today(data.company.timezone),
    amount: expense ? (expense.amountMinor / 100).toFixed(2) : '',
    projectId: expense?.projectId || '',
    taskId: expense?.taskId || '',
    receiptExceptionReason: expense?.receiptExceptionReason || '',
  });
  const formId = '$finance-draft:' + (item?.id ?? 'new');
  const [draft, setDraft] = useExecutionInput<ExpenseDraft>(formId, 'draft', () => makeDraft(item));
  const create = useExecutionMutation(formId);
  const [version, setVersion] = useState(item?.version || 0);
  const [error, setError] = useState('');
  const [reloadRequested, setReloadRequested] = useState(false);
  const latest = item ? data.expenses.find((expense) => expense.id === item.id) : undefined;
  const stale = !!latest && latest.version !== version;
  useEffect(() => {
    if (!reloadRequested || !latest) return;
    setDraft(makeDraft(latest));
    setVersion(latest.version);
    setError('');
    setReloadRequested(false);
  }, [reloadRequested, latest]);
  const set = <K extends keyof ExpenseDraft>(key: K, value: ExpenseDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const category = data.expenseCategories.find((entry) => entry.id === draft.categoryId);
  const projects = data.projects.filter((project) => project.departmentId === draft.departmentId);
  const tasks = data.tasks.filter(
    (task) =>
      task.departmentId === draft.departmentId &&
      (!draft.projectId || task.projectId === draft.projectId),
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      if (stale) throw new Error('This expense changed. Load the latest version before saving.');
      if (!draft.title.trim() || !draft.vendor.trim())
        throw new Error('Add an expense title and vendor or payee.');
      validateFinanceText(draft.title, 'Expense title', 240);
      validateFinanceText(draft.vendor, 'Vendor / payee', 240);
      validateFinanceText(draft.invoiceNumber, 'Invoice / bill number', 160);
      validateFinanceText(draft.description, 'Business purpose / details', 8000);
      validateFinanceText(draft.receiptExceptionReason, 'Receipt exception reason', 4000);
      if (!departments.some((department) => department.id === draft.departmentId))
        throw new Error('Choose a department in your finance scope.');
      if (!category?.active) throw new Error('Choose an active expense category.');
      if (!validDate(draft.expenseDate) || draft.expenseDate > today(data.company.timezone))
        throw new Error('Choose a valid expense date on or before today.');
      const amountMinor = parseMoney(draft.amount);
      if (amountMinor <= 0 || amountMinor > 1_000_000_000_000)
        throw new Error('Enter a positive amount of up to 10,000,000,000.00.');
      if (
        draft.receiptExceptionReason.trim() &&
        Array.from(draft.receiptExceptionReason.trim()).length < 12
      )
        throw new Error('Explain the receipt exception in at least 12 characters.');
      const { amount: _amount, ...input } = draft;
      const result = await (item ? store.mutate : create.execute)(
        item ? `/expenses/${item.id}` : '/expenses',
        {
          ...input,
          title: draft.title.trim(),
          vendor: draft.vendor.trim(),
          amountMinor,
          ...(item ? { version } : {}),
        },
        item ? 'PATCH' : 'POST',
      );
      onSaved(item?.id || String(result.id ?? ''));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this expense.');
    }
  }
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={item ? 'Edit expense' : 'New expense'}
      description={`Record the business purpose and exact amount in ${data.company.currency}. Save a draft before attaching receipts and submitting it.`}
    >
      <form className="entity-form finance-form" onSubmit={submit}>
        <ErrorMessage error={error} />
        {create.attempt && !item && (
          <p role="alert">
            Result unknown. Retry the same frozen draft, or reconcile the company ledger before
            abandoning it. Prior work may already exist.
          </p>
        )}
        <fieldset
          disabled={(!item && !!create.attempt) || create.busy}
          style={{ border: 0, padding: 0, minWidth: 0 }}
        >
          {(stale || error.toLowerCase().includes('changed')) && item && (
            <div className="finance-notice finance-notice-warning">
              <CircleAlert size={18} />
              <div>
                <strong>Review the latest version</strong>
                <p>Loading it replaces the edits in this form.</p>
                <button
                  className="text-button"
                  type="button"
                  onClick={async () => {
                    try {
                      await store.refresh();
                      setReloadRequested(true);
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : 'Unable to refresh this expense.',
                      );
                    }
                  }}
                >
                  Load latest version
                </button>
              </div>
            </div>
          )}
          <Field label="Expense title">
            <input
              required
              maxLength={240 * 2}
              value={draft.title}
              onChange={(event) => set('title', event.target.value)}
              placeholder="What was this expense for?"
              autoFocus
            />
          </Field>
          <div className="form-grid">
            <Field label="Vendor / payee">
              <input
                required
                maxLength={240 * 2}
                value={draft.vendor}
                onChange={(event) => set('vendor', event.target.value)}
                placeholder="Supplier or person paid"
              />
            </Field>
            <Field
              label="Invoice / bill number"
              hint="Leave blank if no invoice number was issued."
            >
              <input
                maxLength={160 * 2}
                value={draft.invoiceNumber}
                onChange={(event) => set('invoiceNumber', event.target.value)}
                placeholder="e.g. INV-1048"
              />
            </Field>
            <Field
              label={`Amount (${data.company.currency})`}
              hint="Use up to two decimal places; include the full expense amount."
            >
              <input
                required
                inputMode="decimal"
                maxLength={24}
                value={draft.amount}
                onChange={(event) => set('amount', event.target.value)}
                placeholder="0.00"
              />
            </Field>
            <Field label="Expense date" hint="This date determines the budget period.">
              <input
                required
                type="date"
                max={today(data.company.timezone)}
                value={draft.expenseDate}
                onChange={(event) => set('expenseDate', event.target.value)}
              />
            </Field>
            <Field label="Expense department">
              <select
                required
                value={draft.departmentId}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    departmentId: event.target.value,
                    projectId: '',
                    taskId: '',
                  }))
                }
              >
                {!departments.length && <option value="">No eligible department</option>}
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Expense category">
              <select
                required
                value={draft.categoryId}
                onChange={(event) => set('categoryId', event.target.value)}
              >
                {!data.expenseCategories.some((entry) => entry.active) && (
                  <option value="">No active categories</option>
                )}
                {data.expenseCategories
                  .filter((entry) => entry.active || entry.id === draft.categoryId)
                  .map((entry) => (
                    <option key={entry.id} value={entry.id} disabled={!entry.active}>
                      {entry.name}
                      {entry.active ? '' : ' (inactive)'}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <Field label="Business purpose / details">
            <textarea
              rows={3}
              maxLength={8000 * 2}
              value={draft.description}
              onChange={(event) => set('description', event.target.value)}
              placeholder="Add context an independent reviewer will need."
            />
          </Field>
          <div className="form-grid">
            <Field label="Related project (optional)">
              <select
                value={draft.projectId}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, projectId: event.target.value, taskId: '' }))
                }
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Related task (optional)"
              hint="Only accessible work in this department is listed."
            >
              <select
                value={draft.taskId}
                onChange={(event) => {
                  const task = tasks.find((entry) => entry.id === event.target.value);
                  setDraft((current) => ({
                    ...current,
                    taskId: event.target.value,
                    projectId: task
                      ? projects.some((project) => project.id === task.projectId)
                        ? task.projectId
                        : ''
                      : current.projectId,
                  }));
                }}
              >
                <option value="">No task</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.code} · {task.title}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {(category?.receiptRequired || draft.receiptExceptionReason) && (
            <div className="finance-receipt-guidance">
              <div className="finance-inline-heading">
                <ReceiptText size={18} />
                <h3>Supporting receipt</h3>
              </div>
              <p>
                {item?.receipts.length
                  ? `${item.receipts.length} receipt(s) already attached.`
                  : 'Save this draft, then attach a receipt in the expense details.'}{' '}
                A missing receipt needs a recorded exception and an explicit approval note.
              </p>
              <Field
                label="Receipt exception reason (optional)"
                hint="Use only when a receipt cannot be supplied. Explain why in at least 12 characters."
              >
                <textarea
                  rows={2}
                  maxLength={4000 * 2}
                  value={draft.receiptExceptionReason}
                  onChange={(event) => set('receiptExceptionReason', event.target.value)}
                  placeholder="Why is the receipt unavailable?"
                />
              </Field>
            </div>
          )}
        </fieldset>
        <div className="form-actions">
          <span>Drafts do not reserve budget.</span>
          <button className="button button-secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <SaveButton saving={store.saving}>
            {item ? 'Save changes' : create.attempt ? 'Retry same draft' : 'Save draft'}
          </SaveButton>
        </div>
      </form>
    </Modal>
  );
}

export function BudgetForm({
  item,
  initialDepartment = '',
  year,
  onClose,
}: {
  item?: Budget;
  initialDepartment?: string;
  year: number;
  onClose: () => void;
}) {
  const store = useWorkspace();
  const data = store.data!;
  const range = fiscalYearRange(year, data.company.fiscalYearStartMonth);
  const initial = {
    departmentId: item?.departmentId || initialDepartment || data.departments[0]?.id || '',
    name: item?.name || '',
    amount: item ? (item.amountMinor / 100).toFixed(2) : '',
    startDate: item?.startDate || range.startDate,
    endDate: item?.endDate || range.endDate,
    status: item?.status || 'active',
    notes: item?.notes || '',
    reason: '',
  };
  const [values, setValues] = useState(initial);
  const [error, setError] = useState('');
  const lockedPeriod = !!item && item.status !== 'draft';
  let amountChanged = false;
  try {
    amountChanged = !!item && parseMoney(values.amount) !== item.amountMinor;
  } catch {
    // The amount field supplies the validation message when the form is submitted.
  }
  const reasonRequired =
    !!item && item.status !== 'draft' && (amountChanged || values.status !== item.status);
  const current = item ? data.budgets.find((budget) => budget.id === item.id) : undefined;
  const stale = !!current && current.version !== item?.version;
  const set = (key: keyof typeof initial, value: string) =>
    setValues((prior) => ({ ...prior, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      if (stale)
        throw new Error('This budget changed. Close and reopen it to review the latest version.');
      if (!values.name.trim()) throw new Error('Give this budget a clear name.');
      validateFinanceText(values.name, 'Budget name', 160);
      validateFinanceText(values.notes, 'Budget notes', 4000);
      validateFinanceText(values.reason, 'Reason for budget change', 4000);
      const amountMinor = parseMoney(values.amount);
      if (amountMinor < 0 || amountMinor > 1_000_000_000_000)
        throw new Error('Enter a budget from 0 to 10,000,000,000.00.');
      if (
        !validDate(values.startDate) ||
        !validDate(values.endDate) ||
        values.startDate > values.endDate
      )
        throw new Error('Choose a valid start and end date.');
      if (
        fiscalYearStart(values.startDate, data.company.fiscalYearStartMonth) !==
        fiscalYearStart(values.endDate, data.company.fiscalYearStartMonth)
      )
        throw new Error('A budget period must fit within one company financial year.');
      if (reasonRequired && Array.from(values.reason.trim()).length < 12)
        throw new Error('Explain the budget change in at least 12 characters.');
      const { amount: _amount, ...input } = values;
      await store.mutate(
        item ? `/budgets/${item.id}` : '/budgets',
        {
          ...input,
          name: values.name.trim(),
          amountMinor,
          ...(item ? { version: item.version } : {}),
        },
        item ? 'PATCH' : 'POST',
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this budget.');
    }
  }
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={item ? 'Edit department budget' : 'Set department budget'}
      description="Give a department a clear spending envelope for a period within one financial year."
    >
      <form onSubmit={submit} className="entity-form finance-form">
        <ErrorMessage
          error={
            error ||
            (stale ? 'This budget changed. Close and reopen it to review the latest version.' : '')
          }
        />
        <Field label="Budget name">
          <input
            required
            maxLength={160 * 2}
            autoFocus
            value={values.name}
            onChange={(event) => set('name', event.target.value)}
            placeholder={`FY ${year} · Department operating budget`}
          />
        </Field>
        <div className="form-grid">
          <Field
            label="Budget department"
            hint={lockedPeriod ? 'Department is fixed after activation.' : undefined}
          >
            <select
              required
              disabled={lockedPeriod}
              value={values.departmentId}
              onChange={(event) => set('departmentId', event.target.value)}
            >
              {!data.departments.length && <option value="">Add a department first</option>}
              {data.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={`Budget amount (${data.company.currency})`}
            hint="Active and closed budgets contribute to the allocation total."
          >
            <input
              required
              inputMode="decimal"
              maxLength={24}
              value={values.amount}
              onChange={(event) => set('amount', event.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Budget starts">
            <input
              required
              type="date"
              disabled={lockedPeriod}
              value={values.startDate}
              onChange={(event) => set('startDate', event.target.value)}
            />
          </Field>
          <Field label="Budget ends">
            <input
              required
              type="date"
              disabled={lockedPeriod}
              value={values.endDate}
              onChange={(event) => set('endDate', event.target.value)}
            />
          </Field>
        </div>
        <Field label="Budget status">
          <select value={values.status} onChange={(event) => set('status', event.target.value)}>
            {(!item || item.status === 'draft') && (
              <option value="draft">Draft — not yet allocated</option>
            )}
            <option value="active">Active — available for approvals</option>
            {item && item.status !== 'draft' && (
              <option value="closed">
                Closed — history retained; new approvals need an override
              </option>
            )}
          </select>
        </Field>
        <Field label="Budget notes">
          <textarea
            rows={3}
            maxLength={4000 * 2}
            value={values.notes}
            onChange={(event) => set('notes', event.target.value)}
            placeholder="What does this budget cover?"
          />
        </Field>
        {reasonRequired && (
          <Field
            label="Reason for budget change"
            hint="At least 12 characters. This explanation is preserved in finance history."
          >
            <textarea
              required
              minLength={12}
              rows={3}
              maxLength={4000 * 2}
              value={values.reason}
              onChange={(event) => set('reason', event.target.value)}
            />
          </Field>
        )}
        <div className="finance-notice">
          <ShieldCheck size={18} />
          <p>
            {lockedPeriod
              ? 'The period and department stay fixed after activation. '
              : 'Budget periods for the same department cannot overlap. '}
            Approved expenses and recorded payments use the same allocation once; pending requests
            stay separate.
          </p>
        </div>
        <div className="form-actions">
          <span>
            {item
              ? `Current allocation: ${formatMoney(item.amountMinor, item.currency)}`
              : departmentName(data, values.departmentId)}
          </span>
          <button type="button" className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <SaveButton saving={store.saving}>{item ? 'Save budget' : 'Create budget'}</SaveButton>
        </div>
      </form>
    </Modal>
  );
}

export function CategoryManager({ onClose }: { onClose: () => void }) {
  const store = useWorkspace();
  const data = store.data!;
  const [editing, setEditing] = useState<ExpenseCategory | 'new' | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#d48a4f');
  const [active, setActive] = useState(true);
  const [receiptRequired, setReceiptRequired] = useState(true);
  const [error, setError] = useState('');
  function edit(category: ExpenseCategory | 'new') {
    setEditing(category);
    setName(category === 'new' ? '' : category.name);
    setColor(category === 'new' ? '#d48a4f' : category.color);
    setActive(category === 'new' || category.active);
    setReceiptRequired(category === 'new' || category.receiptRequired);
    setError('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      if (!name.trim()) throw new Error('Enter a category name.');
      validateFinanceText(name, 'Category name', 120);
      const item = editing && editing !== 'new' ? editing : undefined;
      await store.mutate(
        item ? `/expense-categories/${item.id}` : '/expense-categories',
        {
          name: name.trim(),
          color,
          active,
          receiptRequired,
          ...(item ? { version: item.version } : {}),
        },
        item ? 'PATCH' : 'POST',
      );
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this category.');
    }
  }
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Expense categories"
      description="Keep spending consistently categorised and make supporting-receipt requirements clear."
    >
      <div className="entity-form finance-form">
        <ErrorMessage error={error} />
        {editing ? (
          <form onSubmit={submit}>
            <button
              type="button"
              className="back-button"
              onClick={() => {
                setEditing(null);
                setError('');
              }}
            >
              <ArrowLeft size={15} />
              All categories
            </button>
            <Field label="Category name">
              <input
                required
                autoFocus
                maxLength={120 * 2}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Freight & logistics"
              />
            </Field>
            <Field label="Category colour">
              <input
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="finance-color-input"
              />
            </Field>
            <label className="check-field finance-check-field">
              <input
                type="checkbox"
                checked={receiptRequired}
                onChange={(event) => setReceiptRequired(event.target.checked)}
              />
              Require a receipt or a recorded receipt exception
            </label>
            <label className="check-field finance-check-field">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
              />
              Available for new expenses
            </label>
            <p className="finance-form-hint">
              Inactive categories remain attached to historical expenses.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <SaveButton saving={store.saving}>
                {editing === 'new' ? 'Create category' : 'Save category'}
              </SaveButton>
            </div>
          </form>
        ) : (
          <>
            <div className="finance-inline-heading finance-category-heading">
              <Tags size={18} />
              <h3>{data.expenseCategories.length} categories</h3>
              <button className="button button-primary" onClick={() => edit('new')}>
                <Plus size={15} />
                New category
              </button>
            </div>
            <div className="finance-category-manager">
              {data.expenseCategories
                .slice()
                .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
                .map((category) => (
                  <div className="finance-category-management-row" key={category.id}>
                    <span className="finance-category-dot" style={{ background: category.color }} />
                    <div>
                      <strong>{category.name}</strong>
                      <span>
                        {category.receiptRequired
                          ? 'Receipt or exception required'
                          : 'Receipt optional'}{' '}
                        · {category.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <button
                      className="icon-button bordered"
                      aria-label={`Edit ${category.name} category`}
                      onClick={() => edit(category)}
                    >
                      <Pencil size={15} />
                    </button>
                  </div>
                ))}
              {!data.expenseCategories.length && (
                <EmptyState
                  icon={<Tags size={25} />}
                  title="Create your first expense category"
                  description="Categories make department spending easy to compare and review."
                />
              )}
            </div>
            <div className="finance-notice">
              <ReceiptText size={18} />
              <p>
                Changing a receipt requirement applies to future submissions. Existing financial
                history is retained.
              </p>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
