import { beforeEach, describe, expect, it } from 'vitest';
import { demoMutate, readDemoWorkspace, resetDemo } from './demo';
import { todayInTimezone } from './metrics';
import { fiscalYearRange, fiscalYearStart } from './finance';

let company = '',
  department = '',
  category = '',
  member = '';
const now = () => todayInTimezone('Asia/Kolkata');
async function current(user = 'u-founder') {
  return readDemoWorkspace(company, user);
}
async function draft(amountMinor = 125050) {
  return demoMutate(company, member, '/expenses', {
    title: 'Site travel receipt',
    vendor: 'Sample Rail',
    invoiceNumber: '',
    departmentId: department,
    categoryId: category,
    expenseDate: now(),
    amountMinor,
    receiptExceptionReason: 'Original receipt is awaiting a supplier reissue.',
  });
}
async function state(id: string) {
  return (await current()).expenses.find((e) => e.id === id)!;
}
beforeEach(async () => {
  await resetDemo();
  company = (
    await demoMutate('c-schach', 'u-founder', '/companies', {
      name: 'Finance Test',
      slug: 'finance-test',
      timezone: 'Asia/Kolkata',
    })
  ).id!;
  department = (
    await demoMutate(company, 'u-founder', '/departments', { name: 'Operations', color: '#F97316' })
  ).id!;
  member = (
    await demoMutate(company, 'u-founder', '/people', {
      name: 'Expense Member',
      email: 'expense-member@demo.test',
      password: 'StrongDemoPass!2026',
      role: 'member',
      departmentId: department,
      capacityHours: 40,
    })
  ).id!;
  category = (
    await demoMutate(company, 'u-founder', '/expense-categories', {
      name: 'Rail fares',
      color: '#3B82F6',
      active: true,
      receiptRequired: true,
    })
  ).id!;
  const period = fiscalYearRange(fiscalYearStart(now(), 4), 4);
  await demoMutate(company, 'u-founder', '/budgets', {
    name: 'Operations allocation',
    departmentId: department,
    ...period,
    amountMinor: 500000,
    status: 'active',
  });
});

