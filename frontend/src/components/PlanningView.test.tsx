// @vitest-environment happy-dom
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import PlanningView from './PlanningView';
import sample from '../data/sample.json';
const busy = vi.hoisted(() => ({ report: (_: boolean) => {} }));
vi.mock('../store', () => ({ useWorkspace: () => ({ data: sample.workspaces[0], mode: 'api' }) }));
vi.mock('./IntelligenceLauncher', () => ({ default: () => null }));
vi.mock('./ScheduleReview', () => ({
  default: ({ onBusyChange }: { onBusyChange?: (b: boolean) => void }) => {
    busy.report = (b) => onBusyChange?.(b);
    return <p>Schedule review body</p>;
  },
}));
const seeded: Record<string, unknown> = {
  drill: { category: 'scheduled' },
  selected: ['t-001'],
  review: true,
};
vi.mock('../data/executionInput', () => ({
  useExecutionInput: (_form: string, key: string, initial: unknown) =>
    useState(() =>
      key in seeded ? seeded[key] : typeof initial === 'function' ? initial() : initial,
    ),
}));
const task = sample.workspaces[0].tasks[0];
vi.mock('../data/planning', () => ({
  usePlanningRead: (path: string) => ({
    ready: true,
    denied: false,
    data: path.includes('summary')
      ? {
          methodDescription: 'Method.',
          projectionBasis: 'basis',
          coverage: {
            uniqueSelectedRemainingHours: 8,
            weeklyExposureHours: 8,
            undated: 0,
            invalidInterval: 0,
            recordedZeroEstimate: 0,
            missingOwner: 0,
            invalidNumeric: 0,
          },
          weeks: [],
        }
      : path.includes('schedule-seed')
        ? { tasks: [task], context: {} }
        : path.includes('/planning/tasks')
          ? {
              tasks: [
                {
                  id: 't-001',
                  title: 'Planned work',
                  remainingHours: 8,
                  ownerId: '',
                  state: 'scheduled',
                  version: 1,
                },
              ],
            }
          : { warnings: [] },
  }),
}));
afterEach(cleanup);
it('cannot dismiss the inspect/schedule modal while a schedule submission is in flight', () => {
  render(<PlanningView onTask={() => {}} />);
  const dialog = screen.getByRole('dialog', { name: 'Inspect planning work' });
  expect(screen.getByText('Schedule review body')).toBeTruthy();
  act(() => busy.report(true));
  fireEvent.keyDown(dialog, { key: 'Escape' });
  fireEvent.click(screen.getByLabelText('Close dialog'));
  expect(screen.getByRole('dialog', { name: 'Inspect planning work' })).toBeTruthy();
  act(() => busy.report(false));
  fireEvent.click(screen.getByLabelText('Close dialog'));
  expect(screen.queryByRole('dialog', { name: 'Inspect planning work' })).toBeNull();
});
