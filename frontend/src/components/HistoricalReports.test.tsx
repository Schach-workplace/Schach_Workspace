// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi, afterEach } from 'vitest';
import { ReportsPage } from '../pages/GoalsReports';
import sample from '../data/sample.json';
import HistoricalReports from './HistoricalReports';
const env = vi.hoisted(() => ({ mode: 'demo' as 'api' | 'demo' }));
vi.mock('../store', () => ({
  useWorkspace: () => ({
    data: sample.workspaces[0],
    companyId: sample.workspaces[0].company.id,
    session: { user: { id: sample.workspaces[0].me.id } },
    mode: env.mode,
    notify: vi.fn(),
  }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  env.mode = 'demo';
});
it('offers an explicit historical basis without inventing demo task history', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReportsPage onTask={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Historical reports' }));
  expect(screen.getByText(/Historical reports require a connected company server/)).toBeTruthy();
  expect(screen.queryByText('Current-state report')).toBeNull();
});

it('displays the current report as the default basis', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReportsPage onTask={() => {}} />
    </QueryClientProvider>,
  );
  expect(screen.getByText(/Current-state report ·/)).toBeTruthy();
});

it.each(['pending', 'denied'])(
  'discards a delayed CSV during a same-key export %s recheck',
  async (phase) => {
    env.mode = 'api';
    let recheck = false;
    let finish: (r: Response) => void = () => {};
    let signal: AbortSignal | undefined;
    const company = sample.workspaces[0].company.id,
      user = sample.workspaces[0].me.id;
    const ready = {
      job: {
        id: 'job',
        state: 'ready',
        snapshotId: 'snap',
        artifactId: 'artifact',
        failureCode: '',
        attemptCount: 1,
        definitionRevision: 0,
      },
      artifact: {
        id: 'artifact',
        length: 3,
        sha256: 'owned-sha',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options: any) => {
        if (path.includes('/artifacts/')) {
          signal = options.signal;
          return new Promise<Response>((r) => {
            finish = r;
          });
        }
        if (path.includes('/exports/')) {
          if (recheck) {
            if (phase === 'pending') return new Promise<Response>(() => {});
            return new Response(
              JSON.stringify({ error: { code: 'access_changed', message: 'Job denied' } }),
              { status: 409 },
            );
          }
          return new Response(JSON.stringify(ready));
        }
        return new Response(
          JSON.stringify(
            path.includes('/rows')
              ? { rows: [], cursor: '' }
              : {
                  snapshot: {
                    id: 'snap',
                    request: { reportZone: 'UTC' },
                    summary: { metrics: {}, coverage: [] },
                    rowCount: 0,
                  },
                },
          ),
        );
      }),
    );
    const url = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:owned');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const queries = new QueryClient();
    render(
      <QueryClientProvider client={queries}>
        <HistoricalReports initialJob="job" onTask={() => {}} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByText('Download authorized CSV'));
    await waitFor(() => expect(signal).toBeTruthy());
    recheck = true;
    await act(async () => {
      void queries.invalidateQueries({
        queryKey: ['workspace', 'api', user, company, 'execution'],
      });
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.queryByText('Download authorized CSV')).toBeNull();
    await act(async () => {
      finish(new Response('csv'));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(url).not.toHaveBeenCalled();
    expect(signal!.aborted).toBe(true);
  },
);

it.each([true, false])(
  'freshly checks all-source authorization before publishing complete CSV (allowed=%s)',
  async (allowed) => {
    env.mode = 'api';
    let exportReads = 0;
    const ready = {
      job: {
        id: 'job',
        state: 'ready',
        snapshotId: 'snap',
        artifactId: 'artifact',
        failureCode: '',
        attemptCount: 1,
        definitionRevision: 0,
      },
      artifact: {
        id: 'artifact',
        length: 3,
        sha256: 'owned-sha',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path.includes('/artifacts/')) return new Response('csv');
        if (path.includes('/exports/')) {
          exportReads++;
          if (exportReads > 1 && !allowed)
            return new Response(
              JSON.stringify({ error: { code: 'access_changed', message: 'Source revoked' } }),
              { status: 409 },
            );
          return new Response(JSON.stringify(ready));
        }
        return new Response(
          JSON.stringify(
            path.includes('/rows')
              ? { rows: [], cursor: '' }
              : {
                  snapshot: {
                    id: 'snap',
                    request: { reportZone: 'UTC' },
                    summary: { metrics: {}, coverage: [] },
                    rowCount: 0,
                  },
                },
          ),
        );
      }),
    );
    const url = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:owned');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(
      <QueryClientProvider client={new QueryClient()}>
        <HistoricalReports initialJob="job" onTask={() => {}} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByText('Download authorized CSV'));
    await waitFor(() => expect(exportReads).toBe(2));
    if (allowed) {
      await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
      expect(url).toHaveBeenCalledTimes(1);
    } else {
      await screen.findByText('Source revoked');
      expect(url).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
    }
  },
);
