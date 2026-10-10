import { useState, useId, useSyncExternalStore, useEffect, useRef } from 'react';
import { readDraft, writeDraft, subscribeDraft, type DraftScope } from './drafts';
import type { Message, Member } from './types';
interface Send {
  clientMessageId: string;
  body: string;
  replyToId: string;
  mentionIds?: string[];
  mentionAll?: boolean;
}
export default function Composer({
  send,
  scope: providedScope,
  disabled,
  reply,
  onClearReply,
  members = [],
  names = {},
  canMentionAll = false,
}: {
  scope?: DraftScope;
  members?: Member[];
  names?: Record<string, string>;
  canMentionAll?: boolean;
  send: (input: Send) => Promise<{ message: Message }>;
  disabled: boolean;
  reply: Message | null;
  onClearReply: () => void;
}) {
  const composerId = useId();
  const scope = providedScope ?? {
    serverOrigin: 'local',
    companyId: '',
    userId: '',
    conversationId: composerId,
  };
  const state = useSyncExternalStore(subscribeDraft, () => readDraft(scope));
  const {
    body: draft,
    mentionIds: mentions,
    mentionAll: all,
    pendingPayload: pending,
    busy,
    error,
  } = state;
  const setDraft = (body: string) => writeDraft(scope, { body });
  const setMentions = (fn: (ids: string[]) => string[]) =>
    writeDraft(scope, { mentionIds: fn(readDraft(scope).mentionIds) });
  const setAll = (mentionAll: boolean) => writeDraft(scope, { mentionAll });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [mentionQuery, setMentionQuery] = useState('');
  async function submit(input: Send) {
    if (readDraft(scope).busy) return;
    const frozen = Object.freeze({
      ...input,
      mentionIds: Object.freeze([...(input.mentionIds ?? [])]) as unknown as string[],
    });
    writeDraft(scope, {
      pendingPayload: frozen,
      replyToId: frozen.replyToId,
      busy: true,
      error: '',
    });
    try {
      await send(frozen);
      if (readDraft(scope).pendingPayload !== frozen) return;
      writeDraft(scope, {
        pendingPayload: null,
        body: '',
        mentionIds: [],
        mentionAll: false,
        replyToId: '',
        error: '',
        busy: false,
      });
      if (alive.current) onClearReply();
    } catch (e) {
      if (readDraft(scope).pendingPayload === frozen)
        writeDraft(scope, { error: (e as Error).message, busy: false });
    }
  }
  return (
    <form
      className="connect-composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.trim() || busy || disabled) return;
        void submit(
          pending ?? {
            clientMessageId: crypto.randomUUID(),
            body: draft,
            replyToId: reply?.id ?? '',
            mentionIds: mentions,
            mentionAll: all,
          },
        );
      }}
    >
      {reply && (
        <div>
          Reply to {reply.body.slice(0, 80)}{' '}
          <button
            type="button"
            disabled={busy || !!pending}
            onClick={() => {
              writeDraft(scope, { replyToId: '' });
              onClearReply();
            }}
          >
            Cancel reply
          </button>
        </div>
      )}
      <label htmlFor={composerId}>Message</label>
      <textarea
        id={composerId}
        maxLength={20000}
        disabled={disabled || busy || !!pending}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder="Write a message…"
      />
      <details className="connect-mentions">
        <summary>Mention participants</summary>
        <p>Selected: {mentions.map((id) => names[id] ?? 'Company member').join(', ') || 'None'}</p>
        <label>
          Find participant
          <input value={mentionQuery} onChange={(e) => setMentionQuery(e.target.value)} />
        </label>
        {members
          .filter(
            (m) =>
              m.active &&
              (names[m.userId] ?? 'Company member')
                .toLocaleLowerCase()
                .includes(mentionQuery.toLocaleLowerCase()),
          )
          .map((m) => (
            <label key={m.userId}>
              <input
                type="checkbox"
                disabled={disabled || busy || !!pending}
                checked={mentions.includes(m.userId)}
                onChange={(e) =>
                  setMentions((ids) =>
                    e.target.checked ? [...ids, m.userId] : ids.filter((id) => id !== m.userId),
                  )
                }
              />
              {names[m.userId] ?? 'Company member'}
            </label>
          ))}
        {canMentionAll && (
          <label>
            <input
              type="checkbox"
              disabled={disabled || busy || !!pending}
              checked={all}
              onChange={(e) => setAll(e.target.checked)}
            />
            Mention everyone (limited to once per five minutes)
          </label>
        )}
      </details>
      {error && <p role="alert">{error} Your message is waiting for a confirmed response.</p>}
      <div className="connect-send-row">
        <span className="connect-hint">Enter to send · Shift + Enter for a new line</span>
        <button className="button button-primary" disabled={disabled || busy || !draft.trim()}>
          {busy ? 'Sending…' : pending ? 'Retry same message' : 'Send'}
        </button>
        {pending && !busy && (
          <button
            type="button"
            onClick={() => {
              writeDraft(scope, { pendingPayload: null, error: '' });
            }}
          >
            Return to draft
          </button>
        )}
      </div>
    </form>
  );
}
