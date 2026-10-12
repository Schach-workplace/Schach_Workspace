// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as React from 'react';
const h = vi.hoisted(() => ({ execute: vi.fn(), previews: [] as any[] }));
vi.mock('../store', () => ({
  useWorkspace: () => ({
    data: {
      company: { id: 'co', currency: 'INR' },
      me: { id: 'me', role: 'member' },
      departments: [{ id: 'ops', name: 'Operations' }],
      expenseCategories: [{ id: 'travel', name: 'Travel', active: true }],
      projects: [],
      tasks: [],
      people: [],
      expenses: [{ id: 'peer', title: 'Earlier taxi' }],
    },
  }),
}));
vi.mock('../data/executionInput', () => ({
  useExecutionInput: (_f: string, _k: string, v: any) =>
    React.useState(typeof v === 'function' ? v() : v),
}));
vi.mock('../data/execution', () => ({
  useExecutionMutation: () => ({ execute: h.execute, busy: false, error: '' }),
  useExecutionRead: (path: string, enabled = true, body?: unknown) => {
    if (!enabled) return { ready: false, loading: false };
    if (path === '/finance/duplicates/preview') {
      h.previews.push(body);
      return {
        ready: true,
        data: {
          items: [{ comparedExpenseId: 'peer', reason: 'same_vendor_amount_date' }],
          hasMoreComparisons: false,
          nextComparisonCursor: '',
        },
      };
    }
    if (path.endsWith('/accept-preview')) return { ready: false, loading: true };
    return {
      ready: true,
      data: {
        job: {
          id: 'job',
          status: 'ready',
          sourceKind: 'intake',
          sourceId: 'in',
          destinationDepartmentId: 'ops',
          version: 1,
        },
        result: {
          revision: 4,
          engine: 'tesseract',
          engineVersion: '5',
          language: 'eng',
          candidates: { fields: { vendor: ['Fictional Cabs'] }, unresolved: [] },
        },
      },
    };
  },
}));
import ReceiptExtractionReview from './ReceiptExtractionReview';
afterEach(cleanup);
it('previews possible duplicates of the exact reviewed draft without accepting anything', () => {
  render(<ReceiptExtractionReview jobId="job" onCreated={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Preview possible duplicates' })).toBeNull();
  const set = (label: RegExp | string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  set('Reviewed title', 'Airport taxi');
  set('Reviewed vendor', 'Fictional Cabs');
  set('Reviewed expense date', '2026-10-09');
  set(/Reviewed amount/, '1300.50');
  set('Reviewed destination department', 'ops');
  set('Reviewed category', 'travel');
  fireEvent.click(screen.getByRole('button', { name: 'Review exact draft and evidence audience' }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview possible duplicates' }));
  expect(screen.getByText(/Possible duplicate of Earlier taxi/)).toBeTruthy();
  const body = h.previews.at(-1);
  expect(body).toMatchObject({ sourceExtractionId: 'job', expectedResultRevision: 4 });
  expect(body.fields.amountMinor).toBe(130050);
  expect(h.execute).not.toHaveBeenCalled();
});
