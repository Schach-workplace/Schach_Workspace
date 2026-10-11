// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  assessment: {} as any,
  execute: vi.fn().mockResolvedValue({}),
  ready: true,
}));
vi.mock('../store', () => ({
  useWorkspace: () => ({
    mode: 'api',
    companyId: 'outcome',
    session: { user: { id: 'actor' } },
    data: { company: { id: 'outcome', currency: 'INR' }, me: { role: 'finance' }, departments: [] },
  }),
}));
vi.mock('../data/executionInput', () => ({
  useExecutionInput: (_form: string, _field: string, value: any) => useState(value),
}));
vi.mock('../data/execution', () => ({
  useExecutionRead: (path: string) =>
    path === '/finance/intakes/source'
      ? {
          ready: h.ready,
          data: h.ready
            ? {
                id: 'source',
                state: 'scanning',
                version: 3,
                purpose: 'receipt',
                assessment: h.assessment,
              }
            : undefined,
          retry: vi.fn(),
        }
      : { ready: true, data: { items: [] } },
  useExecutionMutation: () => ({ execute: h.execute, busy: false }),
}));
import FinanceAssistance from './FinanceAssistance';
afterEach(cleanup);
it.each([
  ['rejected', 'scan_rejected', false],
  ['failed', 'scan_unavailable', true],
  ['failed', 'retry_exhausted', true],
])(
  'renders terminal %s/%s without endless scanning and permits only safe recovery',
  async (status, errorCode, retryable) => {
    h.assessment = { status, errorCode, retryable };
    h.execute.mockClear();
    h.ready = true;
    const mounted = render(<FinanceAssistance initialIntake="source" onCreated={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Check clean assessment' })).toBeNull();
    await screen.findByText(/remains quarantined/i);
    expect(screen.queryByRole('button', { name: 'Stage exact reserved file' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Extract this receipt' })).toBeNull();
    if (retryable) {
      fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable clean assessment' }));
      expect(h.execute).toHaveBeenCalledWith('/finance/intakes/source/finalize', {
        expectedVersion: 3,
        retryAssessment: true,
      });
    } else
      expect(
        screen.queryByRole('button', { name: 'Retry unavailable clean assessment' }),
      ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel private intake' }));
    expect(h.execute).toHaveBeenCalledWith('/finance/intakes/source/cancel', {
      expectedVersion: 3,
    });
    h.ready = false;
    mounted.rerender(<FinanceAssistance initialIntake="source" onCreated={() => {}} />);
    expect(screen.queryByText(/remains quarantined/i)).toBeNull();
  },
);