describe('complete finance demo workflow', () => {
  it('accepts only one of two edits based on the same expense version', async () => {
    const e = await draft();
    const outcomes = await Promise.allSettled([
      demoMutate(
        company,
        member,
        `/expenses/${e.id}`,
        { version: 1, title: 'First concurrent edit' },
        'PATCH',
      ),
      demoMutate(
        company,
        member,
        `/expenses/${e.id}`,
        { version: 1, title: 'Second concurrent edit' },
        'PATCH',
      ),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect((await state(e.id!)).version).toBe(2);
  });
  it('does not let two approvals consume the same remaining budget', async () => {
    const first = await draft(300000),
      second = await draft(300000);
    for (const e of [first, second])
      await demoMutate(company, member, `/expenses/${e.id}/transition`, {
        version: 1,
        action: 'submit',
      });
    const outcomes = await Promise.allSettled(
      [first, second].map((e) =>
        demoMutate(company, 'u-founder', `/expenses/${e.id}/transition`, {
          version: 2,
          action: 'approve',
          note: 'Receipt exception independently reviewed.',
        }),
      ),
    );
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const w = await current();
    expect(w.expenses.filter((e) => e.status === 'approved')).toHaveLength(1);
    expect(w.expenses.filter((e) => e.status === 'submitted')).toHaveLength(1);
  });

  it('records financial field changes and clears withdrawn submission metadata', async () => {
    const e = await draft();
    await demoMutate(
      company,
      member,
      `/expenses/${e.id}`,
      { version: 1, amountMinor: 8000, vendor: 'Changed Vendor', invoiceNumber: 'INV-8' },
      'PATCH',
    );
    const changes = (await current()).financeEvents
      .filter((event) => event.entityId === e.id && event.action === 'expense_updated')
      .map((event) => event.detail)
      .join(' ');
    expect(changes).toContain('Sample Rail');
    expect(changes).toContain('Changed Vendor');
    expect(changes).toContain('1,250.50');
    await demoMutate(company, member, `/expenses/${e.id}/transition`, {
      version: 2,
      action: 'submit',
    });
    await demoMutate(company, member, `/expenses/${e.id}/transition`, {
      version: 3,
      action: 'withdraw',
    });
    expect((await state(e.id!)).submittedAt).toBe('');
  });
  it('keeps a volunteered company budget override in the decision audit', async () => {
    const e = await draft();
    await demoMutate(company, member, `/expenses/${e.id}/transition`, {
      version: 1,
      action: 'submit',
    });
    const overrideReason = 'Additional management authorisation for this project expense.';
    await demoMutate(company, 'u-founder', `/expenses/${e.id}/transition`, {
      version: 2,
      action: 'approve',
      note: 'Receipt exception independently reviewed.',
      overrideReason,
    });
    expect((await state(e.id!)).budgetOverrideReason).toBe(overrideReason);
    expect(
      (await current()).financeEvents.find(
        (event) => event.entityId === e.id && event.action === 'expense_approve',
      )?.detail,
    ).toContain(overrideReason);
  });
  it('validates a nonempty receipt exception before saving the draft', async () => {
    await expect(
      demoMutate(company, member, '/expenses', {
        title: 'Travel',
        vendor: 'Rail',
        departmentId: department,
        categoryId: category,
        expenseDate: now(),
        amountMinor: 100,
        receiptExceptionReason: 'Missing',
      }),
    ).rejects.toThrow(/exception|characters/i);
  });
  it('requires receipt evidence or an explicit exception before submission', async () => {
    const e = await draft();
    await demoMutate(
      company,
      member,
      `/expenses/${e.id}`,
      { version: 1, receiptExceptionReason: '' },
      'PATCH',
    );
    await expect(
      demoMutate(company, member, `/expenses/${e.id}/transition`, { version: 2, action: 'submit' }),
    ).rejects.toThrow(/receipt/i);
  });
  it('submits, independently approves and records payment without allowing self review or replay', async () => {
    const e = await draft();
    await demoMutate(company, member, `/expenses/${e.id}/transition`, {
      version: 1,
      action: 'submit',
    });
    await expect(
      demoMutate(company, member, `/expenses/${e.id}/transition`, {
        version: 2,
        action: 'approve',
        note: 'Evidence exception has been independently verified.',
      }),
    ).rejects.toThrow(/own|approve|permission/i);
    await demoMutate(company, 'u-founder', `/expenses/${e.id}/transition`, {
      version: 2,
      action: 'approve',
      note: 'Evidence exception has been independently verified.',
    });
    expect((await state(e.id!)).status).toBe('approved');
    await demoMutate(company, 'u-founder', `/expenses/${e.id}/transition`, {
      version: 3,
      action: 'pay',
      paidDate: now(),
      paymentMethod: 'upi',
      paymentReference: 'BANK-REF-10001',
    });
    expect(await state(e.id!)).toMatchObject({ status: 'paid', amountMinor: 125050, version: 4 });
    await expect(
      demoMutate(company, 'u-founder', `/expenses/${e.id}/transition`, {
        version: 3,
        action: 'pay',
        paidDate: now(),
        paymentMethod: 'upi',
        paymentReference: 'REPLAY',
      }),
    ).rejects.toThrow(/changed|version/i);
    await expect(
      demoMutate(company, 'u-founder', `/expenses/${e.id}/transition`, {
        version: 4,
        action: 'void',
        note: 'This must never release paid funds.',
      }),
    ).rejects.toThrow(/paid|final|void/i);
    expect((await current()).financeEvents.filter((a) => a.entityId === e.id)).toHaveLength(4);
  });
  it('rejects overlapping budgets and activated period changes', async () => {
    const b = (await current()).budgets[0];
    await expect(
      demoMutate(company, 'u-founder', '/budgets', { ...b, name: 'Duplicate allocation' }),
    ).rejects.toThrow(/overlap/i);
    await expect(
      demoMutate(
        company,
        'u-founder',
        `/budgets/${b.id}`,
        { version: b.version, startDate: now(), reason: 'Moving an already activated period.' },
        'PATCH',
      ),
    ).rejects.toThrow(/period|boundar|activated/i);
  });
  it('requires a recorded independent budget override when no capacity remains', async () => {
    const e = await draft(600000);
    await demoMutate(company, member, `/expenses/${e.id}/transition`, {
      version: 1,
      action: 'submit',
    });
    await expect(
      demoMutate(company, 'u-founder', `/expenses/${e.id}/transition`, {
        version: 2,
        action: 'approve',
        note: 'Receipt exception verified independently.',
      }),
    ).rejects.toThrow(/budget|override/i);
    await demoMutate(company, 'u-founder', `/expenses/${e.id}/transition`, {
      version: 2,
      action: 'approve',
      note: 'Receipt exception verified independently.',
      overrideReason: 'Emergency site requirement approved by management.',
    });
    expect((await state(e.id!)).budgetOverrideReason).toContain('Emergency');
  });
  it('keeps personal finance scoped and locks currency after money is recorded', async () => {
    const e = await draft();
    const w = await current(member);
    expect(w.financeScope).toBe('personal');
    expect(w.budgets).toEqual([]);
    expect(w.expenses.map((x) => x.id)).toEqual([e.id]);
    await expect(
      demoMutate(company, 'u-founder', '', { currency: 'USD' }, 'PATCH'),
    ).rejects.toThrow(/currency|financial/i);
  });
  it('prevents duplicate invoices and rejects fractional minor units', async () => {
    const e = await draft();
    await demoMutate(
      company,
      member,
      `/expenses/${e.id}`,
      { version: 1, invoiceNumber: 'INV-44' },
      'PATCH',
    );
    await expect(
      demoMutate(company, member, '/expenses', {
        title: 'Duplicate invoice',
        vendor: 'sample   rail',
        invoiceNumber: 'inv-44',
        departmentId: department,
        categoryId: category,
        expenseDate: now(),
        amountMinor: 100,
      }),
    ).rejects.toThrow(/invoice|duplicate/i);
    await expect(draft(10.5)).rejects.toThrow(/integer|amount/i);
  });
});
