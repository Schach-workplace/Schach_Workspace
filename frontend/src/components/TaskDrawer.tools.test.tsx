vi.mock('./TaskTemplates', () => ({ default: () => null }));
vi.mock('./TaskImpact', () => ({ default: () => null }));
// @vitest-environment happy-dom
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi, afterEach, beforeEach } from 'vitest';
import TaskDrawer from './TaskDrawer';
import sample from '../data/sample.json';
import { beginAttempt, clearAllBusinessAttempts } from '../../../shared/business/attempts';
import { clearAllDrafts } from '../communication/drafts';
const state = vi.hoisted(() => ({ store: {} as any }));
vi.mock('../store', () => ({
  useWorkspace: () => state.store,
  useTaskDetail: () => ({ task: sample.workspaces[0].tasks[0], people: [] }),
}));
beforeEach(() => {
  clearAllDrafts();
  clearAllBusinessAttempts();
  state.store = {
    mode: 'api',
    session: { user: { id: 'u-founder' } },
    companyId: 'c-schach',
    data: sample.workspaces[0],
    saving: false,
    mutate: vi.fn(),
    notify: vi.fn(),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({}))),
  );
});
afterEach(() => {
  cleanup();
  clearAllBusinessAttempts();
  vi.unstubAllGlobals();
});
const task = sample.workspaces[0].tasks[0];
const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskDrawer taskId={task.id} onClose={() => {}} />
    </QueryClientProvider>,
  );
it('opens the reviewed schedule tool and flags it when a frozen schedule attempt is unresolved', async () => {
  beginAttempt(
    {
      serverOrigin: (import.meta.env.VITE_API_URL ?? window.location.origin) + ':api',
      companyId: 'c-schach',
      userId: 'u-founder',
      formId: 'schedule-apply:' + task.id,
    },
    { proposalId: 'original', expectedVersion: 1 },
    'retry-key-1',
    { path: '/schedule-proposals/original/apply', method: 'POST' },
  );
  draw();
  const notice = await screen.findByText(/may already have succeeded/);
  const panel = notice.closest('details')!;
  expect(panel.open).toBe(true);
  expect(panel.querySelector('summary')!.textContent).toMatch(/Needs attention/);
});
it('keeps planning tools collapsed and unflagged without pending attempts', async () => {
  draw();
  const summary = screen.getByText('Reviewed schedule').closest('summary')!;
  expect((summary.parentElement as HTMLDetailsElement).open).toBe(false);
  expect(summary.textContent).not.toMatch(/Needs attention/);
});
