// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ execute: vi.fn(), read: {} as any }));
vi.mock('../store', () => ({
  useWorkspace: () => ({
    data: {
      me: { role: 'founder' },
      expenses: [{ id: 'expense', title: 'Fictional draft', version: 3 }],
    },
  }),
}));
vi.mock('../data/execution', () => ({
  useExecutionRead: (path: string) =>
    path.endsWith('/candidate')
      ? { ready: true, data: { id: 'candidate', reason: 'same_vendor_amount_date', version: 1 } }
      : h.read,
  useExecutionMutation: () => ({ execute: h.execute, error: '', busy: false }),
}));
vi.mock('../data/executionInput', () => ({
  useExecutionInput: (_f: string, _k: string, v: any) => requireReact.useState(v),
}));
import * as requireReact from 'react';
import FinanceDuplicateReview from './FinanceDuplicateReview';
afterEach(cleanup);
it('requires a deliberate current suggestion and meaningful dismissal reason', () => {
  h.read = {
    ready: true,
    data: {
      items: [
        {
          id: 'candidate',
          sourceId: 'expense',
          comparedExpenseId: 'peer',
          reason: 'same_vendor_amount_date',
          version: 1,
        },
      ],
    },
  };
  render(<FinanceDuplicateReview />);
  expect(h.execute).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Fictional draft · Expense/ }));
  expect(screen.getByRole('button', { name: /Dismiss/ }).hasAttribute('disabled')).toBe(true);
});
