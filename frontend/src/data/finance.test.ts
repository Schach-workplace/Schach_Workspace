import { describe, expect, it } from 'vitest';
import type { Budget, Expense, WorkspaceData } from '../types';
import {
  budgetUsage,
  financeSummary,
  fiscalYearRange,
  fiscalYearStart,
  formatMoney,
  parseMoney,
} from './finance';

const budget = {
  id: 'b1',
  departmentId: 'd1',
  startDate: '2026-04-01',
  endDate: '2027-03-31',
  amountMinor: 100000,
  status: 'active',
  currency: 'INR',
} as Budget;
function expense(
  id: string,
  status: Expense['status'],
  amountMinor = 10000,
  extra: Partial<Expense> = {},
): Expense {
  return {
    id,
    status,
    amountMinor,
    departmentId: 'd1',
    expenseDate: '2026-10-10',
    currency: 'INR',
    ...extra,
  } as Expense;
}

describe('exact money and financial-year boundaries', () => {
  it('parses decimal strings into exact integer paise', () => {
    expect(parseMoney('0.01')).toBe(1);
    expect(parseMoney('0.29')).toBe(29);
    expect(parseMoney('1250.5')).toBe(125050);
    expect(parseMoney('0001.00')).toBe(100);
    expect(parseMoney(' 100.00 ')).toBe(10000);
  });
  it('rejects excess precision, exponent notation, signs, and separators', () => {
    for (const input of ['1.005', '1e4', '-1', '+1', '1,000', '', 'NaN', 'Infinity', '.5'])
      expect(() => parseMoney(input)).toThrow();
  });
  it('supports zero budgets and enforces the documented maximum without rounding', () => {
    expect(parseMoney('0')).toBe(0);
    expect(parseMoney('10000000000.00')).toBe(1000000000000);
    expect(() => parseMoney('10000000000.01')).toThrow();
  });
  it('formats the exact company currency and rejects fractional minor units', () => {
    expect(formatMoney(123456, 'INR')).toContain('1,234.56');
    expect(formatMoney(-100, 'USD')).toContain('1.00');
    expect(() => formatMoney(1.5, 'INR')).toThrow();
  });
  it('keeps March and April in the correct Indian financial year', () => {
    expect(fiscalYearStart('2026-03-31', 4)).toBe(2025);
    expect(fiscalYearStart('2026-04-01', 4)).toBe(2026);
    expect(fiscalYearRange(2026, 4)).toEqual({ startDate: '2026-04-01', endDate: '2027-03-31' });
    expect(fiscalYearRange(2024, 1)).toEqual({ startDate: '2024-01-01', endDate: '2024-12-31' });
  });
  it('rejects invalid calendar dates and fiscal months', () => {
    expect(() => fiscalYearStart('2026-02-30', 4)).toThrow();
    expect(() => fiscalYearRange(2026, 13)).toThrow();
  });
});

