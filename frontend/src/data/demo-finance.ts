// Local evaluation only. The Go service owns real authentication and financial controls.
import type {
  Attachment,
  Budget,
  Expense,
  ExpenseCategory,
  FinanceScope,
  MutationResult,
  Person,
  WorkspaceData,
} from '../types';
import {
  budgetUsage,
  fiscalYearStart,
  formatMoney,
  MAX_MONEY_MINOR,
  SUPPORTED_CURRENCIES,
} from './finance';
import { validDate } from './imports';
import { todayInTimezone } from './metrics';

const uid = () => crypto.randomUUID();
const stamp = () => new Date().toISOString();
const fail = (message: string): never => {
  throw new Error(message);
};
const text = (value: unknown, fallback = '') =>
  value === undefined ? fallback : String(value ?? '').trim();
const length = (value: string) => Array.from(value).length;
const normal = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
export const managesFinance = (me: Person) =>
  ['founder', 'ceo', 'admin', 'finance'].includes(me.role);
export function financialScope(me: Person): FinanceScope {
  if (managesFinance(me)) return 'company';
  if (me.role === 'head') return 'department';
  return me.role === 'viewer' ? 'none' : 'personal';
}
export function canReadExpense(me: Person, e: Expense): boolean {
  return (
    me.role !== 'viewer' &&
    (managesFinance(me) ||
      e.createdBy === me.id ||
      (me.role === 'head' && !!me.departmentId && me.departmentId === e.departmentId))
  );
}
function canReview(me: Person, e: Expense): boolean {
  return (
    me.id !== e.createdBy &&
    (managesFinance(me) ||
      (me.role === 'head' && !!me.departmentId && e.departmentId === me.departmentId))
  );
}
export function defaultExpenseCategories(companyId: string): ExpenseCategory[] {
  return [
    ['Materials', '#F97316'],
    ['Equipment', '#6366F1'],
    ['Travel', '#3B82F6'],
    ['Software', '#14B8A6'],
    ['Professional services', '#A855F7'],
    ['People & administration', '#16A34A'],
    ['Other', '#64748B'],
  ].map(([name, color], i) => ({
    id: `${companyId}-category-${i + 1}`,
    companyId,
    name,
    color,
    active: true,
    receiptRequired: true,
    version: 1,
  }));
}
export function hydrateFinance(w: WorkspaceData) {
  w.company.currency ||= 'INR';
  w.company.fiscalYearStartMonth ||= 4;
  w.financeScope = financialScope(w.me);
  w.expenseCategories ??= defaultExpenseCategories(w.company.id);
  w.budgets ??= [];
  w.expenses ??= [];
  w.financeEvents ??= [];
  for (const e of w.expenses) e.receipts ??= [];
}
export function validateFinanceSettings(w: WorkspaceData, body: Record<string, any>) {
  const currency =
    body.currency === undefined ? w.company.currency : text(body.currency).toUpperCase();
  const month =
    body.fiscalYearStartMonth === undefined
      ? w.company.fiscalYearStartMonth
      : Number(body.fiscalYearStartMonth);
  if (!SUPPORTED_CURRENCIES.includes(currency as (typeof SUPPORTED_CURRENCIES)[number]))
    fail('Choose a supported company currency.');
  if (!Number.isInteger(month) || month < 1 || month > 12)
    fail('Choose a valid financial-year start month.');
  if (
    (w.budgets.length || w.expenses.length) &&
    (currency !== w.company.currency || month !== w.company.fiscalYearStartMonth)
  )
    fail('Company currency and financial year cannot change after financial records exist.');
  return { currency, fiscalYearStartMonth: month };
}
export function financeRead(
  w: WorkspaceData,
  me: Person,
  taskIds: Set<string>,
  projectIds: Set<string>,
) {
  const financeScope = financialScope(me);
  const expenses = w.expenses
    .filter((e) => canReadExpense(me, e))
    .map((e) => ({
      ...e,
      taskId: taskIds.has(e.taskId) ? e.taskId : '',
      projectId: projectIds.has(e.projectId) ? e.projectId : '',
    }));
  const budgets = w.budgets.filter(
    (b) =>
      financeScope === 'company' ||
      (financeScope === 'department' && !!me.departmentId && b.departmentId === me.departmentId),
  );
  const expenseIds = new Set(expenses.map((e) => e.id));
  const budgetIds = new Set(budgets.map((b) => b.id));
  return {
    financeScope,
    expenses,
    budgets,
    expenseCategories: financeScope === 'none' ? [] : w.expenseCategories,
    financeEvents: w.financeEvents
      .filter(
        (a) =>
          financeScope === 'company' ||
          (a.entityType === 'expense' && expenseIds.has(a.entityId)) ||
          (a.entityType === 'budget' && budgetIds.has(a.entityId)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 1000),
  };
}
export function financeAudit(
  w: WorkspaceData,
  me: Person,
  entityType: 'expense' | 'budget' | 'category' | 'settings',
  entityId: string,
  departmentId: string,
  action: string,
  detail: string,
) {
  w.financeEvents.unshift({
    id: uid(),
    companyId: w.company.id,
    departmentId,
    entityType,
    entityId,
    userId: me.id,
    action,
    detail,
    createdAt: stamp(),
  });
}
function ping(w: WorkspaceData, userId: string, e: Expense, title: string) {
  w.notifications.unshift({
    id: uid(),
    companyId: w.company.id,
    taskId: '',
    expenseId: e.id,
    userId,
    title,
    body: `${e.code} · ${e.title} · ${formatMoney(e.amountMinor, e.currency)}`,
    kind: 'finance',
    read: false,
    createdAt: stamp(),
  });
}
function reason(value: unknown, label: string): string {
  const v = text(value);
  if (Array.from(v).length < 12 || Array.from(v).length > 4000)
    fail(`${label} must contain 12–4,000 characters.`);
  return v;
}
function money(value: unknown, allowZero = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > MAX_MONEY_MINOR
  )
    fail('Amount must be a positive integer in minor units within the supported limit.');
  return value as number;
}
function version(actual: number, supplied: unknown) {
  if (actual !== supplied)
    fail('This record changed since you opened it. Refresh and retry with its latest version.');
}
function requireManager(me: Person) {
  if (!managesFinance(me))
    fail('Company leadership or Finance must manage budgets and categories.');
}
function expenseBy(w: WorkspaceData, me: Person, id: string): Expense {
  const e = w.expenses.find((e) => e.id === id && canReadExpense(me, e));
  if (!e) fail('Expense not found in your accessible company.');
  return e!;
}
export function receiptExpense(w: WorkspaceData, me: Person, expenseId: string): Expense {
  const e = expenseBy(w, me, expenseId);
  if (e.createdBy !== me.id && !managesFinance(me))
    fail('Only the expense creator or company Finance can append receipts.');
  return e;
}
function validExpense(
  w: WorkspaceData,
  me: Person,
  e: Expense,
  references: { taskIds: Set<string>; projectIds: Set<string> },
) {
  if (!e.title || length(e.title) > 240) fail('Enter an expense title of 1–240 characters.');
  if (!e.vendor || length(e.vendor) > 240) fail('Enter a vendor or payee of 1–240 characters.');
  if (
    length(e.description) > 8000 ||
    length(e.invoiceNumber) > 160 ||
    length(e.receiptExceptionReason) > 4000
  )
    fail('Expense text exceeds the supported length.');
  if (e.receiptExceptionReason) reason(e.receiptExceptionReason, 'Receipt exception reason');
  e.vendor = e.vendor.replace(/\s+/g, ' ');
  e.invoiceNumber = e.invoiceNumber.replace(/\s+/g, ' ');
  money(e.amountMinor);
  if (!validDate(e.expenseDate) || e.expenseDate > todayInTimezone(w.company.timezone))
    fail('Expense date must be a valid date on or before today.');
  if (!w.departments.some((d) => d.id === e.departmentId))
    fail('Choose a department in this company.');
  if (!managesFinance(me) && (!me.departmentId || me.departmentId !== e.departmentId))
    fail('You can submit expenses only for your assigned department.');
  if (!w.expenseCategories.some((c) => c.id === e.categoryId && c.active))
    fail('Choose an active expense category.');
  if (e.taskId) {
    const task = w.tasks.find((t) => t.id === e.taskId && references.taskIds.has(t.id));
    if (!task || task.departmentId !== e.departmentId)
      fail('Choose an accessible task in the expense department.');
    if (e.projectId && task?.projectId !== e.projectId)
      fail('The task and project must refer to the same work.');
  }
  if (e.projectId) {
    const project = w.projects.find((p) => p.id === e.projectId && references.projectIds.has(p.id));
    if (!project || project.departmentId !== e.departmentId)
      fail('Choose an accessible project in the expense department.');
  }
  if (
    e.invoiceNumber &&
    w.expenses.some(
      (other) =>
        other.id !== e.id &&
        other.status !== 'void' &&
        normal(other.vendor) === normal(e.vendor) &&
        normal(other.invoiceNumber) === normal(e.invoiceNumber),
    )
  )
    fail('This vendor invoice is already recorded. Open the existing expense instead.');
}
function receiptCheck(w: WorkspaceData, e: Expense) {
  if (w.expenseCategories.find((c) => c.id === e.categoryId)?.receiptRequired && !e.receipts.length)
    reason(e.receiptExceptionReason, 'Missing-receipt exception reason');
}
const expenseFields = [
  'departmentId',
  'categoryId',
  'title',
  'description',
  'vendor',
  'invoiceNumber',
  'expenseDate',
  'amountMinor',
  'projectId',
  'taskId',
  'receiptExceptionReason',
] as const;

