// @vitest-environment happy-dom
import { render, screen, cleanup } from '@testing-library/react';
import { it, expect, afterEach, vi } from 'vitest';
import GoalHistory from './GoalHistory';
const state = vi.hoisted(() => ({ ready: true }));
vi.mock('../data/goals', () => ({
  useGoalRead: () => ({
    ready: state.ready,
    data: {
      measurements: [
        {
          id: 'old',
          value: 4.8,
          unit: 'defects',
          reason: 'Observed quality',
          effectiveAt: '2026-10-01T00:00:00Z',
          createdAt: '2026-10-02T00:00:00Z',
          actorName: 'Owner',
          evidence: [{ status: 'evidence_unavailable' }],
        },
      ],
    },
    denied: false,
  }),
}));
afterEach(cleanup);
it('labels observation and recording separately and masks private evidence', () => {
  render(<GoalHistory goalId="g" currentMeasurementId="new" canMeasure />);
  expect(screen.getByText(/Observed quality/)).toBeTruthy();
  expect(screen.getByText(/Evidence unavailable/)).toBeTruthy();
  expect(screen.getByText(/Observed:/)).toBeTruthy();
  expect(screen.getByText(/Recorded:/)).toBeTruthy();
});
it('withholds old history while the same source fetch is pending', () => {
  state.ready = false;
  render(<GoalHistory goalId="g" currentMeasurementId="new" canMeasure />);
  expect(screen.queryByText(/Observed quality/)).toBeNull();
  state.ready = true;
});
