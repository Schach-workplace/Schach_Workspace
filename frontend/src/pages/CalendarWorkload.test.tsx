// @vitest-environment happy-dom
import { render, screen, cleanup } from '@testing-library/react';
import { it, expect, afterEach, vi } from 'vitest';
import { WorkloadPage } from './CalendarWorkload';
import sample from '../data/sample.json';
vi.mock('../store', () => ({ useWorkspace: () => ({ data: sample.workspaces[0], mode: 'api' }) }));
vi.mock('../data/planning', () => ({
  usePlanningRead: (path: string) => ({
    ready: true,
    data: path.includes('summary')
      ? {
          methodDescription:
            'Full remaining estimate once per overlapping week; whole recorded capacity.',
          projectionBasis: 'basis',
          coverage: {
            uniqueSelectedRemainingHours: 8,
            weeklyExposureHours: 24,
            undated: 1,
            invalidInterval: 0,
            recordedZeroEstimate: 1,
            missingOwner: 0,
            invalidNumeric: 0,
          },
          weeks: [
            {
              from: '2026-10-05',
              to: '2026-10-11',
              partial: true,
              remainingHours: 8,
              people: [
                {
                  id: 'owner',
                  name: 'Owner',
                  recordedCapacity: 0,
                  capacityState: 'recorded_zero',
                  remainingHours: 8,
                  utilization: null,
                  drill: { category: 'scheduled', personId: 'owner' },
                },
              ],
              drill: { category: 'scheduled' },
            },
          ],
        }
      : { warnings: [] },
    denied: false,
  }),
}));
afterEach(cleanup);
it('discloses unique effort, exposure, whole-capacity partial weeks and recorded zero', () => {
  render(<WorkloadPage onTask={() => {}} />);
  const metric = (label: string) => screen.getByText(label).closest('.metric-card')?.textContent;
  expect(metric('Unique selected effort')).toContain('8 h');
  expect(metric('Weekly exposure')).toContain('24 h');
  expect(
    screen.getByText(/Partial selected weeks use the whole recorded weekly capacity/),
  ).toBeTruthy();
  expect(screen.getAllByText(/Capacity is not attendance or free time/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Recorded zero/)).toBeTruthy();
  expect(screen.queryByText(/Room available/)).toBeNull();
});
