// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Overview from './Overview';
import sample from '../data/sample.json';
import type { WorkspaceData } from '../types';

const base = sample.workspaces[0] as unknown as WorkspaceData;
const workspace: WorkspaceData = {
  ...base,
  activities: [
    {
      id: 'act-project',
      companyId: base.company.id,
      taskId: '',
      userId: base.me.id,
      action: 'project_updated',
      detail: 'Project details changed',
      createdAt: '2099-01-04T10:00:00Z',
    },
    {
      id: 'act-person',
      companyId: base.company.id,
      taskId: '',
      userId: base.me.id,
      action: 'person_added',
      detail: 'Added a colleague',
      createdAt: '2099-01-03T10:00:00Z',
    },
    {
      id: 'act-unknown',
      companyId: base.company.id,
      taskId: '',
      userId: base.me.id,
      action: 'operator_password_reset',
      detail: 'Operator reset',
      createdAt: '2099-01-02T10:00:00Z',
    },
    {
      id: 'act-task',
      companyId: base.company.id,
      taskId: base.tasks[0].id,
      userId: base.me.id,
      action: 'comment_added',
      detail: 'Task comment',
      createdAt: '2099-01-01T10:00:00Z',
    },
  ],
};
vi.mock('../store', () => ({ useWorkspace: () => ({ data: workspace, mode: 'api' }) }));
vi.mock('../components/AttentionInbox', () => ({ default: () => null }));
afterEach(cleanup);

it('routes latest activity rows by their actual target and leaves untargeted rows inert', () => {
  const onNavigate = vi.fn();
  const onTask = vi.fn();
  render(<Overview onTask={onTask} onNavigate={onNavigate} onProject={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /project updated/ }));
  expect(onNavigate).toHaveBeenLastCalledWith('projects');
  fireEvent.click(screen.getByRole('button', { name: /person added/ }));
  expect(onNavigate).toHaveBeenLastCalledWith('people');
  fireEvent.click(screen.getByRole('button', { name: /comment added/ }));
  expect(onTask).toHaveBeenCalledWith(base.tasks[0].id);
  expect(screen.queryByRole('button', { name: /operator password reset/ })).toBeNull();
  expect(screen.getByText(/operator password reset/)).toBeTruthy();
  expect(onNavigate).toHaveBeenCalledTimes(2);
});
