import { useEffect, useState, useEffectEvent } from 'react';
import type { Message } from './types';
import type { WorkspaceData } from '../types';
export default function DailyTools({
  conversation,
  data,
  command,
  select,
  initialMode = '',
}: {
  initialMode?: string;
  conversation: string;
  data: WorkspaceData;
  command: <T>(path: string, body: unknown, method?: string) => Promise<T>;
  select: (id: string, messageId: string) => void;
}) {
  const [briefing, setBriefing] = useState<{
    visibleTaskCount: number;
    visibleOpenRequestCount: number;
    oldestVisibleOpenRequestAgeSeconds: number;
    notice: string;
  } | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [reminders, setReminders] = useState<Record<string, string>>({});
  const [mode, setMode] = useState('');
  const [error, setError] = useState('');
  const [attention, setAttention] = useState<Record<string, number>>({});
  async function load(kind: string) {
    setError('');
    try {
      const path =
        kind === 'search'
          ? `/communication/search?q=${encodeURIComponent(q)}`
          : kind === 'pins'
            ? `/conversations/${conversation}/pins`
            : '/communication/saved';
      const result = await command<{ messages: Message[]; reminders?: Record<string, string> }>(
        path,
        undefined,
        'GET',
      );
      setResults(result.messages);
      setReminders(result.reminders ?? {});
      setMode(kind);
    } catch (e) {
      setResults([]);
      setReminders({});
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (initialMode) void load(initialMode);
  }, []);
  const refreshResults = useEffectEvent(() => {
    if (mode) void load(mode);
  });
  useEffect(() => {
    if (!mode) return;
    const timer = setInterval(() => refreshResults(), 15000);
    return () => clearInterval(timer);
  }, [mode]);
  useEffect(() => {
    void command<{ conversations: { conversationId: string; unread: number }[] }>(
      '/communication/attention',
      undefined,
      'GET',
    )
      .then((v) =>
        setAttention(Object.fromEntries(v.conversations.map((c) => [c.conversationId, c.unread]))),
      )
      .catch(() => {});
  }, [conversation]);
  return (
    <section className="connect-daily" aria-label="Find and save communication">
      <button
        onClick={() =>
          void command<typeof briefing>('/communication/briefing', undefined, 'GET')
            .then(setBriefing)
            .catch((e) => setError(e.message))
        }
      >
        Published work briefing
      </button>
      {briefing && (
        <p>
          {briefing.visibleTaskCount} visible tasks · {briefing.visibleOpenRequestCount} open
          requests · oldest open request{' '}
          {Math.floor(briefing.oldestVisibleOpenRequestAgeSeconds / 3600)} hours. {briefing.notice}
        </p>
      )}
      <label>
        Search authorized messages
        <input value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <button disabled={!q.trim()} onClick={() => void load('search')}>
        Search
      </button>
      <button onClick={() => void load('saved')}>Saved and reminders</button>
      <button disabled={!conversation} onClick={() => void load('pins')}>
        Pinned messages
      </button>
      {conversation && <span> {attention[conversation] ?? 0} unread</span>}
      {mode && (
        <div>
          <h3>
            {mode === 'saved'
              ? 'Your saved messages and reminders'
              : mode === 'pins'
                ? 'Pins in this conversation'
                : 'Search results'}
          </h3>
          {results.map((m) => (
            <article key={m.id}>
              <p>{m.body}</p>
              {reminders[m.id] && (
                <small>
                  {Date.parse(reminders[m.id]) <= Date.now() ? 'Reminder due' : 'Remind at'}{' '}
                  {new Date(reminders[m.id]).toLocaleString()}
                </small>
              )}
              <button onClick={() => select(m.conversationId, m.id)}>Open conversation</button>
              <span>
                {' '}
                · Revision {m.revision} ·{' '}
                {data.people.find((p) => p.id === m.senderId)?.name ?? 'Company member'}
              </span>
            </article>
          ))}
          {results.length === 0 && <p>No accessible messages.</p>}
          <button
            onClick={() => {
              setMode('');
              setResults([]);
            }}
          >
            Close results
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
