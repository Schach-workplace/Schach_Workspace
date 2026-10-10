// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi, afterEach } from 'vitest';
import OrphanReports from './OrphanReports';
import sample from '../data/sample.json';
import { clearAllBusinessAttempts } from '../../../shared/business/attempts';
const s = vi.hoisted(() => ({ store: {} as any }));
vi.mock('../store', () => ({ useWorkspace: () => s.store }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearAllBusinessAttempts();
});
it('leadership reviews only orphan metadata and retries the original state/version after lost ACK', async () => {
  s.store = {
    data: sample.workspaces[0],
    mode: 'api',
    companyId: 'c-schach',
    session: { user: { id: 'u-founder' } },
    mutate: vi
      .fn()
      .mockRejectedValueOnce(Error('Lost response'))
      .mockResolvedValue({ id: 'orphan', version: 2, state: 'paused' }),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            orphans: [{ id: 'orphan', ownerId: 'inactive', version: 1, state: 'active' }],
          }),
        ),
    ),
  );
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OrphanReports />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByText('Pause orphan'));
  await screen.findByText('Lost response');
  const first = s.store.mutate.mock.calls[0][1];
  fireEvent.click(screen.getByText('Retry original orphan action'));
  await waitFor(() => expect(s.store.mutate).toHaveBeenCalledTimes(2));
  expect(s.store.mutate.mock.calls[1][1]).toEqual(first);
  expect(first.state).toBe('paused');
  expect(first.expectedVersion).toBe(1);
  expect(screen.queryByLabelText('Report name')).toBeNull();
});
