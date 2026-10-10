import { useCallback, useEffect, useRef, useState } from 'react';
import { communicationRequest, streamURL } from './api';
import type { Conversation, Member, Message } from './types';
import { ApiError } from '../data/api';
import { ConversationHistory, authorizedSource } from './history';
import {
  clearConversationDrafts,
  clearDraftSources,
  readHistoryPosition,
  writeHistoryPosition,
} from './drafts';
export function useCommunication(company: string, user: string, enabled = true) {
  const key = company + ':' + user;
  const navigationScope = {
    serverOrigin: import.meta.env.VITE_API_URL || window.location.origin,
    companyId: company,
    userId: user,
    conversationId: '$navigation',
  };
  const live = useRef(key);
  live.current = key;
  const generation = useRef(0);
  const listGeneration = useRef(0);
  const engine = useRef<ConversationHistory<Message> | null>(null);
  const metaRef = useRef<{ conversation: Conversation; members: Member[] } | null>(null);
  const [scope, setScope] = useState(key);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState('');
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [privacyEpoch, setPrivacyEpoch] = useState(0);
  const [listCursor, setListCursor] = useState('');
  const [listHasMore, setListHasMore] = useState(false);
  const [olderBusy, setOlderBusy] = useState(false);
  const [foreground, setForeground] = useState(document.visibilityState !== 'hidden');
  const commands = useRef(new Set<AbortController>());
  const [changedSources, setChangedSources] = useState({
    revision: 0,
    ids: [] as string[],
    versions: {} as Record<string, number>,
  });
  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState === 'hidden') {
        if (selected && engine.current?.messages.length)
          writeHistoryPosition(
            { ...navigationScope, conversationId: selected },
            { oldestSequence: engine.current.messages[0].sequence },
          );
        generation.current++;
        listGeneration.current++;
        for (const request of commands.current) request.abort();
        engine.current?.dispose();
        engine.current = null;
        setConversations([]);
        setMessages([]);
        setConversation(null);
        setMembers([]);
        setConnected(false);
      }
      setForeground(document.visibilityState !== 'hidden');
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, [key, selected]);
  const syncRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(async () => syncRef.current(), []);
  useEffect(() => {
    generation.current++;
    listGeneration.current++;
    setScope(key);
    setSelected(readHistoryPosition(navigationScope)?.anchorId ?? '');
    setConversations([]);
    setMessages([]);
    setConversation(null);
    setMembers([]);
    setListCursor('');
    setListHasMore(false);
    const current = listGeneration.current;
    const abort = new AbortController();
    if (enabled && foreground && company && user)
      communicationRequest<{ conversations: Conversation[]; cursor: string; hasMore: boolean }>(
        company,
        '/conversations',
        { signal: abort.signal },
      )
        .then((v) => {
          if (current === listGeneration.current && live.current === key) {
            setConversations(v.conversations);
            setListCursor(v.cursor);
            setListHasMore(v.hasMore);
          }
        })
        .catch((e) => {
          if (e.name !== 'AbortError' && current === listGeneration.current) setError(e.message);
        });
    return () => {
      abort.abort();
      generation.current++;
      listGeneration.current++;
    };
  }, [key, enabled, company, user, foreground]);
  useEffect(() => {
    const current = ++generation.current;
    let disposed = false;
    const abort = new AbortController();
    let socket: WebSocket | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let overflow = false;
    let lane: Promise<void> = Promise.resolve();
    let pending: Promise<void> | null = null;
    const active = () =>
      !disposed &&
      document.visibilityState !== 'hidden' &&
      current === generation.current &&
      live.current === key;
    setMessages([]);
    setConversation(null);
    setMembers([]);
    setConnected(false);
    setHasMore(false);
    metaRef.current = null;
    engine.current = null;
    setChangedSources({ revision: 0, ids: [], versions: {} });
    if (!enabled || !foreground || !selected) {
      syncRef.current = async () => {};
      return () => {
        disposed = true;
        abort.abort();
      };
    }
    const root = `/conversations/${selected}`;
    const draftScope = {
      serverOrigin: import.meta.env.VITE_API_URL || window.location.origin,
      companyId: company,
      userId: user,
      conversationId: selected,
    };
    const savePosition = () => {
      if (engine.current?.messages.length)
        writeHistoryPosition(draftScope, { oldestSequence: engine.current.messages[0].sequence });
    };
    const hide = () => {
      if (!active()) return;
      setMessages([]);
      setConversation(null);
      setMembers([]);
      setConnected(false);
    };
    const boundary = () => {
      hide();
      clearConversationDrafts(company, user, selected);
      metaRef.current = null;
      engine.current?.dispose();
      engine.current = null;
      setPrivacyEpoch((p) => p + 1);
    };
    const create = () => {
      const h = new ConversationHistory<Message>(
        (path) => communicationRequest(company, root + path, { signal: abort.signal }),
        (ids) => {
          if (!active() || engine.current !== h) return;
          if (ids.length) {
            setChangedSources((old) => ({
              revision: old.revision + 1,
              ids: [...new Set([...old.ids, ...ids])],
              versions: {
                ...old.versions,
                ...Object.fromEntries(ids.map((id) => [id, old.revision + 1])),
              },
            }));
            clearDraftSources(company, user, selected, ids);
            setPrivacyEpoch((p) => p + 1);
          }
          setMessages([...h.messages]);
          setHasMore(h.hasMore);
        },
      );
      engine.current = h;
      return h;
    };
    const check = async () => {
      const meta = await communicationRequest<{ conversation: Conversation; members: Member[] }>(
        company,
        root,
        { signal: abort.signal },
      );
      if (!active()) return null;
      const old = metaRef.current;
      const own = (m: Member[]) => m.find((x) => x.userId === user);
      const a = old && own(old.members),
        b = own(meta.members);
      if (
        old &&
        (old.conversation.version !== meta.conversation.version ||
          a?.epoch !== b?.epoch ||
          a?.role !== b?.role ||
          a?.historyFromSequence !== b?.historyFromSequence)
      ) {
        boundary();
      }
      const policyKey = JSON.stringify([
        meta.conversation.version,
        b?.epoch,
        b?.role,
        b?.historyFromSequence,
      ]);
      const saved = readHistoryPosition(draftScope);
      if (saved?.policyKey && saved.policyKey !== policyKey) boundary();
      writeHistoryPosition(draftScope, { policyKey });
      metaRef.current = meta;
      return meta;
    };
    const perform = async () => {
      if (!active() || document.visibilityState === 'hidden') return;
      try {
        const meta = await check();
        if (!meta || !active()) return;
        let h = engine.current;
        if (!h) {
          h = create();
          await h.bootstrap();
          const saved = readHistoryPosition(draftScope);
          if (saved && saved.oldestSequence < (h.messages[0]?.sequence ?? 0))
            await h.reconcileLoadedRange(saved.oldestSequence);
        } else {
          if (overflow) {
            await h.reconcileLoadedRange();
            overflow = false;
          }
          await h.sync();
        }
        if (!active()) return;
        setConversation(meta.conversation);
        setMembers(meta.members);
        setMessages([...h.messages]);
        setHasMore(h.hasMore);
        setError('');
      } catch (e) {
        if (!active() || (e as Error).name === 'AbortError') return;
        if (
          e instanceof ApiError &&
          ([401, 403, 404].includes(e.status) ||
            (e.status === 409 && e.code === 'refetch_required'))
        ) {
          boundary();
          if ([401, 403, 404].includes(e.status)) {
            listGeneration.current++;
            setConversations((old) => old.filter((c) => c.id !== selected));
          }
        }
        setError((e as Error).message);
      }
    };
    const schedule = () => {
      if (pending) return pending;
      const p = lane.catch(() => {}).then(perform);
      lane = p;
      pending = p;
      void p
        .finally(() => {
          if (pending === p) pending = null;
        })
        .catch(() => {});
      return p;
    };
    syncRef.current = schedule;
    void schedule();
    const connect = () => {
      if (!active() || document.visibilityState === 'hidden') return;
      socket = new WebSocket(streamURL(company, selected));
      let lastHint = 0;
      socket.onopen = () => {
        if (active()) setConnected(true);
      };
      socket.onmessage = (e) => {
        if (!active()) return;
        try {
          const hint = JSON.parse(String(e.data));
          if (
            hint.conversationId !== selected ||
            !['ready', 'changed', 'refetch_required'].includes(hint.kind)
          )
            return;
          if (hint.kind === 'refetch_required') {
            overflow = true;
            hide();
          } else if (hint.kind === 'changed') {
            if (!Number.isSafeInteger(hint.eventSequence) || hint.eventSequence <= lastHint) return;
            lastHint = hint.eventSequence;
          }
          window.dispatchEvent(
            new CustomEvent('schach-work-event', {
              detail: { company, user, kind: hint.eventKind ?? hint.kind },
            }),
          );
          void schedule();
        } catch {}
      };
      socket.onclose = (e) => {
        if (!active()) return;
        setConnected(false);
        if (e.code === 1008) {
          hide();
          overflow = true;
          void schedule();
        }
        reconnect = setTimeout(connect, 2000);
      };
      socket.onerror = () => socket?.close();
    };
    if (typeof WebSocket !== 'undefined') connect();
    const poll = setInterval(() => void schedule(), 15000);
    return () => {
      savePosition();
      disposed = true;
      abort.abort();
      clearInterval(poll);
      if (reconnect) clearTimeout(reconnect);
      socket?.close();
      engine.current?.dispose();
      engine.current = null;
      generation.current++;
    };
  }, [company, user, selected, enabled, key, foreground]);
  const command = async <T,>(path: string, body: unknown, method = 'POST'): Promise<T> => {
    const current = generation.current;
    const inForeground = () => document.visibilityState !== 'hidden';
    if (live.current !== key || !inForeground()) throw Error('Company changed or backgrounded.');
    const abort = new AbortController();
    commands.current.add(abort);
    try {
      const read = (p: string) =>
        communicationRequest<T>(company, p, { method, body, signal: abort.signal });
      const source =
        method === 'GET' && /^\/conversations\/[^/]+\/messages\/[^/]+\/thread$/.test(path);
      const result = source
        ? await authorizedSource<T>(read, path, path.split('/messages/')[0])
        : await read(path);
      if (current !== generation.current || live.current !== key)
        throw Error('Company or conversation changed.');
      const canonical = (result as { message?: Message })?.message;
      if (canonical && canonical.conversationId === selected)
        await engine.current?.merge([canonical]);
      if (method !== 'GET' && !path.endsWith('/read')) await refresh();
      if (current !== generation.current || live.current !== key || !inForeground())
        throw Error('Company or conversation changed.');
      return result;
    } catch (e) {
      if (
        current === generation.current &&
        live.current === key &&
        e instanceof ApiError &&
        [401, 403, 404].includes(e.status)
      ) {
        listGeneration.current++;
        setConversations((old) => old.filter((c) => c.id !== selected));
        clearConversationDrafts(company, user, selected);
        setMessages([]);
        setConversation(null);
        setMembers([]);
        engine.current?.dispose();
        engine.current = null;
        setPrivacyEpoch((p) => p + 1);
      }
      throw e;
    } finally {
      commands.current.delete(abort);
    }
  };
  const loadMore = async () => {
    if (olderBusy) return;
    setOlderBusy(true);
    try {
      await engine.current?.older();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOlderBusy(false);
    }
  };
  const refreshList = async () => {
    const current = listGeneration.current;
    const v = await communicationRequest<{
      conversations: Conversation[];
      cursor: string;
      hasMore: boolean;
    }>(company, '/conversations');
    if (current !== listGeneration.current || live.current !== key) return;
    setConversations(v.conversations);
    setListCursor(v.cursor);
    setListHasMore(v.hasMore);
  };
  const loadMoreConversations = async () => {
    const current = listGeneration.current;
    const v = await communicationRequest<{
      conversations: Conversation[];
      cursor: string;
      hasMore: boolean;
    }>(company, '/conversations?cursor=' + encodeURIComponent(listCursor));
    if (current !== listGeneration.current || live.current !== key) return;
    setConversations((old) => [
      ...new Map([...old, ...v.conversations].map((c) => [c.id, c])).values(),
    ]);
    setListCursor(v.cursor);
    setListHasMore(v.hasMore);
  };
  return {
    conversations: scope === key ? conversations : [],
    selected: scope === key ? selected : '',
    select: (id: string) => {
      if (live.current === key) {
        writeHistoryPosition(navigationScope, { anchorId: id });
        setSelected(id);
      }
    },
    conversation: scope === key ? conversation : null,
    members: scope === key ? members : [],
    messages: scope === key ? messages : [],
    error,
    connected,
    privacyEpoch,
    changedSources,
    command,
    refresh,
    hasMore,
    loadMore,
    refreshList,
    listHasMore,
    loadMoreConversations,
    olderBusy,
  };
}
