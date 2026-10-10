// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import fixture from './data/sample.json';
import type { WorkspaceData, Task, Expense } from './types';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_DATA_MODE', 'api');
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
async function setup(kind: 'task' | 'expense', afterFirstPage = false) {
  const data = structuredClone(fixture.workspaces[0]) as WorkspaceData;
  const task: Task = {
    ...data.tasks[0],
    status: 'todo',
    description: 'Private task context',
    comments: [
      {
        id: 'comment',
        userId: data.me.id,
        body: 'Private task comment',
        createdAt: '2026-10-10T00:00:00Z',
      },
    ],
    attachments: [
      {
        id: 'file',
        uploadedBy: data.me.id,
        fileName: 'private-proof.txt',
        mimeType: 'text/plain',
        size: 12,
        createdAt: '2026-10-10T00:00:00Z',
      },
    ],
  };
  const expense: Expense = {
    ...data.expenses[0],
    status: 'submitted',
    createdBy: data.people.find((p) => p.id !== data.me.id)!.id,
    description: 'Private expense context',
  };
  const state = {
    listed: true,
    accessRevoked: false,
    version: 1,
    detailCalls: 0,
    pause: false,
    patches: [] as { version: number; description: string }[],
    polledComment: 'Private task comment',
    resolve: undefined as undefined | (() => void),
  };
  const reply = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === 'PATCH') {
        state.patches.push(JSON.parse(String(init.body)));
        return new Response(
          JSON.stringify({
            error: { code: 'conflict', message: 'Version conflict. Refresh task before retrying.' },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (path.endsWith('/auth/session'))
        return reply({ user: data.me, companies: [data.company] });
      if (path.endsWith('/bootstrap'))
        return reply({
          ...data,
          tasks: [],
          expenses: [],
          financeEvents: [],
          readBasis: 'unchanged-membership-graph',
        });
      if (path.includes('/tasks?') && afterFirstPage && !path.includes('cursor=next'))
        return reply({
          tasks: Array.from({ length: 100 }, (_, i) => ({
            ...task,
            id: 'other-' + i,
            version: state.version,
            comments: [],
            attachments: [],
          })),
          cursor: 'next',
          hasMore: true,
        });
      if (path.includes('/tasks?'))
        return reply({
          tasks:
            state.listed || kind !== 'task'
              ? [{ ...task, version: state.version, comments: [], attachments: [] }]
              : [],
          cursor: '',
          hasMore: false,
        });
      if (path.includes('/expenses?'))
        return reply({
          expenses:
            state.listed || kind !== 'expense'
              ? [{ ...expense, version: state.version, receipts: [] }]
              : [],
          cursor: '',
          hasMore: false,
        });
      if (path.endsWith('/finance/events')) return reply({ financeEvents: [] });
      if (path.endsWith(`/tasks/${task.id}`) || path.endsWith(`/expenses/${expense.id}`)) {
        state.detailCalls++;
        if (state.pause)
          await new Promise<void>((resolve) => {
            state.resolve = resolve;
          });
        if (state.accessRevoked)
          return new Response(
            JSON.stringify({ error: { code: 'not_found', message: 'Task access removed.' } }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
        return reply(
          kind === 'task'
            ? {
                people: [
                  { ...data.people[0], id: 'detail-person', name: 'Private resolved person' },
                ],
                task: {
                  ...task,
                  comments: task.comments.map((c) => ({ ...c, body: state.polledComment })),
                  version: state.version,
                  description: state.version === 1 ? task.description : 'Updated by another user',
                },
              }
            : {
                people: [
                  { ...data.people[0], id: 'detail-person', name: 'Private resolved person' },
                ],
                expense: {
                  ...expense,
                  version: state.version,
                  description:
                    state.version === 1 ? expense.description : 'Updated by another user',
                },
                financeEvents: [],
              },
        );
      }
      throw Error('Unexpected test request: ' + path);
    }),
  );
  const { WorkspaceProvider, useWorkspace, useTaskDetail, useExpenseDetail } =
    await import('./store');
  const { useQueryClient } = await import('@tanstack/react-query');
  const { default: TaskDrawer } = await import('./components/TaskDrawer');
  const { default: FinanceDetail } = await import('./components/FinanceDetail');
  function SelectedReadProbe() {
    const detail = kind === 'task' ? useTaskDetail(task.id) : useExpenseDetail(expense.id);
    const source = 'task' in detail ? detail.task : detail.expense;
    return (
      <>
        <output aria-label="Selected source" data-description={source?.description} />
        <output aria-label="Selected people">{detail.people.map((p) => p.name).join(', ')}</output>
      </>
    );
  }
  function Probe() {
    const store = useWorkspace();
    const client = useQueryClient();
    if (!store.data) return null;
    const rows = kind === 'task' ? store.data.tasks : store.data.expenses;
    return (
      <>
        <SelectedReadProbe />
        <span>List version {rows[0]?.version ?? 'absent'}</span>
        <button
          onClick={() =>
            void client.invalidateQueries({
              predicate: (q) => String(q.queryKey[4]).startsWith(kind + ':'),
            })
          }
        >
          Poll detail
        </button>
        <button
          onClick={() =>
            void client.invalidateQueries({
              predicate: (q) => q.queryKey[4] === (kind === 'task' ? 'tasks' : 'finance'),
            })
          }
        >
          Poll list
        </button>
        {kind === 'task' ? (
          <TaskDrawer taskId={task.id} onClose={() => {}} />
        ) : (
          <FinanceDetail
            expense={expense}
            onClose={() => {}}
            onEdit={() => {}}
            onOpenTask={() => {}}
          />
        )}
      </>
    );
  }
  render(
    <WorkspaceProvider>
      <Probe />
    </WorkspaceProvider>,
  );
  if (kind === 'task') await screen.findByDisplayValue(task.description);
  else await screen.findByText(expense.description);
  return state;
}
it.each(['context', 'comment', 'attachment'])(
  'withholds an open task drawer %s after authoritative list exclusion with the same membership graph',
  async (field) => {
    const state = await setup('task');
    if (field === 'comment') fireEvent.click(screen.getByRole('button', { name: /^Activity/ }));
    if (field === 'attachment')
      fireEvent.click(screen.getByRole('button', { name: 'Evidence & time' }));
    if (field !== 'context')
      await screen.findByText(field === 'comment' ? 'Private task comment' : 'private-proof.txt');
    state.listed = false;
    fireEvent.click(screen.getByText('Poll list'));
    await screen.findByText('List version absent');
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Private task context')).toBeNull();
      expect(screen.queryByText('Private task comment')).toBeNull();
      expect(screen.queryByText('private-proof.txt')).toBeNull();
    });
  },
);
it.each(['task', 'expense'] as const)(
  'reauthorizes open %s details when another user changes the list version, withholding the old detail while pending',
  async (kind) => {
    const state = await setup(kind);
    state.version = 2;
    state.pause = true;
    fireEvent.click(screen.getByText('Poll list'));
    await screen.findByText('List version 2');
    await waitFor(() => expect(state.detailCalls).toBe(2));
    expect(screen.queryByDisplayValue('Private task context')).toBeNull();
    expect(screen.queryByText('Private expense context')).toBeNull();
    state.resolve!();
    if (kind === 'task') await screen.findByDisplayValue('Updated by another user');
    else await screen.findByText('Updated by another user');
  },
);
it('withholds an open expense after authoritative finance list exclusion', async () => {
  const state = await setup('expense');
  state.listed = false;
  fireEvent.click(screen.getByText('Poll list'));
  await screen.findByText('List version absent');
  await waitFor(() => expect(screen.queryByText('Private expense context')).toBeNull());
});

