vi.mock('./TaskTemplates', () => ({ default: () => null }));
vi.mock('./TaskImpact', () => ({ default: () => null }));
vi.mock('./ScheduleReview', () => ({ default: () => null }));
vi.mock('./IntelligenceLauncher', () => ({ default: () => null }));
// @vitest-environment happy-dom
import { render, screen, cleanup } from '@testing-library/react';
import { it, expect, vi, afterEach } from 'vitest';
import TaskDrawer from './TaskDrawer';
import sample from '../data/sample.json';
const state = vi.hoisted(() => ({ store: {} as any, task: undefined as any }));
vi.mock('../store', () => ({
  useWorkspace: () => state.store,
  useTaskDetail: () => ({ task: state.task, people: [] }),
}));
afterEach(cleanup);
function as(userId: string) {
  const workspace = sample.workspaces[0] as any;
  const me = workspace.people.find((p: any) => p.id === userId);
  state.task = workspace.tasks.find((t: any) => t.id === 't-002');
  state.store = {
    mode: 'api',
    session: { user: { id: userId } },
    companyId: 'c-schach',
    data: { ...workspace, me: { ...workspace.me, ...me } },
    saving: false,
    mutate: vi.fn(),
    notify: vi.fn(),
  };
}
it('tells the owner of in-review work who can accept it instead of offering approval', () => {
  as('u-rahul');
  render(<TaskDrawer taskId="t-002" onClose={() => {}} />);
  expect(screen.getByText('Waiting for independent review')).toBeTruthy();
  expect(screen.getByText(/you cannot accept it yourself/)).toBeTruthy();
  expect(screen.getByText(/Vikram Desai \(assigned reviewer\)/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Accept work' })).toBeNull();
});
it('shows the assigned reviewer the review decision first, with the reason they can decide', () => {
  as('u-vikram');
  render(<TaskDrawer taskId="t-002" onClose={() => {}} />);
  expect(screen.getByText('Your review is needed')).toBeTruthy();
  expect(screen.getByText(/You are the assigned independent reviewer/)).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Request changes' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText('Feedback is required to request changes.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Accept work' })).toBeTruthy();
});
