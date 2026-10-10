// @vitest-environment happy-dom
import { render, screen, cleanup } from '@testing-library/react';
import { it, expect, vi, afterEach } from 'vitest';
import Projects from './Projects';
import sample from '../data/sample.json';
vi.mock('../store', () => ({ useWorkspace: () => ({ data: sample.workspaces[0] }) }));
vi.mock('../data/execution', () => ({
  useExecutionRead: () => ({
    ready: true,
    data: {
      project: { ...sample.workspaces[0].projects[0], id: 'outside-initial-list', version: 3 },
      summary: { label: 'authorized tasks', total: 9, accepted: 3 },
      canEdit: false,
    },
  }),
}));
vi.mock('../components/ProjectMilestones', () => ({ default: () => null }));
vi.mock('../components/ScheduleReview', () => ({ default: () => null }));
afterEach(cleanup);
it('opens independently authorized project detail beyond the initial list and labels server aggregates', () => {
  render(<Projects selectedId="outside-initial-list" onSelect={() => {}} onTask={() => {}} />);
  expect(screen.getByText('Authorized tasks')).toBeTruthy();
  expect(screen.getByText('9')).toBeTruthy();
  expect(screen.getByText('33% of authorized tasks accepted')).toBeTruthy();
});