describe('budget and expense totals', () => {
  it('counts approved and paid once; pending never silently consumes availability', () => {
    const result = budgetUsage(budget, [
      expense('a', 'approved', 25000),
      expense('p', 'paid', 30000),
      expense('s', 'submitted', 10000),
      expense('d', 'draft'),
      expense('r', 'rejected'),
      expense('v', 'void'),
    ]);
    expect(result).toMatchObject({
      approvedMinor: 25000,
      paidMinor: 30000,
      pendingMinor: 10000,
      usedMinor: 55000,
      availableMinor: 45000,
    });
  });
  it('uses inclusive expense-date bounds and the correct department', () => {
    const result = budgetUsage(budget, [
      expense('first', 'paid', 100, { expenseDate: budget.startDate }),
      expense('last', 'paid', 200, { expenseDate: budget.endDate }),
      expense('prior', 'paid', 500, { expenseDate: '2026-03-31' }),
      expense('other', 'paid', 500, { departmentId: 'd2' }),
    ]);
    expect(result.paidMinor).toBe(300);
  });
  it('preserves negative availability after a reasoned budget reduction', () => {
    expect(
      budgetUsage({ ...budget, amountMinor: 100 }, [expense('a', 'approved', 200)]).availableMinor,
    ).toBe(-100);
  });
  it('includes historical closed allocations and excludes draft allocations', () => {
    const w = {
      company: { currency: 'INR' },
      financeScope: 'company',
      budgets: [
        budget,
        { ...budget, id: 'b2', departmentId: 'd2', amountMinor: 50000, status: 'closed' },
        { ...budget, id: 'b3', departmentId: 'd3', amountMinor: 90000, status: 'draft' },
      ],
      expenses: [
        expense('a', 'approved', 25000),
        expense('p', 'paid', 30000),
        expense('s', 'submitted', 10000),
      ],
    } as unknown as WorkspaceData;
    expect(financeSummary(w, budget.startDate, budget.endDate)).toMatchObject({
      allocatedMinor: 150000,
      usedMinor: 55000,
      availableMinor: 95000,
      pendingMinor: 10000,
      exposureMinor: 65000,
    });
  });
  it('identifies approved unbudgeted spending and respects department filters', () => {
    const w = {
      company: { currency: 'INR' },
      financeScope: 'company',
      budgets: [budget],
      expenses: [
        expense('a', 'paid', 1000),
        expense('b', 'approved', 2000, { departmentId: 'd2' }),
      ],
    } as unknown as WorkspaceData;
    expect(financeSummary(w, budget.startDate, budget.endDate).unbudgetedMinor).toBe(2000);
    expect(financeSummary(w, budget.startDate, budget.endDate, 'd1').usedMinor).toBe(1000);
  });
  it('keeps department balances separate from a head’s own historical expenses elsewhere', () => {
    const w = {
      company: { currency: 'INR' },
      me: { departmentId: 'd1' },
      financeScope: 'department',
      budgets: [budget],
      expenses: [
        expense('current', 'paid', 1000),
        expense('historical', 'paid', 5000, { departmentId: 'd2' }),
      ],
    } as unknown as WorkspaceData;
    expect(financeSummary(w, budget.startDate, budget.endDate)).toMatchObject({
      paidMinor: 1000,
      availableMinor: 99000,
    });
  });
  it('does not invent a budget balance from a personal expense subset', () => {
    const w = {
      company: { currency: 'INR' },
      financeScope: 'personal',
      budgets: [],
      expenses: [expense('p', 'paid', 1000)],
    } as unknown as WorkspaceData;
    expect(financeSummary(w, budget.startDate, budget.endDate)).toMatchObject({
      allocatedMinor: 0,
      paidMinor: 1000,
      availableMinor: 0,
    });
  });
});

describe('exact aggregate display', () => {
  it('keeps cents on the real bounded 9008-row summary and rejects an unsafe summary', () => {
    const rows = Array.from({ length: 9007 }, (_, i) =>
      expense(String(i), 'submitted', 1_000_000_000_000),
    );
    rows.push(expense('last', 'submitted', 199254740991));
    const data = {
      company: { currency: 'INR' },
      financeScope: 'company',
      budgets: [],
      expenses: rows,
    } as unknown as WorkspaceData;
    const summary = financeSummary(data, '2026-04-01', '2027-03-31');
    expect(summary.pendingMinor).toBe(9007199254740991);
    expect(formatMoney(summary.pendingMinor, 'USD')).toBe('$90,071,992,547,409.91');
    expect(formatMoney(summary.pendingMinor, 'INR')).toBe('₹9,00,71,99,25,47,409.91');
    expect(formatMoney('-9007199254740993', 'USD')).toBe('-$90,071,992,547,409.93');
    expect(formatMoney('-1', 'USD')).toBe('-$0.01');
    expect(formatMoney('-0', 'USD')).toBe('$0.00');
    rows[9007].amountMinor = 199254740993;
    expect(() => financeSummary(data, '2026-04-01', '2027-03-31')).toThrow('supported total');
  });
});
