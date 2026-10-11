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
