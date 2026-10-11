// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, it, expect, vi } from 'vitest';
import GoalMeasurementForm from './GoalMeasurementForm';
import sample from '../data/sample.json';
const state = vi.hoisted(() => ({ execute: vi.fn(), ready: true }));
vi.mock('../store', () => ({
  useWorkspace: () => ({
    data: sample.workspaces[0],
    mode: 'api',
    companyId: 'company',
    session: { user: { id: 'actor' } },
  }),
}));
vi.mock('../data/goals', () => ({
  useGoalMutation: () => ({
    execute: state.execute,
    busy: false,
    attempt: undefined,
    abandon: vi.fn(),
  }),
  useGoalRead: () => ({ ready: state.ready, data: undefined, denied: false }),
}));
vi.mock('./GoalEvidencePicker', () => ({ default: ({ footer }: any) => footer(true) }));
afterEach(() => {
  cleanup();
  state.execute.mockReset();
});
const goal = {
  ...sample.workspaces[0].goals[0],
  id: 'quality-test',
  version: 7,
  currentMeasurementId: 'current',
  current: 4.8,
  baseline: 8,
  target: 3,
  unit: 'defects',
} as never;
it('captures a measured value, observation and goal-audience reason with inspected version', async () => {
  state.execute.mockResolvedValue({ measurementId: 'one' });
  render(<GoalMeasurementForm goal={goal} ready />);
  expect(screen.getByRole('button', { name: 'Record measurement' }).hasAttribute('disabled')).toBe(
    true,
  );
  fireEvent.change(screen.getByLabelText('Measured value'), { target: { value: '4' } });
  fireEvent.change(
    screen.getByLabelText('Observation time in ' + sample.workspaces[0].company.timezone),
    { target: { value: '2026-10-02T09:00' } },
  );
  fireEvent.change(screen.getByLabelText('Reason shared with goal audience'), {
    target: { value: 'Observed defects independently' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Record measurement' }));
  await waitFor(() => expect(state.execute).toHaveBeenCalledOnce());
  expect(state.execute.mock.calls[0][1]).toMatchObject({
    expectedVersion: 7,
    value: 4,
    reason: 'Observed defects independently',
  });
});
it('keeps the reason editor mounted during current source reauthorization', () => {
  const { rerender } = render(<GoalMeasurementForm goal={goal} ready />);
  const editor = screen.getByLabelText('Reason shared with goal audience');
  fireEvent.change(editor, { target: { value: 'Human draft' } });
  editor.focus();
  rerender(<GoalMeasurementForm goal={goal} ready={false} />);
  expect(screen.getByLabelText('Reason shared with goal audience')).toBe(editor);
  expect(editor).toHaveProperty('value', 'Human draft');
  expect(screen.getByRole('button', { name: 'Record measurement' }).hasAttribute('disabled')).toBe(
    true,
  );
});
