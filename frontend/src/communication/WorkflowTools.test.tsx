// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react';
import WorkflowTools from './WorkflowTools';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('refreshes current linked task status and removes denied links during an open panel', async () => {
  vi.useFakeTimers();
  let title = 'Original linked work',
    denied = false;
  const command = async (path: string): Promise<any> => {
    if (denied) throw Error('Access unavailable');
    if (path.endsWith('/work-links'))
      return {
        tasks: [
          {
            id: 'task',
            title,
            status: title === 'Original linked work' ? 'todo' : 'done',
            dueDate: '2026-10-12',
          },
        ],
      };
    if (path.includes('/sources'))
      return { sources: [{ messageId: 'm', revision: 1, currentRevision: 2, outOfDate: true }] };
    return { requests: [], expenses: [] };
  };
  const onTask = vi.fn();
  render(
    <WorkflowTools
      conversation={{ id: 'c' } as any}
      source={null}
      data={{ me: { id: 'u' }, people: [], company: {} } as any}
      command={command}
      onClose={() => {}}
      onTask={onTask}
    />,
  );
  await act(async () => {});
  expect(screen.getAllByText(/Original linked work/).length).toBeGreaterThan(0);
  title = 'Current linked work';
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(screen.queryAllByText(/Original linked work/)).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: /Open task/ }));
  expect(onTask).toHaveBeenCalledWith('task');
  expect(screen.getByText(/Source changed/)).toBeTruthy();
  denied = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(screen.queryAllByText(/Current linked work/)).toHaveLength(0);
});
