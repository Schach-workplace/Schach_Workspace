// @vitest-environment happy-dom
import { it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useCommunication } from './store';
import { clearAllDrafts } from './drafts';
const env = vi.hoisted(() => ({ hidden: false, release: null as any, hold: '' }));
vi.mock('./api', () => ({
  streamURL: () => '',
  communicationRequest: async (_: string, path: string) => {
    const value =
      path === '/conversations'
        ? { conversations: [{ id: 'a', title: 'Private title' }], cursor: '', hasMore: false }
        : path === '/conversations/a'
          ? {
              conversation: { id: 'a', title: 'Private title', version: 1 },
              members: [{ userId: 'u', epoch: 1, role: 'member' }],
            }
          : path.includes('/sync')
            ? { events: [], cursor: 'e', hasMore: false }
            : {
                messages: [
                  { id: 'm', sequence: 1, revision: 1, body: 'Private body', removed: false },
                ],
                cursor: 'older',
                hasMore: true,
              };
    return env.hold === path ? new Promise((r) => (env.release = () => r(value))) : value;
  },
}));
beforeEach(() => {
  clearAllDrafts();
  env.hidden = false;
  env.release = null;
  env.hold = '';
  vi.stubGlobal('WebSocket', undefined);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
    env.hidden ? 'hidden' : 'visible',
  );
});
afterEach(() => {
  cleanup();
  clearAllDrafts();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it.each(['metadata', 'history', 'older', 'list', 'command'])(
  'rejects a late %s response while hidden',
  async (lane) => {
    const { result } = renderHook(() => useCommunication('c', 'u'));
    act(() => result.current.select('a'));
    await waitFor(() => expect(result.current.messages.length).toBe(1));
    let pending: Promise<unknown> = Promise.resolve();
    if (lane === 'metadata') {
      env.hold = '/conversations/a';
      act(() => {
        pending = result.current.refresh();
      });
    }
    if (lane === 'history') {
      env.hold = '/conversations/a/sync?cursor=e';
      act(() => {
        pending = result.current.refresh();
      });
    }
    if (lane === 'older') {
      env.hold = '/conversations/a/messages?cursor=older';
      act(() => {
        pending = result.current.loadMore();
      });
    }
    if (lane === 'list') {
      env.hold = '/conversations';
      act(() => {
        pending = result.current.refreshList();
      });
    }
    if (lane === 'command') {
      env.hold = '/conversations/a/action';
      act(() => {
        pending = result.current.command(env.hold, {}).catch((e) => e);
      });
    }
    await waitFor(() => expect(env.release).toBeTruthy());
    await act(async () => {
      env.hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.conversation).toBeNull();
    await act(async () => {
      env.release();
      await pending;
    });
    expect(result.current.conversation).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(result.current.conversations).toEqual([]);
    if (lane === 'command') expect(await pending).toBeInstanceOf(Error);
  },
);
