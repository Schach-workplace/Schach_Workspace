// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, it, vi, expect } from 'vitest';
import ScheduleReview from './ScheduleReview';
import sample from '../data/sample.json';
import { clearAllBusinessAttempts } from '../../../shared/business/attempts';
import { clearAllDrafts } from '../communication/drafts';
const s = vi.hoisted(() => ({ store: {} as any }));
vi.mock('../store', () => ({ useWorkspace: () => s.store }));
const task = {
  ...sample.workspaces[0].tasks[0],
  id: 'one',
  projectId: '',
  title: 'Work',
  status: 'todo',
  dueDate: '2026-10-20',
} as never;
const proposal = {
  id: 'original',
  version: 1,
  expiresAt: '2099-10-12T00:00:00Z',
  method: 'manual',
  rows: [
    {
      taskId: 'one',
      title: 'Work',
      before: { dueDate: '2026-10-20' },
      original: { dueDate: '2026-10-20' },
      current: { dueDate: '2026-10-20' },
      after: { dueDate: '2026-10-22' },
      reason: 'Reviewed delay',
    },
  ],
  advisories: [],
};
beforeEach(() => {
  clearAllDrafts();
  clearAllBusinessAttempts();
  s.store = {
    data: sample.workspaces[0],
    mode: 'api',
    companyId: 'c-schach',
    session: { user: { id: 'u-founder' } },
    mutate: vi
      .fn()
      .mockRejectedValueOnce(Error('Lost schedule response'))
      .mockResolvedValue({ ids: ['one'] }),
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('recovers and displays the exact original proposal after unknown confirmation dismissal/remount and forbids a fresh preview', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ proposal })));
  vi.stubGlobal('fetch', fetcher);
  const view = () => (
    <QueryClientProvider client={new QueryClient()}>
      <ScheduleReview tasks={[task]} />
    </QueryClientProvider>
  );
  let v = render(view());
  fireEvent.change(screen.getByLabelText('Reason: Work'), { target: { value: 'Reviewed delay' } });
  fireEvent.change(screen.getByLabelText('Due date: Work'), { target: { value: '2026-10-22' } });
  fireEvent.click(screen.getByText('Preview schedule'));
  await screen.findByText(/Proposed:.*2026-10-22/);
  fireEvent.click(screen.getByText('Confirm reviewed schedule'));
  await screen.findByText('Lost schedule response');
  const original = s.store.mutate.mock.calls[0][1];
  v.unmount();
  v = render(view());
  await screen.findByText(/Proposed:.*2026-10-22/);
  expect(screen.queryByText('Preview schedule')).toBeNull();
  expect(screen.getByText('Edit and create a fresh preview').hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByText('Retry same schedule confirmation'));
  await waitFor(() => expect(s.store.mutate).toHaveBeenCalledTimes(2));
  expect(s.store.mutate.mock.calls[1][1]).toEqual(original);
  expect(original.proposalId).toBe('original');
  expect(fetcher.mock.calls.some((c: any) => c[0].endsWith('/task-schedule/original'))).toBe(true);
});
