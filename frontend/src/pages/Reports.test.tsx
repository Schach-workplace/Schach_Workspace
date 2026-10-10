// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import sample from '../data/sample.json';
import { ReportsPage } from './GoalsReports';
import type { Task, WorkspaceData } from '../types';
const state = vi.hoisted(() => ({
  data: null as WorkspaceData | null,
  mode: 'demo',
  request: vi.fn(),
}));
vi.mock('../store', () => ({
  useWorkspace: () => ({ data: state.data, mode: state.mode, notify: vi.fn() }),
}));
vi.mock('../data/api', async (original) => ({
  ...(await original<typeof import('../data/api')>()),
  request: state.request,
}));
const late = (patch: Partial<Task> = {}): Task =>
  ({
    ...sample.workspaces[0].tasks[0],
    id: 'late',
    title: 'Timed report delivery',
    status: 'done',
    dueDate: '2026-10-10',
    originalDueDate: '2026-10-10',
    completedAt: '2026-10-10T10:35:00Z',
    deadlineMode: 'timed',
    originalDeadlineMode: 'timed',
    dueAt: '2026-10-10T10:30:00Z',
    originalDueAt: '2026-10-10T10:30:00Z',
    dueTimezone: 'Asia/Kolkata',
    originalDueTimezone: 'Asia/Kolkata',
    ...patch,
  }) as Task;
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => (
    <QueryClientProvider client={client}>
      <ReportsPage onTask={vi.fn()} />
    </QueryClientProvider>
  );
  const result = render(view());
  return { ...result, change: () => result.rerender(view()), client };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T10:40:00Z'));
  state.data = structuredClone(sample.workspaces[0]) as WorkspaceData;
  state.data.tasks = [late()];
  state.mode = 'demo';
  state.request.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('renders exact timed rates including department figures and same-date revisions', () => {
  state.data!.tasks[0].dueAt = '2026-10-10T11:00:00Z';
  mount();
  expect(
    screen.getByText('Original commitment met').parentElement!.querySelector('strong')!.textContent,
  ).toBe('0%');
  expect(
    screen.getByText('Current deadline met').parentElement!.querySelector('strong')!.textContent,
  ).toBe('100%');
  expect(
    screen.getByText('Deadline changed').parentElement!.querySelector('strong')!.textContent,
  ).toBe('1');
  expect(screen.getAllByText('0% (0/1)')).toHaveLength(1);
});
it('provides intersecting project filtering and one-tap date ranges', () => {
  state.data!.tasks = [
    late({ projectId: state.data!.projects[0].id }),
    late({ id: 'other', title: 'Another project', projectId: '' }),
  ];
  mount();
  fireEvent.change(screen.getByLabelText('Report project'), {
    target: { value: state.data!.projects[0].id },
  });
  expect(screen.queryByText('Another project')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
  expect((screen.getByLabelText('Report start date') as HTMLInputElement).value).toBe('2026-10-04');
  fireEvent.click(screen.getByRole('button', { name: 'This month' }));
  expect((screen.getByLabelText('Report start date') as HTMLInputElement).value).toBe('2026-10-01');
});
it('uses the dedicated API and cannot export failed or pending report results', async () => {
  state.mode = 'api';
  state.request.mockRejectedValue(Error('Report service unavailable'));
  mount();
  expect(
    (screen.getByRole('button', { name: 'Export report' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await screen.findByRole('alert');
  expect(state.request.mock.calls[0][0]).toContain('/reports/tasks?');
  expect(screen.getByRole('alert').textContent).toContain('Report service unavailable');
  expect(screen.queryByText('Timed report delivery')).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Export report' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it('renders successful authorized API inputs with current-state wording', async () => {
  state.mode = 'api';
  state.request.mockResolvedValue({
    tasks: state.data!.tasks,
    generatedAt: '2026-10-10T10:40:00Z',
    timezone: 'Asia/Kolkata',
    basis: 'current_state',
  });
  mount();
  await screen.findByText('Timed report delivery');
  expect(
    (screen.getByRole('button', { name: 'Export report' }) as HTMLButtonElement).disabled,
  ).toBe(false);
  expect(screen.getByText(/Current-state report/)).toBeTruthy();
});
it('discards a delayed old company response on switching company', async () => {
  state.mode = 'api';
  let oldResolve!: (value: unknown) => void;
  state.request
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          oldResolve = resolve;
        }),
    )
    .mockResolvedValue({
      tasks: [],
      generatedAt: '2026-10-10T10:40:00Z',
      basis: 'current_state',
      timezone: 'Asia/Kolkata',
    });
  const originalTasks = state.data!.tasks;
  const view = mount();
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(1));
  state.data = {
    ...state.data!,
    company: { ...state.data!.company, id: 'new-company' },
    tasks: [],
  };
  view.change();
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
  oldResolve({ tasks: originalTasks, generatedAt: '2026-10-10T10:40:00Z' });
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Export report' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(screen.queryByText('Timed report delivery')).toBeNull();
});
it('never releases a cached sibling report after authorization denial', async () => {
  const { ApiError } = await import('../data/api');
  state.mode = 'api';
  const response = {
    tasks: state.data!.tasks,
    generatedAt: '2026-10-10T10:40:00Z',
    timezone: 'Asia/Kolkata',
    basis: 'current_state',
  };
  state.request.mockResolvedValue(response);
  const view = mount();
  await screen.findByText('Timed report delivery');
  fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
  await screen.findByText('Timed report delivery');
  state.request.mockRejectedValue(new ApiError('Company access removed', 403, 'forbidden'));
  await view.client.refetchQueries({ queryKey: ['task-report'], type: 'active' });
  await screen.findByRole('alert');
  state.request.mockImplementation(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole('button', { name: 'This month' }));
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(4));
  expect(screen.queryByText('Timed report delivery')).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Export report' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it('reauthorizes before releasing a previously cached company report', async () => {
  state.mode = 'api';
  const original = state.data!;
  state.request
    .mockResolvedValueOnce({ tasks: original.tasks, generatedAt: '2026-10-10T10:40:00Z' })
    .mockResolvedValueOnce({ tasks: [], generatedAt: '2026-10-10T10:40:00Z' });
  const view = mount();
  await screen.findByText('Timed report delivery');
  state.data = { ...original, company: { ...original.company, id: 'another-company' }, tasks: [] };
  view.change();
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Export report' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  state.request.mockImplementation(() => new Promise(() => {}));
  state.data = original;
  view.change();
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(3));
  expect(screen.queryByText('Timed report delivery')).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Export report' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
