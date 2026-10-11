// @vitest-environment happy-dom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import GoalMetadataForm from './GoalMetadataForm';
import GoalReminderPreferences from './GoalReminderPreferences';
import GoalMeasurementForm from './GoalMeasurementForm';
import sample from '../data/sample.json';
import { ApiError } from '../data/api';
import { clearAllBusinessAttempts } from '../../../shared/business/attempts';
import { clearAllDrafts } from '../communication/drafts';
const s = vi.hoisted(() => ({ mutate: vi.fn(), goal: {} as any, pref: {} as any }));
vi.mock('../store', () => ({
  useWorkspace: () => ({
    mode: 'api',
    companyId: 'c',
    session: { user: { id: 'u' } },
    data: sample.workspaces[0],
    mutate: s.mutate,
  }),
}));
vi.mock('./GoalEvidencePicker', () => ({ default: () => null }));
const mount = (node: any) =>
  render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
beforeEach(() => {
  clearAllDrafts();
  clearAllBusinessAttempts();
  s.mutate.mockReset();
  s.goal = {
    ...sample.workspaces[0].goals[0],
    id: 'recovery',
    version: 7,
    name: 'Current goal',
    unit: 'defects',
    current: 4.8,
    baseline: 8,
    target: 3,
    taskIds: [],
  };
  s.pref = {
    goalId: 'recovery',
    userId: 'u',
    version: 7,
    enabled: false,
    cadence: 'weekly',
    weekday: 1,
    monthDay: 1,
    localTime: '09:00',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).includes('reminder-preference')
              ? { preference: s.pref }
              : { goal: s.goal, canEdit: true, canMeasure: true },
          ),
          { status: 200 },
        ),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('discards rejected metadata explicitly, then loads fresh fields and version across remount without implicit rebase', async () => {
  s.mutate
    .mockRejectedValueOnce(new ApiError('Invalid metadata', 422, 'validation'))
    .mockRejectedValueOnce(
      new ApiError('This task changed since you opened it.', 409, 'version_conflict'),
    )
    .mockResolvedValue({ ok: true, id: 'recovery' });
  const item = { ...s.goal };
  mount(<GoalMetadataForm item={item} ready onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText('Goal name'), { target: { value: 'Invalid name' } });
  fireEvent.change(screen.getByLabelText('Metadata reason'), { target: { value: 'Human reason' } });
  fireEvent.submit(screen.getByLabelText('Goal name').closest('form')!);
  await screen.findByText('Discard submitted intent and edit');
  const first = s.mutate.mock.calls[0][1];
  fireEvent.click(screen.getByText('Discard submitted intent and edit'));
  fireEvent.change(screen.getByLabelText('Goal name'), { target: { value: 'Corrected' } });
  fireEvent.submit(screen.getByLabelText('Goal name').closest('form')!);
  await waitFor(() => expect(s.mutate).toHaveBeenCalledTimes(2));
  expect(await screen.findByText(/This goal changed/)).toBeTruthy();
  expect(s.mutate.mock.calls[1][1].name).toBe('Corrected');
  expect(s.mutate.mock.calls[1][1].retryKey).not.toBe(first.retryKey);
  cleanup();
  s.goal = { ...s.goal, version: 9, name: 'Fresh authorized goal', unit: 'new-unit' };
  mount(<GoalMetadataForm item={item} ready onClose={() => {}} />);
  expect(screen.getByLabelText('Goal name')).toHaveProperty('value', 'Corrected');
  await waitFor(() =>
    expect(screen.getByText('Load latest goal and version')).toHaveProperty('disabled', false),
  );
  fireEvent.click(screen.getByText('Load latest goal and version'));
  expect(screen.getByLabelText('Goal name')).toHaveProperty('value', 'Fresh authorized goal');
  fireEvent.submit(screen.getByLabelText('Goal name').closest('form')!);
  await waitFor(() => expect(s.mutate).toHaveBeenCalledTimes(3));
  expect(s.mutate.mock.calls[2][1]).toMatchObject({ version: 9, unit: 'new-unit' });
  expect(s.mutate.mock.calls[2][1]).not.toHaveProperty('current');
});
it('reminder rejected input can be corrected as new intent, then explicitly load latest preference version', async () => {
  s.mutate
    .mockRejectedValueOnce(new ApiError('Invalid weekday', 422, 'validation'))
    .mockRejectedValueOnce(new ApiError('Stale preference', 409, 'conflict'))
    .mockResolvedValue({ ok: true });
  mount(<GoalReminderPreferences goalId="recovery" ready />);
  await waitFor(() =>
    expect(screen.getByText('Load latest preference and version')).toHaveProperty(
      'disabled',
      false,
    ),
  );
  fireEvent.change(screen.getByLabelText('Preference reason'), {
    target: { value: 'Human preference' },
  });
  fireEvent.change(screen.getByLabelText('Weekday (Monday 1 – Sunday 7)'), {
    target: { value: '9' },
  });
  fireEvent.submit(screen.getByLabelText('Preference reason').closest('form')!);
  await screen.findByText('Discard submitted intent and edit');
  fireEvent.click(screen.getByText('Discard submitted intent and edit'));
  fireEvent.change(screen.getByLabelText('Weekday (Monday 1 – Sunday 7)'), {
    target: { value: '2' },
  });
  fireEvent.submit(screen.getByLabelText('Preference reason').closest('form')!);
  await waitFor(() => expect(s.mutate).toHaveBeenCalledTimes(2));
  expect(s.mutate.mock.calls[1][1].weekday).toBe(2);
  cleanup();
  s.pref.version = 9;
  mount(<GoalReminderPreferences goalId="recovery" ready />);
  await waitFor(() =>
    expect(screen.getByText('Load latest preference and version')).toHaveProperty(
      'disabled',
      false,
    ),
  );
  fireEvent.click(screen.getByText('Load latest preference and version'));
  fireEvent.change(screen.getByLabelText('Preference reason'), {
    target: { value: 'Latest preference' },
  });
  fireEvent.submit(screen.getByLabelText('Preference reason').closest('form')!);
  await waitFor(() => expect(s.mutate).toHaveBeenCalledTimes(3));
  expect(s.mutate.mock.calls[2][1].expectedVersion).toBe(9);
});
it('measurement Load latest replaces captured value/version after conflict and retains explicit zero', async () => {
  s.mutate
    .mockRejectedValueOnce(new ApiError('Stale', 409, 'conflict'))
    .mockResolvedValue({ ok: true });
  const item = { ...s.goal };
  mount(<GoalMeasurementForm goal={item} ready />);
  fireEvent.change(screen.getByLabelText('Measured value'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Reason shared with goal audience'), {
    target: { value: 'Explicit zero' },
  });
  fireEvent.submit(screen.getByLabelText('Measured value').closest('form')!);
  await waitFor(() => expect(s.mutate).toHaveBeenCalledTimes(1));
  expect(s.mutate.mock.calls[0][1].value).toBe(0);
  cleanup();
  mount(<GoalMeasurementForm goal={{ ...item, version: 9, current: -2 }} ready />);
  fireEvent.click(screen.getByText('Load latest value and version'));
  fireEvent.submit(screen.getByLabelText('Measured value').closest('form')!);
  await waitFor(() => expect(s.mutate).toHaveBeenCalledTimes(2));
  expect(s.mutate.mock.calls[1][1]).toMatchObject({ expectedVersion: 9, value: -2 });
});

