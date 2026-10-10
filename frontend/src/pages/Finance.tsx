import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Clock3,
  Download,
  History,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
  Tags,
  Wallet,
} from 'lucide-react';
import { useWorkspace } from '../store';
import type { Budget, Expense, WorkspaceData } from '../types';
import {
  budgetUsage,
  financeSummary,
  fiscalYearRange,
  fiscalYearStart,
  formatMoney,
} from '../data/finance';
import {
  cx,
  dateLabel,
  departmentName,
  downloadText,
  EmptyState,
  personName,
  relativeTime,
  today,
} from '../components/UI';
import {
  BudgetForm,
  CategoryManager,
  ExpenseForm,
  ExpenseStatus,
  expenseStatusLabels,
  financeManager,
} from '../components/FinanceForms';
import FinanceDetail from '../components/FinanceDetail';
import './Finance.css';

function fiscalLabel(year: number, startMonth: number) {
  return startMonth === 1 ? `FY ${year}` : `FY ${year}–${String(year + 1).slice(-2)}`;
}

function AmountBar({
  allocated,
  approved,
  paid,
  label,
}: {
  allocated: number;
  approved: number;
  paid: number;
  label: string;
}) {
  const used = approved + paid;
  const denominator = Math.max(allocated, used, 1);
  return (
    <div className="finance-amount-bar" role="img" aria-label={label}>
      <span className="finance-bar-paid" style={{ width: `${(paid / denominator) * 100}%` }} />
      <span
        className="finance-bar-approved"
        style={{ width: `${(approved / denominator) * 100}%` }}
      />
    </div>
  );
}

function exportExpenses(expenses: Expense[], data: WorkspaceData) {
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [
    [
      'Expense code',
      'Title',
      'Vendor / payee',
      'Invoice / bill number',
      'Department',
      'Category',
      'Expense date',
      'Currency',
      'Amount',
      'Status',
      'Created by',
      'Project',
      'Task',
      'Payment date',
      'Payment method',
      'Payment reference',
      'Business purpose',
      'Receipt exception',
      'Approval note',
      'Budget override reason',
    ],
    ...expenses.map((expense) => [
      expense.code,
      expense.title,
      expense.vendor,
      expense.invoiceNumber,
      departmentName(data, expense.departmentId),
      data.expenseCategories.find((category) => category.id === expense.categoryId)?.name || '',
      expense.expenseDate,
      expense.currency,
      (expense.amountMinor / 100).toFixed(2),
      expenseStatusLabels[expense.status],
      personName(data, expense.createdBy),
      data.projects.find((project) => project.id === expense.projectId)?.name || '',
      data.tasks.find((task) => task.id === expense.taskId)?.code || '',
      expense.paidDate,
      expense.paymentMethod,
      expense.paymentReference,
      expense.description,
      expense.receiptExceptionReason,
      expense.reviewNote,
      expense.budgetOverrideReason,
    ]),
  ]
    .map((row) => row.map(cell).join(','))
    .join('\r\n');
}

