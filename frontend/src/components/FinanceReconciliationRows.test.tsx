// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as React from 'react';
const h = vi.hoisted(() => ({
  role: 'finance',
  download: vi.fn().mockResolvedValue(undefined),
  reads: [] as string[],
}));
vi.mock('../store', () => ({
  useWorkspace: () => ({ data: { company: { id: 'co' }, me: { role: h.role } } }),
}));
vi.mock('../data/executionInput', () => ({
  useExecutionInput: (_f: string, _k: string, v: any) => React.useState(v),
}));
vi.mock('../data/execution', () => ({
  downloadFinanceFile: h.download,
  useExecutionMutation: () => ({ execute: vi.fn(), busy: false, error: '' }),
  useExecutionRead: (path: string, enabled = true) => {
    if (!enabled) return { ready: false, loading: false };
    h.reads.push(path);
    if (path === '/finance/statement-imports')
      return {
        ready: true,
        data: {
          items: [{ id: 'imp', rowCount: 1, createdAt: '2026-10-10T09:00:00Z', version: 1 }],
        },
      };
    if (path === '/finance/statement-imports/imp/rows')
      return {
        ready: true,
        data: {
          items: [
            {
              id: 'r1',
              importId: 'imp',
              recordOrdinal: 1,
              bookedDate: '2026-10-09',
              currency: 'INR',
              signedAmountMinor: -130050,
              reference: 'UTR-77',
              description: 'Fictional supplier',
            },
          ],
        },
      };
    return { ready: true, data: { items: [], unallocatedExpenses: [], allocations: [] } };
  },
}));
import FinanceReconciliation from './FinanceReconciliation';
afterEach(cleanup);
it('shows an empty queue, then reads and exports one import’s records on request', () => {
  h.role = 'finance';
  h.reads = [];
  render(<FinanceReconciliation />);
  expect(screen.getByText(/No statement records in this queue/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Statement import'), { target: { value: 'imp' } });
  expect(h.reads).not.toContain('/finance/statement-imports/imp/rows');
  fireEvent.click(screen.getByRole('button', { name: 'View imported records' }));
  expect(screen.getByRole('cell', { name: 'UTR-77' })).toBeTruthy();
  expect(screen.getByRole('cell', { name: /1,300\.50/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Export imported records (CSV)' }));
  expect(h.download).toHaveBeenCalledWith(
    'co',
    '/finance/statement-imports/imp/export',
    'statement-imp.csv',
  );
});
it('offers nothing to roles without finance authority', () => {
  h.role = 'member';
  render(<FinanceReconciliation initialImport="imp" />);
  expect(screen.queryByRole('button', { name: /imported records/ })).toBeNull();
});
