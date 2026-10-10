// @vitest-environment happy-dom
import { it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useCommunication } from './store';
import { writeDraft, readDraft, clearAllDrafts } from './drafts';
const env = vi.hoisted(() => ({ replay: false }));
vi.mock('./api', async () => {
  const { ApiError } = await import('../data/api');
  return {
    streamURL: () => '',
    communicationRequest: async (_: string, path: string) => {
      if (path === '/conversations') return { conversations: [], cursor: '', hasMore: false };
      if (path === '/conversations/a')
        return {
          conversation: { id: 'a', version: 1 },
          members: [{ userId: 'u', role: 'member', epoch: 1 }],
        };
      if (path.endsWith('/sync')) return { events: [], cursor: 'e', hasMore: false };
      if (path.includes('/sync?'))
        return {
          events: env.replay ? [{ kind: 'message_created', messageId: 'deleted' }] : [],
          cursor: 'e',
          hasMore: false,
        };
      if (path.endsWith('/thread')) throw new ApiError('Message not found', 404, 'not_found');
      return { messages: [], cursor: 'o', hasMore: false };
    },
  };
});
afterEach(() => {
  cleanup();
  clearAllDrafts();
  vi.unstubAllGlobals();
});
it('retains authored draft when a replayed root was deleted but metadata stays authorized', async () => {
  vi.stubGlobal('WebSocket', undefined);
  const { result } = renderHook(() => useCommunication('c', 'u'));
  act(() => result.current.select('a'));
  await waitFor(() => expect(result.current.conversation?.id).toBe('a'));
  const scope = {
    serverOrigin: window.location.origin,
    companyId: 'c',
    userId: 'u',
    conversationId: 'a',
  };
  writeDraft(scope, { body: 'Unsent authorized text' });
  env.replay = true;
  await act(async () => result.current.refresh());
  expect(readDraft(scope).body).toBe('Unsent authorized text');
});
