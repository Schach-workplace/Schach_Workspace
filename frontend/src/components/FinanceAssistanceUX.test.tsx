// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as React from 'react';
const h = vi.hoisted(() => ({
  store: {} as any,
  reads: {} as Record<string, any>,
  download: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../store', () => ({ useWorkspace: () => h.store }));
vi.mock('../data/executionInput', () => ({
  useExecutionInput: (_f: string, _k: string, v: any) => React.useState(v),
}));
vi.mock('../data/execution', async (original) => ({
  ...(await original<any>()),
  downloadFinanceFile: h.download,
  useExecutionRead: (path: string, enabled = true) => {
    if (!enabled) return { ready: false, loading: false, data: undefined, error: null };
    const key = Object.keys(h.reads).find((k) => path === k || path.startsWith(k + '?'));
    return key
      ? h.reads[key]
      : { ready: false, loading: true, data: undefined, error: null, retry: vi.fn() };
  },
}));
import FinanceAssistance from './FinanceAssistance';
const ok = (data: unknown) => ({ ready: true, loading: false, data, error: null, retry: vi.fn() });
function store(role: string, mode = 'api') {
  h.store = {
    mode,
    companyId: 'co',
    session: { user: { id: 'me' } },
    mutate: vi.fn(),
    data: {
      company: { id: 'co', currency: 'INR' },
      me: { id: 'me', role, departmentId: 'ops' },
      departments: [{ id: 'ops', name: 'Operations' }],
      expenses: [],
      people: [],
    },
  };
}
beforeEach(() => {
  h.reads = {};
  window.location.hash = '#finance';
});
afterEach(cleanup);

it('ignores a statement tool link for a role without finance authority', () => {
  store('member');
  h.reads = {
    '/finance/intakes': ok({ items: [] }),
    '/finance/receipt-extractions': ok({ items: [] }),
  };
  window.location.hash = '#finance?tool=statement';
  render(<FinanceAssistance onCreated={() => {}} />);
  const tools = screen.getByRole('navigation', { name: 'Finance assistance tools' });
  expect(within(tools).queryByRole('button', { name: 'Import bank CSV' })).toBeNull();
  expect(
    within(tools).getByRole('button', { name: 'Receipt extraction' }).getAttribute('aria-pressed'),
  ).toBe('true');
  expect(screen.queryByLabelText(/UTF-8 bank CSV/)).toBeNull();
  expect(screen.getByLabelText(/JPEG, PNG or PDF receipt/)).toBeTruthy();
});

it('marks the active tool for finance authority', () => {
  store('finance');
  h.reads = {
    '/finance/intakes': ok({ items: [] }),
    '/finance/receipt-extractions': ok({ items: [] }),
  };
  window.location.hash = '#finance?tool=statement';
  render(<FinanceAssistance onCreated={() => {}} />);
  expect(screen.getByRole('button', { name: 'Import bank CSV' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(
    screen.getByRole('button', { name: 'Receipt extraction' }).getAttribute('aria-pressed'),
  ).toBe('false');
});

it('shows loading, error and empty states for private sources and extraction requests', () => {
  store('member');
  render(<FinanceAssistance onCreated={() => {}} />);
  expect(screen.getByText('Checking your private sources…')).toBeTruthy();
  expect(screen.getByText('Checking your extraction requests…')).toBeTruthy();
  cleanup();
  h.reads = {
    '/finance/intakes': {
      ready: false,
      loading: false,
      error: new Error('Sources offline'),
      retry: vi.fn(),
    },
    '/finance/receipt-extractions': ok({ items: [] }),
  };
  render(<FinanceAssistance onCreated={() => {}} />);
  expect(screen.getByText('Sources offline')).toBeTruthy();
  expect(screen.getByText(/No extraction requests yet/)).toBeTruthy();
  cleanup();
  h.reads = {
    '/finance/intakes': ok({ items: [] }),
    '/finance/receipt-extractions': ok({ items: [] }),
  };
  render(<FinanceAssistance onCreated={() => {}} />);
  expect(screen.getByText(/No private files staged/)).toBeTruthy();
});

it('names extraction requests by source file, destination and request time', () => {
  store('member');
  h.reads = {
    '/finance/intakes': ok({
      items: [{ id: 'in1', fileName: 'taxi.pdf', state: 'clean', purpose: 'receipt', version: 1 }],
    }),
    '/finance/receipt-extractions': ok({
      items: [
        {
          id: 'job1',
          status: 'queued',
          sourceKind: 'intake',
          sourceId: 'in1',
          destinationDepartmentId: 'ops',
          createdAt: '2026-10-10T09:30:00Z',
          version: 1,
        },
        {
          id: 'job2',
          status: 'ready',
          sourceKind: 'expense_receipt',
          sourceId: 'r9',
          destinationDepartmentId: 'ops',
          createdAt: '2026-10-11T09:30:00Z',
          version: 1,
        },
      ],
    }),
  };
  render(<FinanceAssistance onCreated={() => {}} />);
  const requests = screen.getByRole('list', { name: 'Your extraction requests' });
  expect(
    within(requests).getByRole('button', { name: /taxi\.pdf.*Operations.*queued/ }),
  ).toBeTruthy();
  expect(
    within(requests).getByRole('button', { name: /Existing expense receipt.*Operations.*ready/ }),
  ).toBeTruthy();
});

it('explains up front that finance assistance needs a connected server in demo mode', () => {
  store('founder', 'demo');
  render(<FinanceAssistance onCreated={() => {}} />);
  expect(screen.getByText(/require a connected company server/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Reserve private file' })).toBeNull();
  expect(screen.queryByRole('navigation', { name: 'Finance assistance tools' })).toBeNull();
});

it('offers a download of the owner’s clean private intake only', async () => {
  store('member');
  h.reads = {
    '/finance/intakes': ok({ items: [] }),
    '/finance/receipt-extractions': ok({ items: [] }),
    '/finance/intakes/in1': ok({
      id: 'in1',
      fileName: 'taxi.pdf',
      state: 'clean',
      purpose: 'receipt',
      version: 2,
      expiresAt: '2026-10-20',
    }),
  };
  render(<FinanceAssistance onCreated={() => {}} initialIntake="in1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Download staged file' }));
  expect(h.download).toHaveBeenCalledWith('co', '/finance/intakes/in1/download', 'taxi.pdf');
  cleanup();
  h.reads['/finance/intakes/in1'] = ok({
    id: 'in1',
    fileName: 'taxi.pdf',
    state: 'scanning',
    purpose: 'receipt',
    version: 2,
  });
  render(<FinanceAssistance onCreated={() => {}} initialIntake="in1" />);
  expect(screen.queryByRole('button', { name: 'Download staged file' })).toBeNull();
});