export function FinancePage({
  initialExpenseId = '',
  onOpenTask,
}: {
  initialExpenseId?: string;
  onOpenTask: (id: string) => void;
}) {
  const store = useWorkspace();
  const data = store.data!;
  const date = today(data.company.timezone);
  const startMonth = data.company.fiscalYearStartMonth;
  const currentYear = fiscalYearStart(date, startMonth);
  const [year, setYear] = useState(currentYear);
  const [departmentId, setDepartmentId] = useState(
    data.financeScope === 'department' ? data.me.departmentId : '',
  );
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('');
  const [creatorId, setCreatorId] = useState('');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState(initialExpenseId);
  const [editingExpense, setEditingExpense] = useState<Expense | 'new' | null>(null);
  const [editingBudget, setEditingBudget] = useState<Budget | 'new' | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [headPersonal, setHeadPersonal] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(20);
  const previousScope = useRef(
    `${data.company.id}/${data.me.id}/${data.financeScope}/${data.me.departmentId}`,
  );
  const initialHandled = useRef('');
  const ledgerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const scope = `${data.company.id}/${data.me.id}/${data.financeScope}/${data.me.departmentId}`;
    if (previousScope.current === scope) return;
    previousScope.current = scope;
    setYear(currentYear);
    setDepartmentId(data.financeScope === 'department' ? data.me.departmentId : '');
    setCategoryId('');
    setStatus('');
    setSearch('');
    setProjectId('');
    setCreatorId('');
    setSelectedId('');
    setEditingExpense(null);
    setEditingBudget(null);
    setCategoriesOpen(false);
    setHeadPersonal(false);
    initialHandled.current = '';
  }, [data.company.id, data.me.id, currentYear, data.financeScope, data.me.departmentId]);
  useEffect(() => {
    if (!initialExpenseId || initialHandled.current === `${data.company.id}/${initialExpenseId}`)
      return;
    initialHandled.current = `${data.company.id}/${initialExpenseId}`;
    if (data.expenses.some((expense) => expense.id === initialExpenseId))
      setSelectedId(initialExpenseId);
    else store.notify('This expense is no longer available in your current finance scope.');
  }, [initialExpenseId, data.company.id, data.expenses]);
  useEffect(() => {
    setPage(0);
  }, [year, departmentId, categoryId, status, search, projectId, creatorId, headPersonal]);

  const manager = financeManager(data);
  const canManageDepartments = ['founder', 'ceo', 'admin'].includes(data.me.role);
  const personal =
    data.financeScope === 'personal' || (data.financeScope === 'department' && headPersonal);
  const completeScope =
    data.financeScope === 'company' || (data.financeScope === 'department' && !headPersonal);
  const reportData: WorkspaceData = personal
    ? {
        ...data,
        financeScope: 'personal',
        budgets: [],
        expenses: data.expenses.filter((expense) => expense.createdBy === data.me.id),
      }
    : data;
  const currency = data.company.currency;
  const range = fiscalYearRange(year, startMonth);
  const summary = financeSummary(
    reportData,
    range.startDate,
    range.endDate,
    personal ? '' : departmentId,
  );
  const departments = data.departments.filter(
    (department) => data.financeScope === 'company' || department.id === data.me.departmentId,
  );
  const selectedDepartment = personal
    ? undefined
    : departments.find((department) => department.id === departmentId);
  const periodExpenses = reportData.expenses.filter(
    (expense) =>
      expense.expenseDate >= range.startDate &&
      expense.expenseDate <= range.endDate &&
      (personal || !departmentId || expense.departmentId === departmentId),
  );
  const years = [
    ...new Set([
      currentYear - 1,
      currentYear,
      currentYear + 1,
      ...data.budgets.map((budget) => fiscalYearStart(budget.startDate, startMonth)),
      ...data.expenses.map((expense) => fiscalYearStart(expense.expenseDate, startMonth)),
    ]),
  ].sort((a, b) => b - a);
  const periodBudgets = data.budgets.filter(
    (budget) =>
      budget.startDate >= range.startDate &&
      budget.endDate <= range.endDate &&
      (!departmentId || budget.departmentId === departmentId),
  );
  const text = search.trim().toLowerCase();
  const filtered = periodExpenses
    .filter(
      (expense) =>
        (!categoryId || expense.categoryId === categoryId) &&
        (!status || expense.status === status) &&
        (!projectId || expense.projectId === projectId) &&
        (!creatorId || expense.createdBy === creatorId) &&
        (!text ||
          `${expense.title} ${expense.code} ${expense.vendor} ${expense.invoiceNumber} ${expense.description}`
            .toLowerCase()
            .includes(text)),
    )
    .sort(
      (a, b) =>
        b.expenseDate.localeCompare(a.expenseDate) || b.createdAt.localeCompare(a.createdAt),
    );
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25));
  const activePage = Math.min(page, pageCount - 1);
  const displayed = filtered.slice(activePage * 25, activePage * 25 + 25);
  const selected = data.expenses.find((expense) => expense.id === selectedId);
  const history = data.financeEvents
    .filter(
      (event) =>
        !departmentId ||
        event.departmentId === departmentId ||
        (!event.departmentId && data.financeScope === 'company'),
    )
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const categoryTotals = data.expenseCategories
    .map((category) => {
      const work = periodExpenses.filter((expense) => expense.categoryId === category.id);
      return {
        category,
        amount: work
          .filter((expense) => ['approved', 'paid'].includes(expense.status))
          .reduce((sum, expense) => sum + expense.amountMinor, 0),
      };
    })
    .filter((entry) => entry.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const categoryTotal = categoryTotals.reduce((sum, entry) => sum + entry.amount, 0);
  const categoryMax = Math.max(1, ...categoryTotals.map((entry) => entry.amount));
  const pendingCount = periodExpenses.filter((expense) => expense.status === 'submitted').length;
  const allowedDepartments = data.departments.filter(
    (department) => manager || department.id === data.me.departmentId,
  );
  const canCreate =
    data.me.role !== 'viewer' &&
    allowedDepartments.length > 0 &&
    data.expenseCategories.some((category) => category.active);
  const ledgerFiltered = !!(categoryId || status || search || projectId || creatorId);
  function focusLedger() {
    ledgerRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  function clearLedgerFilters() {
    setCategoryId('');
    setStatus('');
    setSearch('');
    setProjectId('');
    setCreatorId('');
  }
  function viewDepartment(id: string) {
    setDepartmentId(id);
    clearLedgerFilters();
  }
  const totals = [
    {
      name: 'Allocated budget',
      value: summary.allocatedMinor,
      detail: 'Active and closed envelopes',
      className: '',
    },
    {
      name: 'Pending approval',
      value: summary.pendingMinor,
      detail: 'Submitted · not yet reserved',
      className: 'finance-stat-pending',
    },
    {
      name: 'Approved · unpaid',
      value: summary.approvedMinor,
      detail: 'Committed, awaiting payment',
      className: 'finance-stat-approved',
    },
    {
      name: 'Recorded paid',
      value: summary.paidMinor,
      detail: 'External payments recorded',
      className: 'finance-stat-paid',
    },
    {
      name: 'Available budget',
      value: summary.availableMinor,
      detail: 'Allocated − approved − paid',
      className: summary.availableMinor < 0 ? 'finance-stat-negative' : 'finance-stat-available',
    },
  ];

  if (data.financeScope === 'none')
    return (
      <div className="page-content finance-page">
        <section className="panel">
          <EmptyState
            icon={<ShieldCheck size={26} />}
            title="Finance access is restricted"
            description="Your current role does not include financial records. A company administrator can review your access."
          />
        </section>
      </div>
    );

  return (
    <div className="page-content finance-page">
      <div className="finance-toolbar">
        <div className="finance-period-control">
          <span className="finance-period-icon">
            <CalendarDays size={20} />
          </span>
          <div>
            <label htmlFor="finance-year">FINANCIAL YEAR</label>
            <select
              id="finance-year"
              aria-label="Financial year"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
            >
              {years.map((value) => (
                <option key={value} value={value}>
                  {fiscalLabel(value, startMonth)}
                </option>
              ))}
            </select>
          </div>
          <span className="finance-period-dates">
            {dateLabel(range.startDate, { day: 'numeric', month: 'short', year: 'numeric' })}
            <span>to</span>
            {dateLabel(range.endDate, { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>
        <div className="finance-toolbar-actions">
          {manager && (
            <button className="button button-secondary" onClick={() => setCategoriesOpen(true)}>
              <Tags size={15} />
              <span>Manage categories</span>
            </button>
          )}
          {manager && (
            <button
              className="button button-secondary"
              disabled={!data.departments.length}
              onClick={() => setEditingBudget('new')}
            >
              <Wallet size={15} />
              Set budget
            </button>
          )}
          <button
            className="button button-primary"
            disabled={!canCreate}
            onClick={() => setEditingExpense('new')}
          >
            <Plus size={16} />
            New expense
          </button>
        </div>
      </div>

      {data.financeScope === 'department' && (
        <div
          className="segmented finance-perspective"
          role="group"
          aria-label="Finance perspective"
        >
          <button
            aria-pressed={!headPersonal}
            className={!headPersonal ? 'active' : ''}
            onClick={() => {
              setHeadPersonal(false);
              clearLedgerFilters();
            }}
          >
            <Building2 size={15} />
            Department finances
          </button>
          <button
            aria-pressed={headPersonal}
            className={headPersonal ? 'active' : ''}
            onClick={() => {
              setHeadPersonal(true);
              clearLedgerFilters();
            }}
          >
            <ReceiptText size={15} />
            My expenses
          </button>
        </div>
      )}

      {!canCreate && (
        <div className="finance-notice finance-notice-warning">
          <CircleAlert size={18} />
          <div>
            <strong>
              {!allowedDepartments.length
                ? 'A department is needed before recording expenses'
                : 'An active expense category is needed'}
            </strong>
            <p>
              {!allowedDepartments.length
                ? canManageDepartments
                  ? 'Add a department in People, then set its budget and record expenses.'
                  : 'Ask a company administrator to assign a department before recording expenses.'
                : manager
                  ? 'Open Manage categories to create or activate a category.'
                  : 'Ask your company administrator or finance colleague to activate an expense category.'}
            </p>
            {canManageDepartments && !allowedDepartments.length && (
              <a className="text-button" href="#people">
                Open People & departments
                <ArrowRight size={14} />
              </a>
            )}
          </div>
        </div>
      )}

      {personal ? (
        <>
          <section className="finance-personal-intro">
            <div>
              <span className="eyebrow">YOUR FINANCIAL WORKSPACE</span>
              <h2>Your expenses</h2>
              <p>
                Track your drafts, approval decisions and recorded payments for{' '}
                {fiscalLabel(year, startMonth)}.
              </p>
            </div>
            <ReceiptText size={31} />
          </section>
          <dl className="finance-personal-summary">
            {totals.slice(1, 4).map((entry) => (
              <div key={entry.name}>
                <dt>{entry.name}</dt>
                <dd>{formatMoney(entry.value, currency)}</dd>
                <span>{entry.detail}</span>
              </div>
            ))}
          </dl>
          <p className="finance-scope-caption">
            <ShieldCheck size={14} />
            Only your own expense records are included. Department budget balances are available to
            authorised department and company reviewers.
          </p>
        </>
      ) : (
        <>
          {data.financeScope === 'department' && (
            <p className="finance-scope-caption">
              <ShieldCheck size={14} />
              Department view · {departmentName(data, data.me.departmentId)}. Your own expenses are
              also available.
            </p>
          )}
          {data.financeScope === 'company' && departmentId && (
            <div className="finance-department-context">
              <button className="back-button" onClick={() => viewDepartment('')}>
                <ArrowLeft size={15} />
                All departments
              </button>
              <span className="finance-scope-caption">
                <Building2 size={14} />
                {selectedDepartment?.name} · {fiscalLabel(year, startMonth)}
              </span>
            </div>
          )}
          <section className="finance-summary" aria-label="Financial year totals">
            {totals.map((entry) => (
              <div className={`finance-stat ${entry.className}`} key={entry.name}>
                <span>{entry.name}</span>
                <strong>{formatMoney(entry.value, currency)}</strong>
                <small>{entry.detail}</small>
              </div>
            ))}
          </section>
          <div className="finance-summary-footnote">
            <span>All amounts in {currency} · attributed by expense date</span>
            <span>
              <i className="finance-legend-dot finance-legend-paid" />
              Paid
              <i className="finance-legend-dot finance-legend-approved" />
              Approved, unpaid
            </span>
          </div>
          {(summary.availableMinor < 0 ||
            summary.unbudgetedMinor > 0 ||
            summary.exposureMinor > summary.allocatedMinor) && (
            <div className="finance-notice finance-notice-warning">
              <CircleAlert size={19} />
              <div>
                <strong>
                  {summary.availableMinor < 0
                    ? `${formatMoney(-summary.availableMinor, currency)} over allocated budget`
                    : summary.unbudgetedMinor > 0
                      ? `${formatMoney(summary.unbudgetedMinor, currency)} recorded outside a budget envelope`
                      : 'Pending requests exceed the remaining allocation'}
                </strong>
                <p>
                  {summary.unbudgetedMinor > 0
                    ? 'Some approved or paid expenses have no matching non-draft department budget. Review their dates and recorded budget exceptions.'
                    : `Approved, paid and pending expenses total ${formatMoney(summary.exposureMinor, currency)}. Pending requests do not reserve money until approved.`}
                </p>
              </div>
            </div>
          )}
        </>
      )}

      <div className={cx('finance-planning-grid', personal && 'finance-planning-personal')}>
        {completeScope && (
          <section className="panel finance-departments-panel" aria-label="Department budgets">
            <div className="section-header">
              <div>
                <h2>
                  {selectedDepartment ? `${selectedDepartment.name} budgets` : 'Department budgets'}
                </h2>
                <p>
                  {selectedDepartment
                    ? 'Budget envelopes and their actual commitments.'
                    : 'Where resources are allocated, committed and available.'}
                </p>
              </div>
              <Building2 size={20} />
            </div>
            {selectedDepartment ? (
              <div className="finance-budget-list">
                {periodBudgets.map((budget) => {
                  const usage = budgetUsage(budget, data.expenses);
                  return (
                    <article className="finance-budget-card" key={budget.id}>
                      <div className="finance-budget-card-heading">
                        <div>
                          <h3>{budget.name}</h3>
                          <p>
                            {dateLabel(budget.startDate)} – {dateLabel(budget.endDate)}
                          </p>
                        </div>
                        <span
                          className={`finance-budget-state finance-budget-state-${budget.status}`}
                        >
                          {budget.status}
                        </span>
                        {manager && (
                          <button
                            className="icon-button bordered"
                            aria-label={`Edit ${budget.name} budget`}
                            onClick={() => setEditingBudget(budget)}
                          >
                            <Pencil size={15} />
                          </button>
                        )}
                      </div>
                      <div className="finance-budget-values">
                        <div>
                          <span>Allocated</span>
                          <strong>{formatMoney(budget.amountMinor, currency)}</strong>
                        </div>
                        <div>
                          <span>Approved + paid</span>
                          <strong>{formatMoney(usage.usedMinor, currency)}</strong>
                        </div>
                        <div className={usage.availableMinor < 0 ? 'finance-negative' : ''}>
                          <span>Available</span>
                          <strong>
                            {budget.status === 'draft'
                              ? 'Not active'
                              : formatMoney(usage.availableMinor, currency)}
                          </strong>
                        </div>
                      </div>
                      <AmountBar
                        allocated={budget.status === 'draft' ? 0 : budget.amountMinor}
                        approved={usage.approvedMinor}
                        paid={usage.paidMinor}
                        label={`${formatMoney(usage.usedMinor, currency)} used against ${formatMoney(budget.amountMinor, currency)} budget`}
                      />
                      <div className="finance-budget-card-note">
                        <span>{formatMoney(usage.pendingMinor, currency)} pending approval</span>
                        <span>
                          {budget.status === 'draft'
                            ? 'Draft excluded from allocation totals'
                            : budget.status === 'closed'
                              ? 'New approvals need a recorded override'
                              : 'Approvals reserve available budget'}
                        </span>
                      </div>
                      {budget.notes && <p className="finance-budget-notes">{budget.notes}</p>}
                    </article>
                  );
                })}
                {!periodBudgets.length && (
                  <EmptyState
                    icon={<Wallet size={25} />}
                    title="No budget for this financial year"
                    description={
                      manager
                        ? 'Set a budget envelope before this department starts approving expenses.'
                        : 'Ask company finance to allocate a budget for this period.'
                    }
                    action={
                      manager ? (
                        <button
                          className="button button-secondary"
                          onClick={() => setEditingBudget('new')}
                        >
                          <Plus size={15} />
                          Create department budget
                        </button>
                      ) : undefined
                    }
                  />
                )}
                {manager && periodBudgets.length > 0 && (
                  <button className="finance-add-envelope" onClick={() => setEditingBudget('new')}>
                    <Plus size={15} />
                    Add a non-overlapping budget period
                  </button>
                )}
              </div>
            ) : (
              <div className="finance-department-list">
                <div className="finance-department-list-labels">
                  <span>DEPARTMENT</span>
                  <span>ALLOCATED / USED</span>
                  <span>AVAILABLE</span>
                </div>
                {departments.map((department) => {
                  const row = financeSummary(data, range.startDate, range.endDate, department.id);
                  const envelopes = periodBudgets.filter(
                    (budget) => budget.departmentId === department.id,
                  );
                  const nonDraft = envelopes.filter((budget) => budget.status !== 'draft');
                  const allClosed =
                    nonDraft.length > 0 && nonDraft.every((budget) => budget.status === 'closed');
                  return (
                    <button
                      className="finance-department-row"
                      key={department.id}
                      aria-label={`View ${department.name} finances`}
                      onClick={() => viewDepartment(department.id)}
                    >
                      <div className="finance-department-name">
                        <span
                          className="finance-department-mark"
                          style={{ background: `${department.color}18`, color: department.color }}
                        >
                          <Building2 size={18} />
                        </span>
                        <div>
                          <strong>{department.name}</strong>
                          <span>
                            {!envelopes.length
                              ? 'No budget set'
                              : !nonDraft.length
                                ? 'Draft budget only'
                                : allClosed
                                  ? 'Budget closed'
                                  : row.availableMinor < 0
                                    ? 'Over budget'
                                    : `${envelopes.length} budget ${envelopes.length === 1 ? 'period' : 'periods'}`}
                          </span>
                        </div>
                      </div>
                      <div className="finance-department-usage">
                        <div>
                          <strong>{formatMoney(row.allocatedMinor, currency)}</strong>
                          <span>{formatMoney(row.usedMinor, currency)} used</span>
                        </div>
                        <AmountBar
                          allocated={row.allocatedMinor}
                          approved={row.approvedMinor}
                          paid={row.paidMinor}
                          label={`${department.name}: ${formatMoney(row.usedMinor, currency)} used of ${formatMoney(row.allocatedMinor, currency)} allocated`}
                        />
                      </div>
                      <div
                        className={cx(
                          'finance-department-available',
                          row.availableMinor < 0 && 'finance-negative',
                        )}
                      >
                        <strong>
                          {nonDraft.length ? formatMoney(row.availableMinor, currency) : '—'}
                        </strong>
                        <span>
                          {row.pendingMinor
                            ? `${formatMoney(row.pendingMinor, currency)} pending`
                            : 'No pending requests'}
                        </span>
                      </div>
                      <ChevronRight size={16} />
                    </button>
                  );
                })}
                {!departments.length && (
                  <EmptyState
                    icon={<Building2 size={25} />}
                    title="Give your budgets a department"
                    description={
                      canManageDepartments
                        ? 'Add your first department, then allocate its resources here.'
                        : 'Ask a company administrator to add a department, then allocate its resources here.'
                    }
                    action={
                      canManageDepartments ? (
                        <a className="button button-secondary" href="#people">
                          Add a department
                          <ArrowRight size={15} />
                        </a>
                      ) : undefined
                    }
                  />
                )}
              </div>
            )}
          </section>
        )}

        <section className="panel finance-categories-panel">
          <div className="section-header">
            <div>
              <h2>{personal ? 'Your spending by category' : 'Spending by category'}</h2>
              <p>
                Approved + paid ·{' '}
                {selectedDepartment?.name ||
                  (personal
                    ? 'your expenses'
                    : data.financeScope === 'department'
                      ? departmentName(data, data.me.departmentId)
                      : 'all departments')}
              </p>
            </div>
            <Tags size={20} />
          </div>
          {categoryTotals.length ? (
            <>
              <div className="finance-category-total">
                <strong>{formatMoney(categoryTotal, currency)}</strong>
                <span>committed and recorded paid</span>
              </div>
              <div className="finance-category-bars">
                {categoryTotals.map(({ category, amount }) => (
                  <button
                    key={category.id}
                    aria-label={`Filter expenses by ${category.name}`}
                    className={categoryId === category.id ? 'active' : ''}
                    onClick={() => {
                      setCategoryId(category.id);
                      setStatus('');
                      focusLedger();
                    }}
                  >
                    <div>
                      <span>
                        <i
                          className="finance-category-dot"
                          style={{ background: category.color }}
                        />
                        {category.name}
                      </span>
                      <strong>{formatMoney(amount, currency)}</strong>
                    </div>
                    <div className="finance-category-bar">
                      <span
                        style={{
                          width: `${(amount / categoryMax) * 100}%`,
                          background: category.color,
                        }}
                      />
                    </div>
                  </button>
                ))}
              </div>
              <p className="finance-category-caption">
                The same expenses are grouped here by category. These amounts are already included
                in department usage.
              </p>
            </>
          ) : (
            <EmptyState
              icon={<ReceiptText size={25} />}
              title="No approved spending yet"
              description="Category totals appear when an expense is approved or recorded paid in this financial year."
            />
          )}
        </section>
      </div>

      {pendingCount > 0 && (
        <div className="finance-review-callout">
          <span>
            <ShieldCheck size={18} />
            <strong>
              {pendingCount} {pendingCount === 1 ? 'expense awaits' : 'expenses await'} approval
            </strong>
            <span>{formatMoney(summary.pendingMinor, currency)} requested</span>
          </span>
          <button
            className="text-button"
            onClick={() => {
              clearLedgerFilters();
              setStatus('submitted');
              focusLedger();
            }}
          >
            {personal ? 'View requests' : 'Review requests'}
            <ArrowRight size={16} />
          </button>
        </div>
      )}

      <section ref={ledgerRef} className="panel finance-ledger" aria-label="Expense ledger">
        <div className="section-header">
          <div>
            <h2>Expense ledger</h2>
            <p>
              {periodExpenses.length} {periodExpenses.length === 1 ? 'expense' : 'expenses'} in{' '}
              {fiscalLabel(year, startMonth)}
              {selectedDepartment ? ` · ${selectedDepartment.name}` : ''}
            </p>
          </div>
          <button
            className="button button-secondary"
            disabled={!filtered.length}
            onClick={() => {
              downloadText(
                `schach-expenses-${range.startDate}-to-${range.endDate}.csv`,
                exportExpenses(filtered, data),
              );
              store.notify(`Exported ${filtered.length} expenses matching the current filters.`);
            }}
          >
            <Download size={15} />
            Export expenses
          </button>
        </div>
        <div className="finance-ledger-filters" role="group" aria-label="Expense filters">
          <div className="search-input">
            <Search size={16} />
            <input
              aria-label="Search expenses"
              placeholder="Search title, vendor or invoice…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {data.financeScope === 'company' && (
            <select
              aria-label="Filter expenses by department"
              value={departmentId}
              onChange={(event) => viewDepartment(event.target.value)}
            >
              <option value="">All departments</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="Filter expenses by category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">All categories</option>
            {data.expenseCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter expenses by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {Object.entries(expenseStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter expenses by project"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">All projects</option>
            {data.projects
              .filter(
                (project) => personal || !departmentId || project.departmentId === departmentId,
              )
              .map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
          </select>
          {!personal && (
            <select
              aria-label="Filter expenses by creator"
              value={creatorId}
              onChange={(event) => setCreatorId(event.target.value)}
            >
              <option value="">All creators</option>
              {data.people
                .filter((person) =>
                  periodExpenses.some((expense) => expense.createdBy === person.id),
                )
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
            </select>
          )}
          {ledgerFiltered && (
            <button className="text-button" onClick={clearLedgerFilters}>
              Clear expense filters
            </button>
          )}
        </div>
        {displayed.length ? (
          <>
            <div className="table-scroll finance-ledger-scroll">
              <table className="finance-ledger-table" aria-label="Expenses">
                <thead>
                  <tr>
                    <th>Expense</th>
                    <th>Department / category</th>
                    <th>Expense date</th>
                    <th className="finance-money-column">Amount</th>
                    <th>Status</th>
                    <th>Created by</th>
                    <th>
                      <span className="finance-visually-hidden">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((expense) => {
                    const category = data.expenseCategories.find(
                      (entry) => entry.id === expense.categoryId,
                    );
                    return (
                      <tr key={expense.id}>
                        <td>
                          <button
                            className="finance-expense-link"
                            onClick={() => setSelectedId(expense.id)}
                          >
                            <strong>{expense.title}</strong>
                            <span>
                              {expense.code} · {expense.vendor}
                            </span>
                            {expense.invoiceNumber && <small>{expense.invoiceNumber}</small>}
                          </button>
                        </td>
                        <td>
                          <div className="finance-ledger-category">
                            <strong>{departmentName(data, expense.departmentId)}</strong>
                            <span>
                              <i
                                className="finance-category-dot"
                                style={{ background: category?.color || '#7e8b9c' }}
                              />
                              {category?.name || 'Unavailable category'}
                            </span>
                          </div>
                        </td>
                        <td className="finance-date-column">
                          {dateLabel(expense.expenseDate, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="finance-money-column">
                          <strong>{formatMoney(expense.amountMinor, expense.currency)}</strong>
                          {expense.receiptExceptionReason && !expense.receipts.length && (
                            <span className="finance-receipt-exception">
                              <CircleAlert size={12} />
                              Receipt exception
                            </span>
                          )}
                        </td>
                        <td>
                          <ExpenseStatus status={expense.status} />
                        </td>
                        <td>{personName(data, expense.createdBy)}</td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`Open ${expense.code} expense`}
                            onClick={() => setSelectedId(expense.id)}
                          >
                            <ArrowUpRight size={17} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="finance-ledger-footer">
              <span>
                {activePage * 25 + 1}–{Math.min((activePage + 1) * 25, filtered.length)} of{' '}
                {filtered.length} expenses{ledgerFiltered ? ' matching filters' : ''}
              </span>
              <div>
                <button
                  className="icon-button bordered"
                  aria-label="Previous expense page"
                  disabled={activePage === 0}
                  onClick={() => setPage(activePage - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  Page {activePage + 1} of {pageCount}
                </span>
                <button
                  className="icon-button bordered"
                  aria-label="Next expense page"
                  disabled={activePage >= pageCount - 1}
                  onClick={() => setPage(activePage + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            icon={<ReceiptText size={25} />}
            title={
              ledgerFiltered
                ? 'No expenses match these filters'
                : 'No expenses in this financial year'
            }
            description={
              ledgerFiltered
                ? 'Clear the expense filters or choose a different financial year.'
                : 'Record a business expense to begin tracking its approval, budget impact and payment.'
            }
            action={
              ledgerFiltered ? (
                <button className="button button-secondary" onClick={clearLedgerFilters}>
                  Clear expense filters
                </button>
              ) : canCreate ? (
                <button
                  className="button button-secondary"
                  onClick={() => setEditingExpense('new')}
                >
                  <Plus size={15} />
                  Record first expense
                </button>
              ) : undefined
            }
          />
        )}
      </section>

      {completeScope && (
        <details className="panel finance-audit-panel">
          <summary>
            <History size={18} />
            <span>
              <strong>Recent finance history</strong>
              <small>Budget, category and expense decisions across all financial years</small>
            </span>
            <span className="finance-audit-count">{history.length}</span>
            <ChevronRight size={17} />
          </summary>
          <div className="finance-audit-content">
            <div className="finance-history">
              {history.slice(0, historyLimit).map((event) => {
                const relatedExpense = data.expenses.find(
                  (expense) => expense.id === event.entityId,
                );
                const relatedBudget = data.budgets.find((budget) => budget.id === event.entityId);
                const relatedCategory = data.expenseCategories.find(
                  (category) => category.id === event.entityId,
                );
                return (
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
                        {relatedBudget
                          ? ` · ${relatedBudget.name}`
                          : relatedCategory
                            ? ` · ${relatedCategory.name}`
                            : ''}
                      </span>
                      {relatedExpense && (
                        <button
                          className="text-button"
                          onClick={() => setSelectedId(relatedExpense.id)}
                        >
                          Open {relatedExpense.code}
                          <ArrowRight size={13} />
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
              {!history.length && (
                <p className="finance-form-hint">
                  Financial changes and their recorded reasons will appear here.
                </p>
              )}
            </div>
            {history.length > historyLimit && (
              <button
                className="button button-secondary"
                onClick={() => setHistoryLimit((limit) => limit + 50)}
              >
                Show more history
              </button>
            )}
            <p className="finance-history-limit">
              This view uses the latest 1,000 finance events available in your access scope. Earlier
              records remain in saved finance history. The department filter applies here; the
              financial year and expense ledger filters do not.
            </p>
          </div>
        </details>
      )}

      <div className="finance-method-note">
        <CircleHelp size={19} />
        <div>
          <h3>How these figures work</h3>
          <p>
            {personal
              ? 'Pending requests await a decision. Approved expenses are commitments awaiting an external payment record. Once paid, the same amount moves to the paid column. Draft, rejected and void expenses are excluded from these totals.'
              : 'Available budget = active and closed allocations − approved, unpaid expenses − recorded payments. Pending requests are shown separately. Draft, rejected and void expenses do not use budget. Paying an approved expense moves the same amount between columns and keeps total usage unchanged.'}
          </p>
          <p>
            Figures follow the expense date in the selected company financial year. This is an
            internal budget and expense record; payments are recorded from external transactions.
          </p>
        </div>
      </div>

      {editingExpense && (
        <ExpenseForm
          key={editingExpense === 'new' ? 'new' : editingExpense.id}
          item={editingExpense === 'new' ? undefined : editingExpense}
          initialDepartment={departmentId}
          onClose={() => {
            if (editingExpense !== 'new') setSelectedId(editingExpense.id);
            setEditingExpense(null);
          }}
          onSaved={(id) => {
            setEditingExpense(null);
            if (id) setSelectedId(id);
          }}
        />
      )}
      {selected && !editingExpense && (
        <FinanceDetail
          key={selected.id}
          expense={selected}
          onClose={() => setSelectedId('')}
          onEdit={(detail) => {
            setSelectedId('');
            setEditingExpense(detail);
          }}
          onOpenTask={onOpenTask}
        />
      )}
      {editingBudget && (
        <BudgetForm
          key={editingBudget === 'new' ? `new-${year}-${departmentId}` : editingBudget.id}
          item={editingBudget === 'new' ? undefined : editingBudget}
          initialDepartment={departmentId}
          year={year}
          onClose={() => setEditingBudget(null)}
        />
      )}
      {categoriesOpen && <CategoryManager onClose={() => setCategoriesOpen(false)} />}
    </div>
  );
}

export default FinancePage;
