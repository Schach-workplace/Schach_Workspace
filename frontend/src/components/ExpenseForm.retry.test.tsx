// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ExpenseForm } from './FinanceForms';
const s = vi.hoisted(() => ({ store: {} as any }));
vi.mock('../store', () => ({ useWorkspace: () => s.store }));
afterEach(cleanup);
it('freezes the exact keyed ordinary expense create across unknown ACK', async () => {
  s.store = {
    mode: 'api',
    companyId: 'c',
    session: { user: { id: 'u' } },
    data: {
      company: { id: 'c', currency: 'INR', timezone: 'Asia/Kolkata' },
      me: { id: 'u', role: 'founder', departmentId: 'd' },
      departments: [{ id: 'd', name: 'Finance' }],
      expenseCategories: [{ id: 'cat', name: 'Materials', active: true }],
      expenses: [],
      tasks: [],
      projects: [],
    },
    mutate: vi.fn().mockRejectedValue(Error('Unknown response')),
  };
  render(<ExpenseForm onClose={() => {}} onSaved={() => {}} />);
  fireEvent.change(screen.getByLabelText('Expense title'), {
    target: { value: 'Fictional supplies' },
  });
  fireEvent.change(screen.getByLabelText('Vendor / payee'), {
    target: { value: 'Demo Stationery' },
  });
  fireEvent.change(screen.getByLabelText(/^Amount \(INR\)/), { target: { value: '1300.50' } });
  fireEvent.change(screen.getByLabelText('Expense category'), { target: { value: 'cat' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText(/Unknown response/);
  const payload = s.store.mutate.mock.calls[0][1];
  expect(payload.retryKey).toBeTruthy();
  expect(payload.amountMinor).toBe(130050);
  fireEvent.click(screen.getByRole('button', { name: /Retry same draft/ }));
  await screen.findByText(/Unknown response/);
  expect(s.store.mutate.mock.calls[1][1]).toEqual(payload);
});

it('restores original inspected CAS with edits until deliberate re-review and retires the saved draft', async () => {
  const first: any = {
    id: 'expense-cas-recovery',
    version: 1,
    title: 'Inspected title',
    vendor: 'Demo',
    description: 'Inspected details',
    departmentId: 'd',
    categoryId: 'cat',
    expenseDate: '2026-10-10',
    amountMinor: 130050,
    currency: 'INR',
    receipts: [],
  };
  s.store = {
    mode: 'api',
    companyId: 'cas-company',
    session: { user: { id: 'cas-user' } },
    data: {
      company: { id: 'cas-company', currency: 'INR', timezone: 'Asia/Kolkata' },
      me: { id: 'cas-user', role: 'founder', departmentId: 'd' },
      departments: [{ id: 'd', name: 'Finance' }],
      expenseCategories: [{ id: 'cat', name: 'Materials', active: true }],
      expenses: [first],
      tasks: [],
      projects: [],
    },
    mutate: vi.fn().mockResolvedValue({ id: first.id }),
    refresh: vi.fn().mockResolvedValue(undefined),
  };
  const props = { onClose: () => {}, onSaved: vi.fn() };
  const initial = render(<ExpenseForm {...props} item={first} />);
  fireEvent.change(screen.getByLabelText('Expense title'), {
    target: { value: 'Authored on version one' },
  });
  initial.unmount();
  const second = {
    ...first,
    version: 2,
    title: 'Intervening title',
    description: 'Intervening details',
  };
  s.store.data.expenses = [second];
  const reopened = render(<ExpenseForm {...props} item={second} />);
  expect((screen.getByLabelText('Expense title') as HTMLInputElement).value).toBe(
    'Authored on version one',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('This expense changed. Load the latest version before saving.');
  expect(s.store.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Load latest version' }));
  await screen.findByDisplayValue('Intervening title');
  fireEvent.change(screen.getByLabelText('Expense title'), {
    target: { value: 'Explicit version two edit' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await vi.waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(first.id));
  expect(s.store.mutate.mock.calls[0][1]).toMatchObject({
    version: 2,
    description: 'Intervening details',
  });
  reopened.unmount();
  const third = { ...second, version: 3, title: 'Confirmed server title' };
  s.store.data.expenses = [third];
  render(<ExpenseForm {...props} item={third} />);
  expect((screen.getByLabelText('Expense title') as HTMLInputElement).value).toBe(
    'Confirmed server title',
  );
});
