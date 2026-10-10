// @vitest-environment happy-dom
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi, afterEach } from 'vitest';
import { useExecutionRead } from './execution';
vi.mock('../store', () => ({
  useWorkspace: () => ({
    mode: 'api',
    companyId: 'c',
    session: { user: { id: 'u' } },
    data: { readBasis: 'unchanged' },
  }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('hides fetched source during same-basis reauthorization and after audience revocation', async () => {
  let denied = false;
  let release!: () => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (denied) {
        await new Promise<void>((r) => (release = r));
        return new Response(
          JSON.stringify({ error: { message: 'Source unavailable', code: 'not_found' } }),
          { status: 404 },
        );
      }
      return new Response(JSON.stringify({ title: 'Previously authorized template' }), {
        status: 200,
      });
    }),
  );
  function Probe() {
    const q = useExecutionRead<{ title: string }>('/task-templates/source');
    return (
      <>
        {q.data && <p>{q.data.title}</p>}
        {q.error && <p>Unavailable</p>}
      </>
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Probe />
    </QueryClientProvider>,
  );
  await screen.findByText('Previously authorized template');
  denied = true;
  window.dispatchEvent(
    new CustomEvent('schach-work-event', {
      detail: { company: 'c', user: 'u', kind: 'policy_changed' },
    }),
  );
  await waitFor(() => expect(screen.queryByText('Previously authorized template')).toBeNull());
  release();
  await screen.findByText('Unavailable');
  expect(screen.queryByText('Previously authorized template')).toBeNull();
});
