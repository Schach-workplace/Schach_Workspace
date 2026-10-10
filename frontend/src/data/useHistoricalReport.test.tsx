// @vitest-environment happy-dom
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi, afterEach } from 'vitest';
import { useHistoricalReport } from './useHistoricalReport';
import sample from './sample.json';
vi.mock('../store', () => ({
  useWorkspace: () => ({
    data: sample.workspaces[0],
    companyId: 'c-schach',
    session: { user: { id: 'u-founder' } },
    mode: 'api',
  }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('hides the whole snapshot when a same-key row recheck is pending and denies an unloaded source', async () => {
  let reject = false;
  let hold = false;
  let finish: (value: Response) => void = () => {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path.includes('/rows')) {
        if (hold)
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        return new Response(JSON.stringify({ rows: [], cursor: '' }));
      }
      return new Response(
        JSON.stringify({ snapshot: { id: 'snap', summary: { metrics: {}, coverage: [] } } }),
      );
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => useHistoricalReport('snap', 'state.cohort'), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() => expect(result.current.rowsReady).toBe(true));
  expect(result.current.ready).toBe(true);
  hold = true;
  await act(async () => {
    void client.invalidateQueries({
      predicate: (q) => String(q.queryKey.at(-1)).includes('/rows'),
    });
  });
  await waitFor(() => expect(result.current.loading).toBe(true));
  expect(result.current.ready).toBe(false);
  expect(result.current.snapshot).toBeUndefined();
  reject = true;
  await act(async () => {
    finish(
      new Response(
        JSON.stringify({ error: { message: 'Report access changed.', code: 'access_changed' } }),
        { status: 409 },
      ),
    );
  });
  await waitFor(() => expect(result.current.denied).toBe(true));
  expect(result.current.ready).toBe(false);
  expect(result.current.rows).toBeUndefined();
  expect(reject).toBe(true);
});
