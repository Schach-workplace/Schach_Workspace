// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { it, expect, vi, afterEach } from 'vitest';
import ScheduleReview from './ScheduleReview';
import sample from '../data/sample.json';
const state = vi.hoisted(() => ({ execute: vi.fn(), proposal: undefined as any }));
vi.mock('../store', () => ({ useWorkspace: () => ({ data: sample.workspaces[0], mode: 'api' }) }));
vi.mock('../data/execution', () => ({
  useExecutionRead: (_path: string, enabled: boolean) => ({
    ready: true,
    data: enabled ? { proposal: state.proposal } : undefined,
  }),
  useExecutionMutation: () => ({
    execute: state.execute,
    busy: false,
    error: '',
    attempt: undefined,
  }),
}));
afterEach(cleanup);
it('requires a row reason, previews without applying, then explicitly confirms', async () => {
  state.proposal = {
    id: 'proposal',
    version: 1,
    expiresAt: '2026-10-12T00:00:00Z',
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
  state.execute
    .mockResolvedValueOnce({
      proposal: {
        id: 'proposal',
        version: 1,
        expiresAt: '2026-10-12T00:00:00Z',
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
      },
    })
    .mockResolvedValueOnce({ ids: ['one'] });
  const task = {
    ...sample.workspaces[0].tasks[0],
    id: 'one',
    title: 'Work',
    status: 'todo',
    projectId: '',
    dueDate: '2026-10-20',
  } as never;
  render(<ScheduleReview tasks={[task]} />);
  expect(screen.getByRole('button', { name: 'Preview schedule' }).hasAttribute('disabled')).toBe(
    true,
  );
  fireEvent.change(screen.getByLabelText('Reason: Work'), { target: { value: 'Reviewed delay' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview schedule' }));
  await screen.findByText(/Proposed:.*2026-10-22/);
  expect(state.execute).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed schedule' }));
  await waitFor(() => expect(state.execute).toHaveBeenCalledTimes(2));
});
it('freezes task and prerequisite versions on the first method edit across remount', async () => {
  state.execute.mockReset();
  state.execute.mockResolvedValue({ proposal: { id: 'captured', version: 1 } });
  const task = {
    ...sample.workspaces[0].tasks[0],
    id: 'freeze-method-m8',
    title: 'Captured task',
    version: 7,
    status: 'todo',
    dueDate: '2026-10-20',
  } as any;
  const context = { projects: [], milestones: [], sources: [{ id: 'source-m8', version: 3 }] };
  const first = render(<ScheduleReview tasks={[task]} context={context} />);
  fireEvent.change(screen.getByLabelText('Schedule method'), {
    target: { value: 'calendar_day_shift' },
  });
  first.unmount();
  render(
    <ScheduleReview
      tasks={[{ ...task, version: 99 } as any]}
      context={{ ...context, sources: [{ id: 'source-m8', version: 99 }] }}
    />,
  );
  fireEvent.change(screen.getByLabelText('Reason: Captured task'), {
    target: { value: 'Explicit later reason' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview schedule' }));
  await waitFor(() => expect(state.execute).toHaveBeenCalled());
  expect(state.execute.mock.calls[0][1].changes[0].version).toBe(7);
  expect(state.execute.mock.calls[0][1].context.sources[0].version).toBe(3);
});
