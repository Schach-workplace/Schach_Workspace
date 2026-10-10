// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { ApiError } from '../data/api';
import { useCommunication } from './store';
import { clearAllDrafts } from './drafts';

const request = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ communicationRequest: request, streamURL: () => '' }));
afterEach(() => {
  cleanup();
  clearAllDrafts();
  vi.unstubAllGlobals();
});

it.each(['metadata', 'command'])(
  'removes a cached private title on %s authorization denial',
  async (lane) => {
    vi.stubGlobal('WebSocket', undefined);
    const conversation = { id: 'a', title: 'Private destination', version: 1 };
    request.mockImplementation(async (_company, path) => {
      if (path === '/conversations')
        return { conversations: [conversation], cursor: '', hasMore: false };
      if (path === '/conversations/a' && lane === 'metadata')
        throw new ApiError('Not found', 404, 'not_found');
      if (path === '/conversations/a') return { conversation, members: [] };
      if (path.endsWith('/messages')) return { messages: [], cursor: '', hasMore: false };
      if (path.endsWith('/sync')) return { events: [], cursor: '', hasMore: false };
      throw new ApiError('Not found', 404, 'not_found');
    });
    const { result } = renderHook(() => useCommunication('c', 'u'));
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));
    act(() => result.current.select('a'));
    if (lane === 'command') {
      await waitFor(() => expect(result.current.conversation?.id).toBe('a'));
      await act(async () => {
        await expect(result.current.command('/conversations/a/pin', {})).rejects.toMatchObject({
          status: 404,
        });
      });
    } else await waitFor(() => expect(result.current.error).toBe('Not found'));
    expect(result.current.conversations).toEqual([]);
    expect(result.current.conversation).toBeNull();
  },
);