it('opens an authorized routed task beyond the first hundred list rows after all pages are confirmed', async () => {
  const state = await setup('task', true);
  expect(state.detailCalls).toBe(1);
  expect(screen.getByDisplayValue('Private task context')).toBeTruthy();
});

it('preserves only user edits through same-scope version loading and retains the inspected optimistic version until explicitly loading latest', async () => {
  const state = await setup('task');
  fireEvent.change(screen.getByDisplayValue('Private task context'), {
    target: { value: 'My unsaved editing work' },
  });
  state.version = 2;
  state.pause = true;
  fireEvent.click(screen.getByText('Poll list'));
  await screen.findByText('List version 2');
  await waitFor(() => expect(state.detailCalls).toBe(2));
  expect(screen.queryByDisplayValue('My unsaved editing work')).toBeNull();
  state.resolve!();
  await screen.findByDisplayValue('My unsaved editing work');
  expect(screen.getByText('Editing version 1')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Load latest version' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Version conflict. Refresh task before retrying.');
  expect(state.patches).toEqual([
    expect.objectContaining({ version: 1, description: 'My unsaved editing work' }),
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Load latest version' }));
  await screen.findByDisplayValue('Updated by another user');
  expect(screen.getByText('Editing version 2')).toBeTruthy();
  expect(screen.queryByDisplayValue('My unsaved editing work')).toBeNull();
});
it('clears user edits as well as fetched content on confirmed task exclusion, including when later access is restored', async () => {
  const state = await setup('task');
  fireEvent.change(screen.getByDisplayValue('Private task context'), {
    target: { value: 'Private unsaved edit' },
  });
  state.listed = false;
  fireEvent.click(screen.getByText('Poll list'));
  await screen.findByText('List version absent');
  expect(screen.queryByDisplayValue('Private unsaved edit')).toBeNull();
  state.listed = true;
  fireEvent.click(screen.getByText('Poll list'));
  await screen.findByDisplayValue('Private task context');
  expect(screen.queryByDisplayValue('Private unsaved edit')).toBeNull();
});
it('polls selected evidence even when the task version and membership basis do not change', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const state = await setup('task');
  fireEvent.click(screen.getByRole('button', { name: /^Activity/ }));
  await screen.findByText('Private task comment');
  state.polledComment = 'Discussion updated by another user';
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  await screen.findByText('Discussion updated by another user');
  expect(state.detailCalls).toBeGreaterThan(1);
  expect(screen.getByText('List version 1')).toBeTruthy();
});

it('preserves an expense decision note and its inspected version through loading, requiring deliberate review before any decision', async () => {
  const state = await setup('expense');
  fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
  fireEvent.change(await screen.findByLabelText(/^Changes required/), {
    target: { value: 'My independent review note' },
  });
  state.version = 2;
  state.pause = true;
  fireEvent.click(screen.getByText('Poll list'));
  await screen.findByText('List version 2');
  await waitFor(() => expect(state.detailCalls).toBe(2));
  expect(screen.queryByDisplayValue('My independent review note')).toBeNull();
  state.resolve!();
  await screen.findByDisplayValue('My independent review note');
  expect(screen.getByText('This expense changed while you were reviewing it.')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Request changes' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Review latest version' }));
  expect(screen.queryByDisplayValue('My independent review note')).toBeNull();
  expect(state.patches).toHaveLength(0);
});

