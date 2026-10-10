// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AttentionInbox from '../components/AttentionInbox';
const env = vi.hoisted(() => ({
  company: 'c',
  request: vi.fn(),
  mutate: vi.fn(),
  data: { company: { id: 'c', timezone: 'Asia/Kolkata' }, me: { id: 'u' }, readBasis: 'basis' },
}));
vi.mock('../store', () => ({
  useWorkspace: () => ({
    mode: 'api',
    companyId: env.company,
    session: { user: { id: 'u' } },
    data: env.data,
    mutate: env.mutate,
  }),
}));
vi.mock('../data/api', async (original) => ({
  ...(await original<typeof import('../data/api')>()),
  request: env.request,
}));
const item = {
  id: 'a',
  companyId: 'c',
  recipientId: 'u',
  sourceKind: 'task',
  sourceId: 't',
  kind: 'task_review',
  state: 'open',
  version: 1,
  sourceVersion: 4,
  title: 'Review delivery',
  summary: 'Check evidence',
  link: '/work?task=t',
  ownerName: 'Alex',
  canDecide: true,
  canRoute: true,
  actions: ['resolve', 'snooze', 'route'],
  routePeople: [{ id: 'v', name: 'Sam', active: true, role: 'admin' }],
  snoozedUntil: null,
  dueAt: null,
  reminderState: 'pending',
};
function mount(decisionsOnly = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => (
    <QueryClientProvider client={client}>
      <AttentionInbox decisionsOnly={decisionsOnly} onTask={vi.fn()} onExpense={vi.fn()} />
    </QueryClientProvider>
  );
  const result = render(view());
  return { ...result, change: () => result.rerender(view()), client };
}
beforeEach(() => {
  env.company = 'c';
  env.data = {
    company: { id: 'c', timezone: 'Asia/Kolkata' },
    me: { id: 'u' },
    readBasis: 'basis',
  };
  env.request.mockReset();
  env.mutate.mockReset();
  env.request.mockImplementation(async (path: string) =>
    path.includes('/attention/a')
      ? { item }
      : { items: [item], hasMore: false, cursor: '', readBasis: 'basis' },
  );
});
afterEach(cleanup);
it('keeps resolution separate and preserves one payload/key through lost-response retry', async () => {
  env.mutate
    .mockRejectedValueOnce(new Error('Network interrupted'))
    .mockResolvedValue({ ok: true });
  mount();
  await screen.findByText('Review delivery');
  fireEvent.click(screen.getByRole('button', { name: 'Resolve Inbox item' }));
  await screen.findByLabelText('Resolution reason');
  fireEvent.change(screen.getByLabelText('Resolution reason'), {
    target: { value: 'Reviewed elsewhere' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review resolution' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm resolution' }));
  await screen.findByText('Network interrupted');
  const first = env.mutate.mock.calls[0][1];
  const retry = screen.getByRole('button', { name: 'Retry same action' });
  fireEvent.click(retry);
  fireEvent.click(retry);
  await waitFor(() => expect(env.mutate).toHaveBeenCalledTimes(2));
  expect(env.mutate.mock.calls[1][1]).toEqual(first);
  expect(first.action).toBe('resolve');
  expect(first.expectedVersion).toBe(1);
  expect(screen.getByText(/does not approve the work/)).toBeTruthy();
});
it('purges a preview on failed refresh and ignores a delayed old-company response', async () => {
  const mounted = mount();
  await screen.findByText('Review delivery');
  env.request.mockRejectedValue(new Error('Access removed'));
  await mounted.client.invalidateQueries();
  await waitFor(() => expect(screen.queryByText('Review delivery')).toBeNull());
  expect(screen.getByRole('button', { name: 'Retry attention' })).toBeTruthy();
  env.request.mockImplementation(
    (path: string) =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              items: [
                { ...item, title: path.includes('/d/') ? 'New company' : 'Old private preview' },
              ],
              hasMore: false,
              cursor: '',
            }),
          20,
        ),
      ),
  );
  env.company = 'd';
  env.data = { ...env.data, company: { id: 'd', timezone: 'Asia/Kolkata' } };
  mounted.change();
  await screen.findByText('New company');
  expect(screen.queryByText('Old private preview')).toBeNull();
});
it('explains source-derived decisions even after attention resolution', async () => {
  env.request.mockResolvedValue({
    items: [{ ...item, state: 'resolved', actions: [] }],
    hasMore: false,
    cursor: '',
  });
  mount(true);
  await screen.findByText('Review delivery');
  expect(screen.getByText(/including resolved or snoozed Inbox items/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open business decision' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Resolve Inbox item' })).toBeNull();
});
