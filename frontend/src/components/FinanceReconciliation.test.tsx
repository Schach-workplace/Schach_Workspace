// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as React from 'react';
const h = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../store', () => ({ useWorkspace: () => ({ data: { me: { role: 'finance' } } }) }));
vi.mock('../data/executionInput', () => ({
  useExecutionInput: (_f: string, _k: string, v: any) => React.useState(v),
}));
vi.mock('../data/execution', () => ({
  useExecutionRead: (path: string) =>
    path.startsWith('/finance/statement-imports')
      ? { ready: true, data: { items: [] } }
      : {
          ready: true,
          data: {
            items: [
              {
                row: {
                  id: 'row',
                  importId: 'imp',
                  recordOrdinal: 2,
                  bookedDate: '2026-10-10',
                  signedAmountMinor: -130050,
                  currency: 'INR',
                  version: 1,
                },
                suggestions: [
                  { expenseId: 'expense', expenseVersion: 4, reason: 'exact_payment_reference' },
                ],
                suggestionBasis: 'basis',
                history: [],
              },
            ],
            unallocatedExpenses: [
              {
                id: 'expense',
                title: 'Fictional paid expense',
                amountMinor: 130050,
                currency: 'INR',
                version: 4,
              },
            ],
            allocations: [],
          },
        },
  useExecutionMutation: () => ({ execute: h.execute, busy: false, error: '' }),
}));
import FinanceReconciliation from './FinanceReconciliation';
afterEach(cleanup);
it('leaves a suggested full payment unselected until the user reviews it and gives a reason', () => {
  render(<FinanceReconciliation />);
  const match = screen.getByRole('button', { name: 'Match full recorded payment' });
  expect(match.hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText('Recorded paid expense'), {
    target: { value: 'expense' },
  });
  expect(match.hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText('Accounting review reason'), {
    target: { value: 'Reviewed fictional payment record' },
  });
  expect(match.hasAttribute('disabled')).toBe(false);
  expect(h.execute).not.toHaveBeenCalled();
});
