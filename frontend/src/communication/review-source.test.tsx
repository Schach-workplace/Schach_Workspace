// @vitest-environment happy-dom
import React from 'react';
import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import Connect from './Connect';
const env = vi.hoisted(() => ({ chat: null as any }));
vi.mock('../store', () => ({
  useWorkspace: () => ({
    companyId: 'c',
    session: { user: { id: 'u' } },
    mode: 'api',
    refresh: async () => {},
    data: {
      me: { id: 'u', role: 'member' },
      people: [],
      departments: [],
      company: { timezone: 'Asia/Kolkata' },
      expenseCategories: [],
    },
  }),
}));
vi.mock('./store', () => ({ useCommunication: () => env.chat }));
vi.mock('./Calls', () => ({ default: () => null }));
vi.mock('./MediaComposer', () => ({ default: () => null }));
vi.mock('./DailyTools', () => ({
  default: ({ select }: any) => <button onClick={() => select('a', 'old')}>Open old result</button>,
}));
afterEach(cleanup);
it('scrubs a removed thread source outside loaded history', async () => {
  const source = {
    id: 'old',
    conversationId: 'a',
    sequence: 1,
    revision: 1,
    body: 'Old private secret',
    removed: false,
    createdAt: '2026-10-10T00:00:00Z',
  };
  env.chat = {
    selected: 'a',
    conversation: { id: 'a', title: 'A', version: 1 },
    members: [{ userId: 'u', role: 'member', epoch: 1 }],
    conversations: [],
    messages: [],
    hasMore: false,
    privacyEpoch: 0,
    command: vi.fn(async (path: string) =>
      path.endsWith('/thread') ? { root: source, messages: [] } : { conversations: [] },
    ),
    select: () => {},
    refreshList: () => {},
  };
  const v = render(<Connect />);
  const search = screen
    .getAllByRole('button')
    .find((b) => /search|find messages/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''));
  if (!search)
    throw Error(
      'Search missing: ' +
        screen
          .getAllByRole('button')
          .map((b) => b.getAttribute('aria-label') || b.textContent)
          .join(','),
    );
  fireEvent.click(search);
  fireEvent.click(await screen.findByText('Open old result'));
  await screen.findByText('Old private secret');
  env.chat = {
    ...env.chat,
    messages: [],
    privacyEpoch: 1,
    changedSources: { revision: 1, ids: ['old'] },
  };
  v.rerender(<Connect />);
  await waitFor(() => expect(screen.queryByText('Old private secret')).toBeNull());
});

it.each(['removed', 'replaced'])(
  'rejects a pending unloaded target after it is %s',
  async (kind) => {
    let release: (v: any) => void = () => {};
    env.chat = {
      selected: 'a',
      conversation: { id: 'a', title: 'A', version: 1 },
      members: [{ userId: 'u', role: 'member', epoch: 1 }],
      conversations: [],
      messages: [],
      hasMore: false,
      privacyEpoch: 0,
      command: vi.fn(() => new Promise((r) => (release = r))),
      select: () => {},
      refreshList: () => {},
    };
    const v = render(<Connect />);
    const search = screen
      .getAllByRole('button')
      .find((b) =>
        /search|find messages/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
      )!;
    fireEvent.click(search);
    fireEvent.click(await screen.findByText('Open old result'));
    await waitFor(() => expect(env.chat.command).toHaveBeenCalled());
    if (kind === 'removed')
      env.chat = { ...env.chat, changedSources: { revision: 1, ids: ['old'] } };
    else
      env.chat = { ...env.chat, selected: 'b', conversation: { id: 'b', title: 'B', version: 1 } };
    v.rerender(<Connect />);
    release({ root: { id: 'old', body: 'Stale unloaded source', revision: 1 }, messages: [] });
    await waitFor(() => expect(screen.queryByText('Stale unloaded source')).toBeNull());
  },
);
it('keeps a freshly reauthorized unloaded source open after unrelated history publication', async () => {
  const source = { id: 'old', revision: 2, body: 'Fresh authorized source', removed: false };
  env.chat = {
    selected: 'a',
    conversation: { id: 'a', title: 'A', version: 1 },
    members: [{ userId: 'u', role: 'member', epoch: 1 }],
    conversations: [],
    messages: [],
    hasMore: false,
    privacyEpoch: 1,
    changedSources: { revision: 1, ids: ['old'], versions: { old: 1 } },
    command: vi.fn(async () => ({ root: source, messages: [] })),
    select: () => {},
    refreshList: () => {},
  };
  const v = render(<Connect />);
  const search = screen
    .getAllByRole('button')
    .find((b) =>
      /search|find messages/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
    )!;
  fireEvent.click(search);
  fireEvent.click(await screen.findByText('Open old result'));
  await screen.findByText('Fresh authorized source');
  env.chat = { ...env.chat, messages: [] };
  v.rerender(<Connect />);
  expect(screen.queryByText('Fresh authorized source')).not.toBeNull();
});
