// @vitest-environment happy-dom
import { render, screen, cleanup } from '@testing-library/react';
import { it, expect, afterEach, vi } from 'vitest';
import GoalReminderPreferences from './GoalReminderPreferences';
import sample from '../data/sample.json';
vi.mock('../store', () => ({
  useWorkspace: () => ({
    data: sample.workspaces[0],
    mode: 'api',
    companyId: 'c',
    session: { user: { id: 'u' } },
  }),
}));
vi.mock('../data/goals', () => ({
  useGoalRead: () => ({
    ready: true,
    data: {
      preference: {
        version: 0,
        enabled: false,
        cadence: 'weekly',
        weekday: 1,
        monthDay: 1,
        localTime: '09:00',
      },
    },
    denied: false,
  }),
  useGoalMutation: () => ({ execute: vi.fn(), busy: false, attempt: undefined }),
}));
afterEach(cleanup);
it('shows an opt-in reminder without claiming a measured update', () => {
  render(<GoalReminderPreferences goalId="g" ready />);
  expect(screen.getByLabelText('Enable my goal update reminder')).toHaveProperty('checked', false);
  expect(screen.getByText(/Resolving a reminder does not record a measurement/)).toBeTruthy();
});
