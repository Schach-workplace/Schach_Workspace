// @vitest-environment happy-dom
// DOM workflow coverage. These tests do not verify browser layout.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType, ReactNode } from 'react';

let App: ComponentType;
let WorkspaceProvider: ComponentType<{ children: ReactNode }>;
let demo: typeof import('./data/demo');

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_DATA_MODE', 'demo');
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  window.scrollTo = vi.fn();
  demo = await import('./data/demo');
  await demo.resetDemo();
  ({ default: App } = await import('./App'));
  ({ WorkspaceProvider } = await import('./store'));
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

async function openFinance(email = 'founder@schach.demo') {
  await demo.demoLogin(email, 'SchachDemo!2026');
  render(
    <WorkspaceProvider>
      <App />
    </WorkspaceProvider>,
  );
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Finance' }));
}

describe('finance workflows (DOM simulation)', () => {
  it('gives leadership a financial year overview and department drilldown', async () => {
    await openFinance();
    expect(await screen.findByRole('region', { name: 'Financial year totals' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Financial year' })).toBeTruthy();
    const departments = screen.getByRole('region', { name: 'Department budgets' });
    const buttons = within(departments).getAllByRole('button', { name: /^View .* finances$/ });
    await userEvent.setup().click(buttons[0]);
    expect(screen.getByRole('button', { name: 'All departments' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Expense ledger' })).toBeTruthy();
  });

  it('keeps personal finance views free of incomplete department budget balances', async () => {
    await openFinance('member@schach.demo');
    expect(await screen.findByRole('heading', { name: 'Your expenses' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Financial year totals' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set budget' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Manage categories' })).toBeNull();
    expect(screen.getByRole('button', { name: 'New expense' })).toBeTruthy();
  });

  it('lets a department head find their own historical expenses after changing departments', async () => {
    const data = await demo.readDemoWorkspace('c-schach', 'u-head');
    const { todayInTimezone } = await import('./data/metrics');
    await demo.demoMutate('c-schach', 'u-head', '/expenses', {
      title: 'Previous department site visit',
      vendor: 'Site travel provider',
      departmentId: data.me.departmentId,
      categoryId: data.expenseCategories[0].id,
      expenseDate: todayInTimezone(data.company.timezone),
      amountMinor: 45000,
    });
    const nextDepartment = data.departments.find(
      (department) => department.id !== data.me.departmentId,
    )!;
    await demo.demoMutate(
      'c-schach',
      'u-founder',
      '/people/u-head',
      { departmentId: nextDepartment.id },
      'PATCH',
    );
    await openFinance('head@schach.demo');
    expect(screen.queryByRole('button', { name: /Previous department site visit/ })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'My expenses' }));
    expect(screen.getByRole('button', { name: /Previous department site visit/ })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Financial year totals' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Department budgets' })).toBeNull();
  });

  it('saves an exact decimal expense and submits it with a recorded receipt exception', async () => {
    await openFinance('member@schach.demo');
    const actor = userEvent.setup();
    await actor.click(screen.getByRole('button', { name: 'New expense' }));
    let dialog = await screen.findByRole('dialog');
    await actor.type(within(dialog).getByLabelText('Expense title'), 'Site visit rail travel');
    await actor.type(within(dialog).getByLabelText('Vendor / payee'), 'Rail travel provider');
    await actor.type(within(dialog).getByLabelText(/^Amount/), '1234.56');
    const category = within(dialog).getByLabelText('Expense category') as HTMLSelectElement;
    const travel = Array.from(category.options).find((option) => option.text === 'Travel')!;
    await actor.selectOptions(category, travel.value);
    await actor.type(
      within(dialog).getByLabelText(/^Receipt exception reason \(optional\)/),
      'The original ticket was retained by the project client.',
    );
    await actor.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog').textContent).toContain('Site visit rail travel'),
    );
    dialog = screen.getByRole('dialog');
    await actor.click(await within(dialog).findByRole('button', { name: 'Submit for approval' }));
    await waitFor(async () => {
      const data = await demo.readDemoWorkspace('c-schach', 'u-member');
      const expense = data.expenses.find((item) => item.title === 'Site visit rail travel');
      expect(expense).toMatchObject({
        amountMinor: 123456,
        status: 'submitted',
        createdBy: 'u-member',
      });
    });
    expect(within(dialog).queryByRole('button', { name: 'Approve expense' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Record payment' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Withdraw to draft' })).toBeTruthy();
  });

  it('links an accessible department task without adding an ineligible project', async () => {
    const data = await demo.readDemoWorkspace('c-schach', 'u-member');
    const task = data.tasks.find(
      (entry) => entry.departmentId === data.me.departmentId && entry.projectId,
    )!;
    await demo.demoMutate(
      'c-schach',
      'u-founder',
      `/projects/${task.projectId}`,
      { departmentId: '' },
      'PATCH',
    );
    await openFinance('member@schach.demo');
    const actor = userEvent.setup();
    await actor.click(screen.getByRole('button', { name: 'New expense' }));
    const dialog = await screen.findByRole('dialog');
    await actor.type(within(dialog).getByLabelText('Expense title'), 'Department task expense');
    await actor.type(within(dialog).getByLabelText('Vendor / payee'), 'Department task supplier');
    await actor.type(within(dialog).getByLabelText(/^Amount/), '20.00');
    await actor.selectOptions(within(dialog).getByLabelText(/^Related task/), task.id);
    await actor.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    await waitFor(async () => {
      const saved = (await demo.readDemoWorkspace('c-schach', 'u-member')).expenses.find(
        (entry) => entry.title === 'Department task expense',
      );
      expect(saved).toMatchObject({ taskId: task.id, projectId: '' });
    });
  });

  it('validates expense title limits by Unicode characters without truncating valid text', async () => {
    await openFinance('member@schach.demo');
    const actor = userEvent.setup();
    await actor.click(screen.getByRole('button', { name: 'New expense' }));
    const dialog = await screen.findByRole('dialog');
    const title = within(dialog).getByLabelText('Expense title') as HTMLInputElement;
    await actor.click(title);
    await actor.paste('A'.repeat(241));
    await actor.type(within(dialog).getByLabelText('Vendor / payee'), 'Unicode field supplier');
    await actor.type(within(dialog).getByLabelText(/^Amount/), '10.00');
    await actor.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    expect(
      await within(dialog).findByText('Expense title must contain at most 240 characters.'),
    ).toBeTruthy();
    await actor.clear(title);
    const validTitle = '🧾'.repeat(240);
    await actor.paste(validTitle);
    expect(title.value).toBe(validTitle);
    await actor.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    await waitFor(async () => {
      const saved = (await demo.readDemoWorkspace('c-schach', 'u-member')).expenses.find(
        (entry) => entry.vendor === 'Unicode field supplier',
      );
      expect(saved?.title).toBe(validTitle);
    });
  });

  it('records an independent approval and payment without consuming the budget twice', async () => {
    const data = await demo.readDemoWorkspace('c-schach', 'u-founder');
    const finance = await import('./data/finance');
    const { todayInTimezone } = await import('./data/metrics');
    const year =
      finance.fiscalYearStart(
        todayInTimezone(data.company.timezone),
        data.company.fiscalYearStartMonth,
      ) - 2;
    const range = finance.fiscalYearRange(year, data.company.fiscalYearStartMonth);
    await demo.demoMutate('c-schach', 'u-founder', '/budgets', {
      name: 'Finance workflow verification budget',
      departmentId: 'd-eng',
      ...range,
      amountMinor: 500000,
      status: 'active',
      notes: '',
    });
    const category = data.expenseCategories.find((entry) => entry.name === 'Travel')!;
    const created = await demo.demoMutate('c-schach', 'u-member', '/expenses', {
      title: 'Independent payment workflow expense',
      vendor: 'Finance workflow supplier',
      departmentId: 'd-eng',
      categoryId: category.id,
      expenseDate: range.startDate,
      amountMinor: 123456,
      receiptExceptionReason: 'The receipt was retained by the client for their project record.',
    });
    await demo.demoMutate('c-schach', 'u-member', `/expenses/${created.id}/transition`, {
      version: 1,
      action: 'submit',
    });
    await openFinance();
    const actor = userEvent.setup();
    await actor.selectOptions(
      screen.getByRole('combobox', { name: 'Financial year' }),
      String(year),
    );
    await actor.click(screen.getByRole('button', { name: /Independent payment workflow expense/ }));
    const dialog = await screen.findByRole('dialog');
    await actor.click(within(dialog).getByRole('button', { name: 'Review & approve' }));
    expect((within(dialog).getByLabelText(/^Approval note/) as HTMLTextAreaElement).required).toBe(
      true,
    );
    await actor.type(
      within(dialog).getByLabelText(/^Approval note/),
      'I reviewed the client confirmation and accept this receipt exception.',
    );
    await actor.click(within(dialog).getByRole('button', { name: 'Approve expense' }));
    await waitFor(async () => {
      const approved = (await demo.readDemoWorkspace('c-schach', 'u-founder')).expenses.find(
        (entry) => entry.id === created.id,
      );
      expect(approved?.status).toBe('approved');
    });
    const balance = finance.formatMoney(376544, data.company.currency);
    expect(
      within(screen.getByRole('region', { name: 'Financial year totals', hidden: true })).getByText(
        balance,
      ),
    ).toBeTruthy();
    await actor.click(await within(dialog).findByRole('button', { name: 'Record payment' }));
    await actor.type(within(dialog).getByLabelText(/^Payment reference/), 'BANK-TEST-1048');
    await actor.click(within(dialog).getByRole('button', { name: 'Confirm payment record' }));
    await waitFor(async () => {
      const paid = (await demo.readDemoWorkspace('c-schach', 'u-founder')).expenses.find(
        (entry) => entry.id === created.id,
      );
      expect(paid).toMatchObject({
        status: 'paid',
        amountMinor: 123456,
        paymentReference: 'BANK-TEST-1048',
        paidBy: 'u-founder',
      });
    });
    expect(
      within(screen.getByRole('region', { name: 'Financial year totals', hidden: true })).getByText(
        balance,
      ),
    ).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Record payment' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Edit expense' })).toBeNull();
    expect(within(dialog).getByRole('heading', { name: 'Recorded payment' })).toBeTruthy();
  });

  it('requires a fresh review after a receipt is appended and preserves exception acknowledgement', async () => {
    const data = await demo.readDemoWorkspace('c-schach', 'u-member');
    const { todayInTimezone } = await import('./data/metrics');
    const category = data.expenseCategories.find((entry) => entry.name === 'Travel')!;
    const created = await demo.demoMutate('c-schach', 'u-member', '/expenses', {
      title: 'Receipt arriving during independent review',
      vendor: 'Receipt workflow travel provider',
      departmentId: data.me.departmentId,
      categoryId: category.id,
      expenseDate: todayInTimezone(data.company.timezone),
      amountMinor: 2800,
      receiptExceptionReason: 'The supplier initially sent only a payment confirmation.',
    });
    await demo.demoMutate('c-schach', 'u-member', `/expenses/${created.id}/transition`, {
      version: 1,
      action: 'submit',
    });
    await openFinance();
    const actor = userEvent.setup();
    await actor.click(
      screen.getByRole('button', { name: /Receipt arriving during independent review/ }),
    );
    const dialog = await screen.findByRole('dialog');
    await actor.click(within(dialog).getByRole('button', { name: 'Review & approve' }));
    await actor.upload(
      within(dialog).getByLabelText('Upload expense receipt'),
      new File(['Supplier receipt: travel, INR 28.00'], 'travel-receipt.txt', {
        type: 'text/plain',
      }),
    );
    await waitFor(async () => {
      const expense = (await demo.readDemoWorkspace('c-schach', 'u-founder')).expenses.find(
        (entry) => entry.id === created.id,
      )!;
      expect(expense.version).toBe(3);
      expect(expense.receipts).toHaveLength(1);
      expect(expense.status).toBe('submitted');
    });
    expect(
      await within(dialog).findByText('This expense changed while you were reviewing it.'),
    ).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: 'Approve expense' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      within(dialog).getByRole('button', { name: 'Download travel-receipt.txt' }),
    ).toBeTruthy();
    await actor.click(within(dialog).getByRole('button', { name: 'Review latest version' }));
    await actor.click(within(dialog).getByRole('button', { name: 'Review & approve' }));
    expect((within(dialog).getByLabelText(/^Approval note/) as HTMLTextAreaElement).required).toBe(
      true,
    );
    await actor.type(
      within(dialog).getByLabelText(/^Approval note/),
      'Reviewed the later receipt and acknowledged the original recorded exception.',
    );
    await actor.click(within(dialog).getByRole('button', { name: 'Approve expense' }));
    await waitFor(async () => {
      const expense = (await demo.readDemoWorkspace('c-schach', 'u-founder')).expenses.find(
        (entry) => entry.id === created.id,
      )!;
      expect(expense.status).toBe('approved');
      expect(expense.version).toBe(4);
    });
  });

  it('preserves an explained budget revision and its fixed period in visible finance history', async () => {
    const data = await demo.readDemoWorkspace('c-schach', 'u-founder');
    const finance = await import('./data/finance');
    const { todayInTimezone } = await import('./data/metrics');
    const year =
      finance.fiscalYearStart(
        todayInTimezone(data.company.timezone),
        data.company.fiscalYearStartMonth,
      ) + 1;
    await openFinance();
    const actor = userEvent.setup();
    await actor.selectOptions(
      screen.getByRole('combobox', { name: 'Financial year' }),
      String(year),
    );
    await actor.click(screen.getByRole('button', { name: 'Set budget' }));
    let dialog = await screen.findByRole('dialog');
    await actor.type(
      within(dialog).getByLabelText('Budget name'),
      'Next year engineering allocation',
    );
    await actor.selectOptions(within(dialog).getByLabelText('Budget department'), 'd-eng');
    await actor.type(within(dialog).getByLabelText(/^Budget amount/), '5000.00');
    await actor.click(within(dialog).getByRole('button', { name: 'Create budget' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const budget = (await demo.readDemoWorkspace('c-schach', 'u-founder')).budgets.find(
      (entry) => entry.name === 'Next year engineering allocation',
    )!;
    expect(budget).toMatchObject({
      amountMinor: 500000,
      status: 'active',
      ...finance.fiscalYearRange(year, data.company.fiscalYearStartMonth),
    });
    const department = data.departments.find((entry) => entry.id === 'd-eng')!;
    await actor.click(screen.getByRole('button', { name: `View ${department.name} finances` }));
    await actor.click(
      screen.getByRole('button', { name: 'Edit Next year engineering allocation budget' }),
    );
    dialog = await screen.findByRole('dialog');
    expect(
      (within(dialog).getByLabelText(/^Budget department/) as HTMLSelectElement).disabled,
    ).toBe(true);
    expect((within(dialog).getByLabelText('Budget starts') as HTMLInputElement).disabled).toBe(
      true,
    );
    const amount = within(dialog).getByLabelText(/^Budget amount/);
    await actor.clear(amount);
    await actor.type(amount, '6000.00');
    await actor.type(
      within(dialog).getByLabelText(/^Reason for budget change/),
      'Expanded engineering scope approved for the new year.',
    );
    await actor.click(within(dialog).getByRole('button', { name: 'Save budget' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      (await demo.readDemoWorkspace('c-schach', 'u-founder')).budgets.find(
        (entry) => entry.id === budget.id,
      ),
    ).toMatchObject({ amountMinor: 600000, version: 2 });
    await actor.click(screen.getByText('Recent finance history'));
    expect(screen.getByText(/Expanded engineering scope approved for the new year/)).toBeTruthy();
  });
});
