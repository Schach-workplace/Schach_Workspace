// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import HistoricalReports from './HistoricalReports';
import SavedReports from './SavedReports';
import sample from '../data/sample.json';
import { clearAllBusinessAttempts } from '../../../shared/business/attempts';
import { clearAllDrafts } from '../communication/drafts';
import { fetchHistoricalCSV } from '../data/api';
const s = vi.hoisted(() => ({ store: {} as any }));
vi.mock('../store', () => ({ useWorkspace: () => s.store }));
beforeEach(() => {
  clearAllBusinessAttempts();
  clearAllDrafts();
  s.store = {
    data: sample.workspaces[0],
    mode: 'api',
    companyId: 'c-schach',
    session: { user: { id: 'u-founder' } },
    mutate: vi
      .fn()
      .mockRejectedValueOnce(Error('Lost response'))
      .mockResolvedValue({ snapshotId: 'saved' }),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (path: string) =>
        new Response(
          JSON.stringify(
            path.includes('/recipients')
              ? { recipients: [{ id: 'u-founder', name: 'Founder' }] }
              : path.includes('/rows')
                ? { rows: [], cursor: '' }
                : path.endsWith('/definitions')
                  ? { definitions: [], orphans: [] }
                  : {
                      orphans: [],
                      snapshot: {
                        id: 'saved',
                        request: { reportZone: 'Asia/Kolkata' },
                        summary: { metrics: {}, coverage: [] },
                        rowCount: 0,
                      },
                    },
          ),
        ),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const wrap = (view: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{view}</QueryClientProvider>
);
it('retries the exact historical capture after lost ACK and remount despite new authored dates', async () => {
  let view = render(wrap(<HistoricalReports onTask={() => {}} />));
  fireEvent.change(screen.getByLabelText('Historical start date'), {
    target: { value: '2026-09-01' },
  });
  fireEvent.change(screen.getByLabelText('Historical end date'), {
    target: { value: '2026-09-30' },
  });
  fireEvent.click(screen.getByText('Generate historical report'));
  await screen.findByText('Lost response');
  const first = s.store.mutate.mock.calls[0][1];
  view.unmount();
  view = render(wrap(<HistoricalReports onTask={() => {}} />));
  fireEvent.change(screen.getByLabelText('Historical end date'), {
    target: { value: '2026-09-20' },
  });
  fireEvent.click(screen.getByText('Retry same report generation'));
  await waitFor(() => expect(s.store.mutate).toHaveBeenCalledTimes(2));
  expect(s.store.mutate.mock.calls[1][1]).toEqual(first);
});
it('keeps the reviewed saved configuration and original retry key across dismissal', async () => {
  let view = render(wrap(<SavedReports onOpen={() => {}} />));
  await screen.findByText('Founder');
  fireEvent.change(screen.getByLabelText('Report name'), { target: { value: 'Monthly review' } });
  fireEvent.click(screen.getByText('Review definition'));
  fireEvent.click(screen.getByText('Confirm saved report'));
  await screen.findByText('Lost response');
  const first = s.store.mutate.mock.calls[0][1];
  view.unmount();
  s.store.mutate.mockResolvedValue({ definition: { id: 'def', version: 1 } });
  view = render(wrap(<SavedReports onOpen={() => {}} />));
  await screen.findByText('Founder');
  expect((screen.getByLabelText('Report name') as HTMLInputElement).value).toBe('Monthly review');
  fireEvent.click(screen.getByText('Retry same definition save'));
  await waitFor(() => expect(s.store.mutate).toHaveBeenCalledTimes(2));
  expect(s.store.mutate.mock.calls[1][1]).toEqual(first);
});
it('discards a partial authenticated CSV instead of creating a usable export', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('partial')),
  );
  await expect(fetchHistoricalCSV('/private', new AbortController().signal, 100)).rejects.toThrow(
    /incomplete/,
  );
});