function expenseChanges(w: WorkspaceData, before: Expense, after: Expense) {
  const labels: Record<string, string> = {
    departmentId: 'Department',
    categoryId: 'Category',
    title: 'Title',
    description: 'Description',
    vendor: 'Vendor',
    invoiceNumber: 'Invoice',
    expenseDate: 'Expense date',
    amountMinor: 'Amount',
    receiptExceptionReason: 'Receipt exception',
  };
  const show = (key: (typeof expenseFields)[number], e: Expense) => {
    if (key === 'amountMinor') return formatMoney(e.amountMinor, e.currency);
    if (key === 'departmentId')
      return w.departments.find((d) => d.id === e.departmentId)?.name || 'Unassigned';
    if (key === 'categoryId')
      return w.expenseCategories.find((c) => c.id === e.categoryId)?.name || 'Unassigned';
    return String(e[key] || '—');
  };
  return expenseFields
    .filter((key) => before[key] !== after[key])
    .map((key) =>
      key === 'taskId'
        ? 'Linked task changed'
        : key === 'projectId'
          ? 'Linked project changed'
          : `${labels[key]}: ${show(key, before)} → ${show(key, after)}`,
    )
    .join('; ');
}

export function mutateDemoFinance(
  w: WorkspaceData,
  me: Person,
  parts: string[],
  body: Record<string, any>,
  method: string,
  references: { taskIds: Set<string>; projectIds: Set<string> },
): MutationResult {
  hydrateFinance(w);
  if (me.role === 'viewer') fail('This company membership cannot access finance.');
  if (parts[0] === 'expense-categories') {
    requireManager(me);
    const old = parts[1] ? w.expenseCategories.find((c) => c.id === parts[1]) : undefined;
    if (parts[1] && !old) fail('Expense category not found.');
    if (old) version(old.version, body.version);
    const next: ExpenseCategory = {
      id: old?.id ?? uid(),
      companyId: w.company.id,
      name: text(body.name, old?.name),
      color: text(body.color, old?.color ?? '#F97316'),
      active: body.active ?? old?.active ?? true,
      receiptRequired: body.receiptRequired ?? old?.receiptRequired ?? true,
      version: (old?.version ?? 0) + 1,
    };
    if (
      !next.name ||
      length(next.name) > 120 ||
      !/^#[0-9a-f]{6}$/i.test(next.color) ||
      typeof next.active !== 'boolean' ||
      typeof next.receiptRequired !== 'boolean'
    )
      fail('Enter a category name, valid colour and receipt policy.');
    if (w.expenseCategories.some((c) => c.id !== next.id && normal(c.name) === normal(next.name)))
      fail('That category name already exists.');
    if (old) Object.assign(old, next);
    else w.expenseCategories.push(next);
    financeAudit(
      w,
      me,
      'category',
      next.id,
      '',
      old ? 'category_updated' : 'category_created',
      `${next.name}; ${next.active ? 'active' : 'archived'}; receipt ${next.receiptRequired ? 'required' : 'optional'}`,
    );
    return { ok: true, id: next.id };
  }
  if (parts[0] === 'budgets') {
    requireManager(me);
    const old = parts[1] ? w.budgets.find((b) => b.id === parts[1]) : undefined;
    if (parts[1] && !old) fail('Budget not found.');
    if (old) version(old.version, body.version);
    const next: Budget = {
      id: old?.id ?? uid(),
      companyId: w.company.id,
      departmentId: text(body.departmentId, old?.departmentId),
      name: text(body.name, old?.name),
      startDate: text(body.startDate, old?.startDate),
      endDate: text(body.endDate, old?.endDate),
      amountMinor: money(body.amountMinor ?? old?.amountMinor, true),
      currency: w.company.currency,
      status: body.status ?? old?.status ?? 'draft',
      notes: text(body.notes, old?.notes),
      createdBy: old?.createdBy ?? me.id,
      createdAt: old?.createdAt ?? stamp(),
      updatedAt: stamp(),
      version: (old?.version ?? 0) + 1,
    };
    if (
      !next.name ||
      length(next.name) > 160 ||
      length(next.notes) > 4000 ||
      !w.departments.some((d) => d.id === next.departmentId)
    )
      fail('Enter a budget name and a department in this company.');
    if (
      !validDate(next.startDate) ||
      !validDate(next.endDate) ||
      next.endDate < next.startDate ||
      fiscalYearStart(next.startDate, w.company.fiscalYearStartMonth) !==
        fiscalYearStart(next.endDate, w.company.fiscalYearStartMonth)
    )
      fail('Budget dates must form a valid period within one financial year.');
    if (
      !['draft', 'active', 'closed'].includes(next.status) ||
      (!old && next.status === 'closed') ||
      (old?.status === 'draft' && next.status === 'closed') ||
      (old && old.status !== 'draft' && next.status === 'draft')
    )
      fail(
        'Choose a valid budget state: activate a draft, close an active budget, or reopen a closed budget.',
      );
    if (
      old &&
      old.status !== 'draft' &&
      (next.departmentId !== old.departmentId ||
        next.startDate !== old.startDate ||
        next.endDate !== old.endDate)
    )
      fail('An activated budget has immutable department and period boundaries.');
    if (
      w.budgets.some(
        (b) =>
          b.id !== next.id &&
          b.departmentId === next.departmentId &&
          b.startDate <= next.endDate &&
          b.endDate >= next.startDate,
      )
    )
      fail('This department already has an overlapping budget period. Edit that envelope instead.');
    if (text(body.reason)) reason(body.reason, 'Budget reason');
    const note =
      old &&
      old.status !== 'draft' &&
      (old.amountMinor !== next.amountMinor || old.status !== next.status)
        ? reason(body.reason, 'Budget revision reason')
        : text(body.reason);
    const previous = old
      ? `${formatMoney(old.amountMinor, old.currency)}, ${old.status}, ${old.startDate} to ${old.endDate}`
      : 'new';
    if (old) Object.assign(old, next);
    else w.budgets.push(next);
    financeAudit(
      w,
      me,
      'budget',
      next.id,
      next.departmentId,
      old ? 'budget_updated' : 'budget_created',
      `${next.name}: ${previous} → ${formatMoney(next.amountMinor, next.currency)}, ${next.status}, ${next.startDate} to ${next.endDate}. ${note}`,
    );
    return { ok: true, id: next.id };
  }
  if (parts[0] !== 'expenses') fail('This finance action is unavailable.');
  if (!parts[1]) {
    const e: Expense = {
      id: uid(),
      companyId: w.company.id,
      code: `EXP-${String(Math.max(0, ...w.expenses.map((e) => Number(e.code.match(/(\d+)$/)?.[1] || 0))) + 1).padStart(4, '0')}`,
      departmentId: text(body.departmentId, me.departmentId),
      categoryId: text(body.categoryId),
      title: text(body.title),
      description: text(body.description),
      vendor: text(body.vendor),
      invoiceNumber: text(body.invoiceNumber),
      expenseDate: text(body.expenseDate),
      amountMinor: money(body.amountMinor),
      currency: w.company.currency,
      projectId: text(body.projectId),
      taskId: text(body.taskId),
      createdBy: me.id,
      status: 'draft',
      receiptExceptionReason: text(body.receiptExceptionReason),
      submittedAt: '',
      reviewedBy: '',
      reviewedAt: '',
      reviewNote: '',
      budgetOverrideReason: '',
      paidBy: '',
      paidAt: '',
      paidDate: '',
      paymentMethod: '',
      paymentReference: '',
      createdAt: stamp(),
      updatedAt: stamp(),
      version: 1,
      receipts: [],
    };
    validExpense(w, me, e, references);
    w.expenses.push(e);
    financeAudit(
      w,
      me,
      'expense',
      e.id,
      e.departmentId,
      'expense_created',
      `${e.code} · ${e.title} · ${formatMoney(e.amountMinor, e.currency)}. Vendor: ${e.vendor}. Invoice: ${e.invoiceNumber || '—'}. Expense date: ${e.expenseDate}.`,
    );
    return { ok: true, id: e.id };
  }
  const e = expenseBy(w, me, parts[1]);
  version(e.version, body.version);
  if (!parts[2] && method === 'PATCH') {
    if (e.createdBy !== me.id || !['draft', 'rejected'].includes(e.status))
      fail(
        'Only the creator can edit a draft or rejected expense. Withdraw submitted work before editing.',
      );
    if (body.createdBy !== undefined && body.createdBy !== e.createdBy)
      fail('The expense creator is immutable.');
    const next = { ...e };
    for (const key of expenseFields)
      if (body[key] !== undefined)
        Object.assign(next, { [key]: key === 'amountMinor' ? money(body[key]) : text(body[key]) });
    validExpense(w, me, next, references);
    const changeDetails = expenseChanges(w, e, next);
    Object.assign(e, next);
    e.version++;
    e.updatedAt = stamp();
    financeAudit(
      w,
      me,
      'expense',
      e.id,
      e.departmentId,
      'expense_updated',
      changeDetails || 'Saved without financial field changes.',
    );
    return { ok: true, id: e.id };
  }
  if (parts[2] !== 'transition') fail('This finance action is unavailable.');
  const action = text(body.action);
  const previous = e.status;
  let note = text(body.note);
  const override = text(body.overrideReason);
  if (length(note) > 4000) fail('Decision notes allow up to 4,000 characters.');
  if (override) {
    reason(override, 'Budget override reason');
    if (action !== 'approve') fail('A budget override applies only to approval.');
  }
  if (
    action !== 'pay' &&
    [body.paidDate, body.paymentMethod, body.paymentReference].some((value) => text(value))
  )
    fail('Payment details apply only when recording a payment.');
  if (action === 'submit') {
    if (e.createdBy !== me.id || !['draft', 'rejected'].includes(e.status))
      fail('Only the creator can submit a draft or rejected expense.');
    validExpense(w, me, e, references);
    receiptCheck(w, e);
    e.status = 'submitted';
    e.submittedAt = stamp();
    e.reviewedBy = '';
    e.reviewedAt = '';
    e.reviewNote = '';
    e.budgetOverrideReason = '';
    for (const p of w.people)
      if (p.active && canReview(p, e)) ping(w, p.id, e, 'Expense ready for review');
  } else if (action === 'withdraw') {
    if (e.createdBy !== me.id || e.status !== 'submitted')
      fail('Only the creator can withdraw a submitted expense.');
    e.status = 'draft';
    e.submittedAt = '';
  } else if (action === 'approve' || action === 'reject') {
    if (e.createdBy === me.id) fail('You cannot approve or reject your own expense.');
    if (!canReview(me, e) || e.status !== 'submitted')
      fail('You cannot review this expense in its current state.');
    if (action === 'approve') {
      if (override && !managesFinance(me))
        fail('Only company Finance can record a budget override.');
      if (!validDate(e.expenseDate) || e.expenseDate > todayInTimezone(w.company.timezone))
        fail('Expense date must be on or before today.');
      receiptCheck(w, e);
      if (e.receiptExceptionReason)
        note = reason(note, 'Independent receipt-exception approval note');
      const b = w.budgets.find(
        (b) =>
          b.departmentId === e.departmentId &&
          b.startDate <= e.expenseDate &&
          b.endDate >= e.expenseDate,
      );
      const outside =
        !b || b.status !== 'active' || budgetUsage(b, w.expenses).availableMinor < e.amountMinor;
      if (outside) {
        if (!managesFinance(me))
          fail('This expense requires company Finance to approve a budget override.');
        e.budgetOverrideReason = reason(body.overrideReason, 'Budget override reason');
      }
      e.budgetOverrideReason = override;
      e.status = 'approved';
    } else {
      note = reason(note, 'Rejection reason');
      e.status = 'rejected';
    }
    e.reviewedBy = me.id;
    e.reviewedAt = stamp();
    e.reviewNote = note;
    ping(w, e.createdBy, e, action === 'approve' ? 'Expense approved' : 'Expense needs changes');
  } else if (action === 'pay') {
    if (e.createdBy === me.id) fail('You cannot record payment on your own expense.');
    if (!managesFinance(me) || e.status !== 'approved')
      fail('Company Finance can record payment only on an approved expense.');
    const date = text(body.paidDate),
      reference = text(body.paymentReference),
      method = text(body.paymentMethod);
    if (!validDate(date) || date < e.expenseDate || date > todayInTimezone(w.company.timezone))
      fail('Payment date must be between the expense date and today.');
    if (
      !reference ||
      length(reference) > 240 ||
      !['bank_transfer', 'upi', 'card', 'cash', 'other'].includes(method)
    )
      fail('Enter a payment method and reference for the external payment.');
    e.status = 'paid';
    e.paidBy = me.id;
    e.paidAt = stamp();
    e.paidDate = date;
    e.paymentReference = reference;
    e.paymentMethod = method as Expense['paymentMethod'];
    ping(w, e.createdBy, e, 'Expense payment recorded');
  } else if (action === 'void') {
    if (e.status === 'paid' || e.status === 'void')
      fail('Paid and void expenses are final and cannot be voided.');
    if (e.status === 'approved' ? !canReview(me, e) : e.createdBy !== me.id)
      fail('You do not have permission to void this expense.');
    note = reason(note, 'Void reason');
    e.status = 'void';
    if (e.createdBy !== me.id) ping(w, e.createdBy, e, 'Approved expense voided');
  } else fail('Choose a valid expense action.');
  e.version++;
  e.updatedAt = stamp();
  financeAudit(
    w,
    me,
    'expense',
    e.id,
    e.departmentId,
    `expense_${action}`,
    `${previous} → ${e.status}; ${formatMoney(e.amountMinor, e.currency)}. ${note}${e.budgetOverrideReason ? ` Budget override: ${e.budgetOverrideReason}` : ''}${action === 'pay' ? ` Payment ${e.paymentMethod}: ${e.paymentReference}; ${e.paidDate}` : ''}`,
  );
  return { ok: true, id: e.id };
}

export function appendDemoReceipt(
  w: WorkspaceData,
  me: Person,
  expenseId: string,
  receipt: Attachment,
) {
  const e = receiptExpense(w, me, expenseId);
  e.receipts.push(receipt);
  e.version++;
  e.updatedAt = stamp();
  financeAudit(w, me, 'expense', e.id, e.departmentId, 'receipt_added', receipt.fileName);
}