it('reconstructs locked authored measurement controls from the exact unknown submission after graph draft invalidation', async () => {
  s.mutate.mockRejectedValueOnce(Error('lost ACK')).mockResolvedValue({ id: 'recovery' });
  mount(<GoalMeasurementForm goal={s.goal} ready />);
  fireEvent.change(screen.getByLabelText(/Measured value/), { target: { value: '2.7' } });
  fireEvent.change(screen.getByLabelText('Reason shared with goal audience'), {
    target: { value: 'Frozen human observation' },
  });
  fireEvent.submit(screen.getByLabelText(/Measured value/).closest('form')!);
  await waitFor(() => expect(s.mutate).toHaveBeenCalledTimes(1));
  const original = s.mutate.mock.calls[0][1];
  cleanup();
  clearAllDrafts();
  s.goal = { ...s.goal, current: 1, version: 9 };
  mount(<GoalMeasurementForm goal={s.goal} ready />);
  expect(screen.getByLabelText(/Measured value/)).toHaveProperty('value', '2.7');
  expect(screen.getByLabelText('Reason shared with goal audience')).toHaveProperty(
    'value',
    'Frozen human observation',
  );
  fireEvent.submit(screen.getByLabelText(/Measured value/).closest('form')!);
  await waitFor(() => expect(s.mutate).toHaveBeenCalledTimes(2));
  expect(s.mutate.mock.calls[1][1]).toEqual(original);
});
