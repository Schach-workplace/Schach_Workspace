// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ store: {} as any, matched: false, reversed: false, denied: false, posts: [] as any[], matchEffects: 0, reversalEffects: 0 }));
vi.mock('../store', () => ({ useWorkspace: () => h.store }));
vi.mock('../data/execution', async (original) => ({ ...(await original<any>()), useExecutionRead: (path: string, enabled = true) => {
  if (!enabled) return { ready: false };
  if (h.denied) return { ready: false, error: Error('Current source denied') };
  if (path.startsWith('/finance/statement-imports')) return { ready: true, data: { items: [] } };
  return { ready: true, retry: vi.fn(), data: {
    items: [{ row: { id: 'ack-row', importId: 'imp', recordOrdinal: 2, bookedDate: '2026-10-10', signedAmountMinor: -130050, currency: 'INR', version: h.matched ? 2 : 1 }, suggestions: [], suggestionBasis: 'basis', history: [] }],
    unallocatedExpenses: h.matched && !h.reversed ? [] : [{ id: 'paid', title: 'Paid source', amountMinor: 130050, currency: 'INR', version: 4 }],
    allocations: h.matched ? [{ id: 'ack-allocation', active: !h.reversed, version: h.reversed ? 2 : 1, reason: 'Reviewed original payment' }] : [],
  } };
} }));
import FinanceReconciliation from './FinanceReconciliation';
afterEach(cleanup);
it('reopens frozen match and reversal after each real effect and lost ACK despite changed first-write eligibility', async () => {
  h.matched = false; h.reversed = false; h.denied = false; h.posts = []; h.matchEffects = 0; h.reversalEffects = 0;
  h.store = { mode: 'api', companyId: 'reconciliation-ack', session: { user: { id: 'actor' } }, data: { me: { role: 'finance' } }, mutate: vi.fn(async (path, payload, method, committed) => {
    h.posts.push({ path, payload, method });
    if (path === '/finance/reconciliation/matches') {
      if (!h.matched) { h.matched = true; h.matchEffects++; throw new TypeError('Committed match ACK lost'); }
    } else if (path.endsWith('/unmatch')) {
      if (!h.reversed) { h.reversed = true; h.reversalEffects++; throw new TypeError('Committed reversal ACK lost'); }
    }
    const result = { id: 'ack-allocation' }; committed?.(result); return result;
  }) };
  let mounted = render(<FinanceReconciliation />);
  fireEvent.change(screen.getByLabelText('Recorded paid expense'), { target: { value: 'paid' } });
  fireEvent.change(screen.getByLabelText('Accounting review reason'), { target: { value: 'Reviewed full fictional paid amount' } });
  fireEvent.click(screen.getByRole('button', { name: 'Match full recorded payment' }));
  await screen.findByText(/Committed match ACK lost/);
  mounted.unmount(); mounted = render(<FinanceReconciliation />);
  const retryMatch = screen.getByRole('button', { name: /Retry same.*match/i });
  expect(retryMatch.hasAttribute('disabled')).toBe(false);
  fireEvent.click(retryMatch); await vi.waitFor(() => expect(h.posts).toHaveLength(2));
  expect(h.posts[1]).toEqual(h.posts[0]); expect(h.matchEffects).toBe(1);
  fireEvent.change(screen.getByLabelText('Reversal reason'), { target: { value: 'Reviewed fictional reversal preserves payment' } });
  fireEvent.click(screen.getByRole('button', { name: 'Unmatch reviewed association' }));
  await screen.findByText(/Committed reversal ACK lost/);
  mounted.unmount(); mounted = render(<FinanceReconciliation />);
  const retryReversal = screen.getByRole('button', { name: /Retry same.*unmatch/i });
  expect(retryReversal.hasAttribute('disabled')).toBe(false); fireEvent.click(retryReversal);
  await vi.waitFor(() => expect(h.posts).toHaveLength(4));
  expect(h.posts[3]).toEqual(h.posts[2]); expect(h.reversalEffects).toBe(1);
  h.denied = true; mounted.rerender(<FinanceReconciliation />);
  expect(screen.queryByRole('button', { name: /Retry same.*match/i })).toBeNull();
});
