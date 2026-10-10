// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { it, expect, vi, afterEach } from 'vitest';
import ScheduleReview from './ScheduleReview';
import sample from '../data/sample.json';
const state = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../store', () => ({ useWorkspace: () => ({ data: sample.workspaces[0], mode: 'api' }) }));
vi.mock('../data/execution', () => ({
  useExecutionRead: () => ({ ready: true, data: undefined }),
  useExecutionMutation: () => ({
    execute: state.execute,
    busy: false,
    error: '',
    attempt: undefined,
  }),
}));
afterEach(cleanup);
it('requires a row reason, previews without applying, then explicitly confirms', async () => {
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
