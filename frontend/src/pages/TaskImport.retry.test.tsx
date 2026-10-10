// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import TasksPage, { emptyFilters } from './Tasks';
import sample from '../data/sample.json';
import { clearAllBusinessAttempts } from '../../../shared/business/attempts';
import { ApiError } from '../data/api';
const s = vi.hoisted(() => ({ store: {} as any }));
vi.mock('../store', () => ({ useWorkspace: () => s.store }));
beforeEach(() => {
  clearAllBusinessAttempts();
  s.store = {
    data: sample.workspaces[0],
    companyId: 'c-schach',
    session: { user: { id: 'u-founder' } },
    mode: 'api',
    saving: false,
    mutate: vi.fn(),
    notify: vi.fn(),
  };
});
afterEach(cleanup);
const view = () => <TasksPage filters={emptyFilters} setFilters={() => {}} onTask={() => {}} />;
async function csv(title: string) {
  const department = s.store.data.departments[0].name;
  const file = new File(
    [`Title,Due date,Department\n${title},2026-10-22,"${department}"\n`],
    'tasks.csv',
    { type: 'text/csv' },
  );
  fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [file] } });
  await screen.findByText('1 tasks ready to import');
}
const submit = () => fireEvent.click(screen.getByRole('button', { name: /^Import .*tasks$/ }));
it('imports actual CSV frozen rows through dismissal/remount and warns before correcting a subsequent409', async () => {
  s.store.mutate
    .mockRejectedValueOnce(Error('Lost import response'))
    .mockRejectedValueOnce(new ApiError('Current scope changed', 409, 'version_conflict'))
    .mockResolvedValue({ ids: ['corrected'] });
  let v = render(view());
  fireEvent.click(screen.getByText('Import CSV'));
  await csv('Original CSV task');
  submit();
  await screen.findByText('Lost import response');
  const original = s.store.mutate.mock.calls[0][1];
  fireEvent.click(screen.getByText('Cancel'));
  v.unmount();
  v = render(view());
  fireEvent.click(screen.getByText('Import CSV'));
  expect(screen.getByText('Original CSV task')).toBeTruthy();
  submit();
  await screen.findByText('Current scope changed');
  expect(s.store.mutate.mock.calls[1][1]).toEqual(original);
  fireEvent.click(screen.getByText('Abandon retry after inspection; prior result may exist'));
  await csv('Corrected CSV task');
  submit();
  await waitFor(() => expect(s.store.mutate).toHaveBeenCalledTimes(3));
  const corrected = s.store.mutate.mock.calls[2][1];
  expect(corrected.rows[0].title).toBe('Corrected CSV task');
  expect(corrected.retryKey).not.toBe(original.retryKey);
});
it('guards double submission of the actual import component while one request is pending', async () => {
  let release!: (v: any) => void;
  s.store.mutate.mockImplementation(() => new Promise((r) => (release = r)));
  render(view());
  fireEvent.click(screen.getByText('Import CSV'));
  await csv('One import');
  submit();
  submit();
  expect(s.store.mutate).toHaveBeenCalledTimes(1);
  release({ ids: ['one'] });
  await waitFor(() => expect(screen.queryByText('Import tasks from CSV')).toBeNull());
});
