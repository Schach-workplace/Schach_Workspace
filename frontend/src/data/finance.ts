import type { Budget, Expense, WorkspaceData } from '../types';

export const MAX_MONEY_MINOR = 1_000_000_000_000;
export const SUPPORTED_CURRENCIES = [
  'INR',
  'USD',
  'EUR',
  'GBP',
  'AED',
  'SGD',
  'AUD',
  'CAD',
] as const;

export function parseMoney(input: string): number {
  const value = input.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new Error('Enter a nonnegative amount with up to two decimal places, without commas.');
  const [major, fraction = ''] = value.split('.');
  const minor = BigInt(major) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor > BigInt(MAX_MONEY_MINOR)) throw new Error('Amount exceeds the supported limit.');
  return Number(minor);
}

export function formatMoney(minor: number, currency = 'INR'): string {
  if (!Number.isSafeInteger(minor)) throw new Error('Money must use safe integer minor units.');
  if (!SUPPORTED_CURRENCIES.includes(currency as (typeof SUPPORTED_CURRENCIES)[number]))
    throw new Error('Choose a supported company currency.');
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function fiscalMonth(month: number) {
  if (!Number.isInteger(month) || month < 1 || month > 12)
    throw new Error('Financial year must start in a month from 1 to 12.');
}
export function fiscalYearStart(date: string, startMonth = 4): number {
  fiscalMonth(startMonth);
  if (!validDate(date)) throw new Error('Choose a valid calendar date.');
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) < startMonth ? year - 1 : year;
}
export function fiscalYearRange(
  startYear: number,
  startMonth = 4,
): { startDate: string; endDate: string } {
  fiscalMonth(startMonth);
  if (!Number.isInteger(startYear) || startYear < 1000 || startYear > 9998)
    throw new Error('Choose a valid financial year.');
  const startDate = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
  const endDate = new Date(Date.UTC(startYear + 1, startMonth - 1, 0)).toISOString().slice(0, 10);
  return { startDate, endDate };
}

export interface ExpenseTotals {
  pendingMinor: number;
  approvedMinor: number;
  paidMinor: number;
  usedMinor: number;
  availableMinor: number;
}
function sum(expenses: Expense[], status: Expense['status']): number {
  let value = 0;
  for (const e of expenses) {
    if (e.status !== status) continue;
    if (!Number.isSafeInteger(e.amountMinor)) throw new Error('An expense has an invalid amount.');
    value += e.amountMinor;
    if (!Number.isSafeInteger(value)) throw new Error('This report exceeds the supported total.');
  }
  return value;
}
function totals(expenses: Expense[], allocatedMinor: number): ExpenseTotals {
  const pendingMinor = sum(expenses, 'submitted');
  const approvedMinor = sum(expenses, 'approved');
  const paidMinor = sum(expenses, 'paid');
  const usedMinor = approvedMinor + paidMinor;
  if (![usedMinor, allocatedMinor - usedMinor].every(Number.isSafeInteger))
    throw new Error('This report exceeds the supported total.');
  return {
    pendingMinor,
    approvedMinor,
    paidMinor,
    usedMinor,
    availableMinor: allocatedMinor - usedMinor,
  };
}
export function budgetUsage(budget: Budget, expenses: Expense[]): ExpenseTotals {
  const relevant = expenses.filter(
    (e) =>
      e.departmentId === budget.departmentId &&
      e.expenseDate >= budget.startDate &&
      e.expenseDate <= budget.endDate &&
      e.currency === budget.currency,
  );
  return totals(relevant, budget.amountMinor);
}
export function financeSummary(
  data: WorkspaceData,
  startDate: string,
  endDate: string,
  departmentId = '',
) {
  if (!departmentId && data.financeScope === 'department') departmentId = data.me.departmentId;
  const currency = data.company.currency || 'INR';
  const expenses = (data.expenses || []).filter(
    (e) =>
      (!departmentId || e.departmentId === departmentId) &&
      e.expenseDate >= startDate &&
      e.expenseDate <= endDate &&
      e.currency === currency,
  );
  const budgets = (data.budgets || []).filter(
    (b) =>
      b.status !== 'draft' &&
      (!departmentId || b.departmentId === departmentId) &&
      b.startDate >= startDate &&
      b.endDate <= endDate &&
      b.currency === currency,
  );
  const allocatedMinor = budgets.reduce((total, b) => total + b.amountMinor, 0);
  if (!Number.isSafeInteger(allocatedMinor))
    throw new Error('This report exceeds the supported total.');
  const result = totals(expenses, allocatedMinor);
  const unbudgetedMinor = expenses
    .filter(
      (e) =>
        ['approved', 'paid'].includes(e.status) &&
        !budgets.some(
          (b) =>
            b.departmentId === e.departmentId &&
            e.expenseDate >= b.startDate &&
            e.expenseDate <= b.endDate,
        ),
    )
    .reduce((total, e) => total + e.amountMinor, 0);
  const exposureMinor = result.usedMinor + result.pendingMinor;
  if (![unbudgetedMinor, exposureMinor].every(Number.isSafeInteger))
    throw new Error('This report exceeds the supported total.');
  return {
    ...result,
    allocatedMinor,
    exposureMinor,
    unbudgetedMinor,
    availableMinor:
      data.financeScope === 'personal' || data.financeScope === 'none' ? 0 : result.availableMinor,
  };
}
