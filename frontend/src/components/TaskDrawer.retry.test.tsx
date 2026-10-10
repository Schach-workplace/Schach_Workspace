vi.mock('./TaskTemplates', () => ({ default: () => null }));
vi.mock('./TaskImpact', () => ({ default: () => null }));
vi.mock('./ScheduleReview', () => ({ default: () => null }));
// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { it, expect, vi, afterEach, beforeEach } from 'vitest';
import TaskDrawer from './TaskDrawer';
import sample from '../data/sample.json';
import { clearAllBusinessAttempts } from '../../../shared/business/attempts';
const state = vi.hoisted(() => ({ store: {} as any }));
vi.mock('../store', () => ({ useWorkspace: () => state.store, useTaskDetail: () => ({}) }));
afterEach(() => {
  cleanup();
  clearAllBusinessAttempts();
});
beforeEach(() => {
  state.store = {
    mode: 'api',
    session: { user: { id: 'u-founder' } },
    companyId: 'c-schach',
    data: sample.workspaces[0],
    saving: false,
    mutate: vi
      .fn()
      .mockRejectedValueOnce(Error('Lost response'))
      .mockResolvedValue({ id: 'canonical' }),
    notify: vi.fn(),
  };
});
it('retries frozen task intent after losing the response and remounting', async () => {
  const view = render(<TaskDrawer taskId="new" onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText('Task title'), {
    target: { value: 'Canonical web task' },
  });
  fireEvent.submit(document.querySelector('form')!);
  await screen.findByText('Lost response');
  const original = state.store.mutate.mock.calls[0][1];
  expect(original.retryKey).toEqual(expect.any(String));
  view.unmount();
  render(<TaskDrawer taskId="new" onClose={() => {}} />);
  fireEvent.submit(document.querySelector('form')!);
  await waitFor(() => expect(state.store.mutate).toHaveBeenCalledTimes(2));
  expect(state.store.mutate.mock.calls[1][1]).toEqual(original);
});
import { ApiError } from '../data/api';
it.each([409, 422])(
  'ordinary task creation keeps HTTP%s frozen until warned deliberate correction',
  async (status) => {
    state.store.mutate
      .mockReset()
      .mockRejectedValueOnce(new ApiError('Inspect existing work', status, 'rejected'))
      .mockResolvedValue({ id: 'corrected' });
    render(<TaskDrawer taskId="new" onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Original' } });
    fireEvent.submit(document.querySelector('form')!);
    await screen.findByText('Inspect existing work');
    const original = state.store.mutate.mock.calls[0][1];
    fireEvent.click(screen.getByText('Abandon retry after inspection; prior result may exist'));
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Corrected' } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(state.store.mutate).toHaveBeenCalledTimes(2));
    expect(state.store.mutate.mock.calls[1][1]).toMatchObject({ title: 'Corrected' });
    expect(state.store.mutate.mock.calls[1][1].retryKey).not.toBe(original.retryKey);
  },
);