it('clears draft RAM after detail reauthorization denies access even before the aggregate list refreshes', async () => {
  const state = await setup('task');
  fireEvent.change(screen.getByDisplayValue('Private task context'), {
    target: { value: 'Sensitive unsaved input' },
  });
  state.accessRevoked = true;
  fireEvent.click(screen.getByText('Poll detail'));
  await screen.findByText('Task access removed.');
  expect(screen.queryByDisplayValue('Sensitive unsaved input')).toBeNull();
  expect(screen.getByText('List version 1')).toBeTruthy();
  state.accessRevoked = false;
  fireEvent.click(screen.getByText('Poll detail'));
  await screen.findByDisplayValue('Private task context');
  expect(screen.queryByDisplayValue('Sensitive unsaved input')).toBeNull();
});

it.each(['task', 'expense'] as const)(
  'withholds same-key pending %s source and people, then restores authored input with its original inspected version',
  async (kind) => {
    const state = await setup(kind);
    expect(screen.getByLabelText('Selected people').textContent).toBe('Private resolved person');
    if (kind === 'task') {
      fireEvent.change(screen.getByDisplayValue('Private task context'), {
        target: { value: 'Same-key authored task edit' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^Activity/ }));
      await screen.findByText('Private task comment');
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
      fireEvent.change(await screen.findByLabelText(/^Changes required/), {
        target: { value: 'Same-key authored finance note' },
      });
    }
    state.pause = true;
    // A detail read can observe an updated source before the list refreshes.
    state.version = 2;
    fireEvent.click(screen.getByText('Poll detail'));
    await waitFor(() => expect(state.resolve).toBeDefined());
    expect(screen.getByLabelText('Selected source').getAttribute('data-description')).toBeNull();
    expect(screen.getByLabelText('Selected people').textContent).toBe('');
    expect(screen.queryByText('Private task comment')).toBeNull();
    expect(screen.queryByText('Private expense context')).toBeNull();
    expect(screen.queryByDisplayValue('Same-key authored finance note')).toBeNull();
    expect(screen.getByText('List version 1')).toBeTruthy();
    state.pause = false;
    state.resolve!();
    await waitFor(() =>
      expect(screen.getByLabelText('Selected source').getAttribute('data-description')).toBe(
        'Updated by another user',
      ),
    );
    expect(screen.getByLabelText('Selected people').textContent).toBe('Private resolved person');
    if (kind === 'task') {
      fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
      await screen.findByDisplayValue('Same-key authored task edit');
      expect(screen.getByText('Editing version 1')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Version conflict. Refresh task before retrying.');
      expect(state.patches).toEqual([
        expect.objectContaining({ version: 1, description: 'Same-key authored task edit' }),
      ]);
    } else {
      await screen.findByDisplayValue('Same-key authored finance note');
      expect(screen.getByText('This expense changed while you were reviewing it.')).toBeTruthy();
      expect(
        (screen.getByRole('button', { name: 'Request changes' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(state.patches).toHaveLength(0);
    }
  },
);

it.each(['task', 'expense'] as const)(
  'clears %s authored input after delayed same-key denial, without restoring it when access returns',
  async (kind) => {
    const state = await setup(kind);
    if (kind === 'task') {
      fireEvent.change(screen.getByDisplayValue('Private task context'), {
        target: { value: 'Revoked same-key task edit' },
      });
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
      fireEvent.change(await screen.findByLabelText(/^Changes required/), {
        target: { value: 'Revoked same-key finance note' },
      });
    }
    state.pause = true;
    fireEvent.click(screen.getByText('Poll detail'));
    await waitFor(() => expect(state.resolve).toBeDefined());
    expect(screen.getByLabelText('Selected source').getAttribute('data-description')).toBeNull();
    expect(screen.getByLabelText('Selected people').textContent).toBe('');
    expect(screen.queryByDisplayValue('Revoked same-key task edit')).toBeNull();
    expect(screen.queryByDisplayValue('Revoked same-key finance note')).toBeNull();
    state.accessRevoked = true;
    state.pause = false;
    state.resolve!();
    await screen.findByText('Task access removed.');
    expect(screen.getByLabelText('Selected people').textContent).toBe('');
    expect(screen.getByText('List version 1')).toBeTruthy();
    state.accessRevoked = false;
    fireEvent.click(screen.getByText('Poll detail'));
    await waitFor(() =>
      expect(screen.getByLabelText('Selected source').getAttribute('data-description')).toBe(
        kind === 'task' ? 'Private task context' : 'Private expense context',
      ),
    );
    expect(screen.queryByDisplayValue('Revoked same-key task edit')).toBeNull();
    expect(screen.queryByDisplayValue('Revoked same-key finance note')).toBeNull();
    if (kind === 'task') {
      expect(screen.getByDisplayValue('Private task context')).toBeTruthy();
      expect(screen.getByText('Editing version 1')).toBeTruthy();
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
      expect(
        ((await screen.findByLabelText(/^Changes required/)) as HTMLTextAreaElement).value,
      ).toBe('');
    }
  },
);
