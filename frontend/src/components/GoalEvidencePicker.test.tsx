// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { it, expect, afterEach, vi } from 'vitest';
import GoalEvidencePicker from './GoalEvidencePicker';
const state = vi.hoisted(() => ({ ready: true }));
vi.mock('../data/goals', () => ({
  useGoalRead: (path: string) => ({
    ready: state.ready,
    data: path.includes('evidence-options')
      ? { options: [{ sourceId: 'snapshot', label: 'Report September (task_history_v1)' }] }
      : undefined,
    denied: false,
  }),
}));
afterEach(cleanup);
it('provides labelled report selection without typing IDs', () => {
  render(<GoalEvidencePicker goalId="goal" value={[]} onChange={() => {}} ready />);
  fireEvent.change(screen.getByLabelText('Evidence kind'), {
    target: { value: 'report_snapshot' },
  });
  expect(screen.getByRole('button', { name: /Report September/ })).toBeTruthy();
  expect(screen.queryByLabelText(/source id/i)).toBeNull();
});
it('withholds option labels during current fetch', () => {
  state.ready = false;
  render(<GoalEvidencePicker goalId="goal" value={[]} onChange={() => {}} ready />);
  fireEvent.change(screen.getByLabelText('Evidence kind'), {
    target: { value: 'report_snapshot' },
  });
  expect(screen.queryByText(/Report September/)).toBeNull();
  state.ready = true;
});
