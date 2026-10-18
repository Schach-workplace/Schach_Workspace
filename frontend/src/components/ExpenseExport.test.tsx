// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ExpenseExportButton from './ExpenseExport';
const h = vi.hoisted(() => ({
  company: 'co',
  actor: 'me',
  basis: 'b',
  read: vi.fn(),
  download: vi.fn(),
  rows: [
    {
      id: 'e',
      version: 2,
      code: 'E1',
      title: 'Materials',
      expenseDate: '2026-10-18',
      currency: 'INR',
      amountMinor: '9007199254740993123',
      status: 'approved',
    },
  ],
}));
vi.mock('../store', () => ({
  useWorkspace: () => ({
    mode: 'api',
    companyId: h.company,
    session: { user: { id: h.actor } },
    data: { readBasis: h.basis },
  }),
}));
vi.mock('../data/execution', () => ({
  executionRead: h.read,
  useExecutionRead: (_p: string, enabled: boolean) => ({
    ready: enabled,
    data: enabled ? { rows: h.rows } : null,
  }),
}));
vi.mock('./UI', () => ({
  Modal: ({ children }: any) => <section>{children}</section>,
  downloadText: h.download,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.company = 'co';
  h.actor = 'me';
  h.basis = 'b';
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
function review() {
  render(<ExpenseExportButton expenses={[{ id: 'e', version: 2, title: 'Materials' }]} />);
  fireEvent.click(screen.getByText('Reviewed accounting CSV'));
  fireEvent.click(screen.getByText('Preview accounting CSV'));
  fireEvent.click(screen.getByLabelText('I reviewed these fields and accept the external copy'));
}
it.each(['current', 'stale', 'denied'])('checks current authority: %s', async (mode) => {
  h.read.mockImplementation(() =>
    mode === 'denied'
      ? Promise.reject(Error('Access denied'))
      : Promise.resolve({ rows: mode === 'stale' ? [{ ...h.rows[0], version: 3 }] : h.rows }),
  );
  review();
  fireEvent.click(screen.getByText('Download accounting CSV'));
  await waitFor(() => expect(h.read).toHaveBeenCalledOnce());
  if (mode === 'current') {
    await waitFor(() => expect(h.download).toHaveBeenCalledOnce());
    expect(h.download.mock.calls[0][1]).toContain('9007199254740993123');
  } else {
    await screen.findByRole('alert');
    expect(h.download).not.toHaveBeenCalled();
  }
});
it.each(['unmount', 'background'])('ignores delayed response after %s', async (mode) => {
  let resolve!: (v: unknown) => void;
  h.read.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  review();
  fireEvent.click(screen.getByText('Download accounting CSV'));
  if (mode === 'unmount') cleanup();
  else {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }
  resolve({ rows: h.rows });
  await Promise.resolve();
  expect(h.download).not.toHaveBeenCalled();
});
it('bounds selection and paginates', () => {
  render(
    <ExpenseExportButton
      expenses={Array.from({ length: 105 }, (_, i) => ({
        id: String(i),
        version: 1,
        title: `Expense ${i}`,
      }))}
    />,
  );
  fireEvent.click(screen.getByText('Reviewed accounting CSV'));
  expect(screen.getByText(/First 100 of 105/)).toBeTruthy();
  expect(screen.getAllByRole('checkbox')).toHaveLength(100);
  fireEvent.click(screen.getByText('Next expenses'));
  expect(screen.getAllByRole('checkbox')).toHaveLength(5);
  expect((screen.getByLabelText('Select Expense 100') as HTMLInputElement).disabled).toBe(true);
});

it('requires consent and prevents duplicate pending downloads', async () => {
  let resolve!: (v: unknown) => void;
  h.read.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  review();
  fireEvent.click(screen.getByText('Download accounting CSV'));
  fireEvent.click(screen.getByText('Download accounting CSV'));
  expect(h.read).toHaveBeenCalledOnce();
  resolve({ rows: h.rows });
  await waitFor(() => expect(h.download).toHaveBeenCalledOnce());
  expect(h.read.mock.calls[0][4]).toEqual({ expenses: [{ id: 'e', expectedVersion: 2 }] });
});
it('ignores delayed output after source version changes', async () => {
  let resolve!: (v: unknown) => void;
  h.read.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const view = render(
    <ExpenseExportButton expenses={[{ id: 'e', version: 2, title: 'Materials' }]} />,
  );
  fireEvent.click(screen.getByText('Reviewed accounting CSV'));
  fireEvent.click(screen.getByText('Preview accounting CSV'));
  fireEvent.click(screen.getByLabelText('I reviewed these fields and accept the external copy'));
  fireEvent.click(screen.getByText('Download accounting CSV'));
  view.rerender(<ExpenseExportButton expenses={[{ id: 'e', version: 3, title: 'Materials' }]} />);
  resolve({ rows: h.rows });
  await Promise.resolve();
  expect(h.download).not.toHaveBeenCalled();
  expect(screen.getByText('Preview accounting CSV')).toBeTruthy();
});

it.each(['company', 'actor', 'basis'] as const)(
  'ignores delayed output after %s changes',
  async (field) => {
    let resolve!: (v: unknown) => void;
    h.read.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const expenses = [{ id: 'e', version: 2, title: 'Materials' }];
    const view = render(<ExpenseExportButton expenses={expenses} />);
    fireEvent.click(screen.getByText('Reviewed accounting CSV'));
    fireEvent.click(screen.getByText('Preview accounting CSV'));
    fireEvent.click(screen.getByLabelText('I reviewed these fields and accept the external copy'));
    fireEvent.click(screen.getByText('Download accounting CSV'));
    h[field] = 'changed';
    view.rerender(<ExpenseExportButton expenses={expenses} />);
    resolve({ rows: h.rows });
    await Promise.resolve();
    expect(h.download).not.toHaveBeenCalled();
  },
);
