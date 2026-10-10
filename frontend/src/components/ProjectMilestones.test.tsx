// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { it, expect, vi, afterEach } from 'vitest';
import ProjectMilestones from './ProjectMilestones';
import sample from '../data/sample.json';
const state = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock('../store', () => ({ useWorkspace: () => ({ data: sample.workspaces[0], mode: 'api' }) }));
vi.mock('../data/execution', () => ({
  useExecutionRead: (path: string) => state.query(path),
  useExecutionMutation: () => ({
    execute: state.execute,
    busy: false,
    error: '',
    attempt: undefined,
  }),
  executionRead: vi.fn(),
}));
afterEach(cleanup);
it('shows immutable history and independently reviews the captured task basis', async () => {
  const milestone = {
    id: 'milestone',
    projectId: 'project',
    title: 'Release ready',
    version: 2,
    criteriaVersion: 1,
    state: 'in_review',
    criteria: [{ id: 'c', text: 'Accepted delivery' }],
    submittedTasks: [{ taskId: 'task', version: 7 }],
    assertions: [{ criterionId: 'c', statement: 'Inspected' }],
    taskIds: ['task'],
    acceptances: [],
    basisCurrent: true,
    canReview: true,
  };
  state.query.mockImplementation((p) => ({
    ready: true,
    data: p.includes('project-milestones') ? { milestone } : { milestones: [milestone] },
  }));
  state.execute.mockResolvedValue({ id: 'milestone' });
  render(<ProjectMilestones project={{ id: 'project', version: 3 } as never} canEdit={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open milestone: Release ready' }));
  await screen.findByText('Accepted delivery');
  fireEvent.click(screen.getByRole('button', { name: 'Accept milestone independently' }));
  await waitFor(() => expect(state.execute).toHaveBeenCalledTimes(1));
  expect(state.execute.mock.calls[0][1]).toMatchObject({
    version: 2,
    expectedProjectVersion: 3,
    criteriaVersion: 1,
    tasks: [{ taskId: 'task', version: 7 }],
    action: 'approve',
  });
});
