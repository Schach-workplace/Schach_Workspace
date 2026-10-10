import { expect, it, vi } from 'vitest';
import { readPages, affectedScopes } from './readScopes';
it('reads bounded pages until exhaustion with cancellation propagated', async () => {
  const signal = new AbortController().signal;
  const read = vi.fn(async (path: string, options: { signal?: AbortSignal }) => {
    expect(options.signal).toBe(signal);
    return path.includes('cursor=next')
      ? { tasks: [{ id: 'b' }], hasMore: false, cursor: '' }
      : { tasks: [{ id: 'a' }], hasMore: true, cursor: 'next' };
  });
  expect(await readPages('/companies/c/tasks', 'tasks', signal, read)).toEqual([
    { id: 'a' },
    { id: 'b' },
  ]);
  expect(read.mock.calls[0][0]).toBe('/companies/c/tasks?limit=100');
});
it('invalidates task records/list/reports without refreshing finance', () => {
  expect(affectedScopes('/tasks/t/comments')).toEqual(['tasks', 'task:t', 'reports', 'bootstrap']);
  expect(affectedScopes('/expenses/e/transition')).toEqual(['finance', 'expense:e', 'bootstrap']);
  expect(affectedScopes('/people/p')).toEqual([
    'bootstrap',
    'tasks',
    'finance',
    'reports',
    'details',
  ]);
});
it('maps work outbox hints to only their affected business scopes', async () => {
  const { eventScopes } = await import('./readScopes');
  expect(eventScopes('work_linked')).toEqual(['bootstrap', 'tasks', 'reports', 'task-details']);
  expect(eventScopes('expense_linked')).toEqual(['bootstrap', 'finance', 'expense-details']);
  expect(eventScopes('message_created')).toEqual([]);
});
it('loads only selected-record evidence tails without losing the first page', async () => {
  const { readDetail } = await import('./readScopes');
  const signal = new AbortController().signal;
  const paths: string[] = [];
  const read = async (path: string) => {
    paths.push(path);
    return path.includes('/comments?')
      ? { comments: [{ id: 'last' }], hasMore: false, cursor: '', people: [] }
      : {
          task: { comments: [{ id: 'first' }], attachments: [], timeEntries: [] },
          evidence: { comments: { hasMore: true, cursor: 'tail' } },
          people: [],
        };
  };
  const result = await readDetail<{ task: { comments: { id: string }[] } }>(
    '/companies/c/tasks/t',
    'task',
    signal,
    read,
  );
  expect(result.task.comments).toEqual([{ id: 'first' }, { id: 'last' }]);
  expect(paths[1]).toBe('/companies/c/tasks/t/comments?limit=100&cursor=tail');
});
