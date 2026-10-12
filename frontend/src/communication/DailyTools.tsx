import { useEffect, useState, useEffectEvent } from 'react';
import { Bookmark, Pin, Search, BarChart3 } from 'lucide-react';
import type { Message } from './types';
import type { WorkspaceData } from '../types';
import '../styles/connect-dialogs.css';
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
  const unread = conversation ? (attention[conversation] ?? 0) : 0;
  return (
    <section className="connect-daily" aria-label="Find and save communication">
      <form
        className="connect-daily-search"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) void load('search');
        }}
      >
        <label>
          Search authorized messages
          <span className="connect-search">
            <Search size={16} aria-hidden="true" />
            <input
              value={q}
              placeholder="Words from a message…"
              onChange={(e) => setQ(e.target.value)}
            />
          </span>
        </label>
        <button className="button button-primary" disabled={!q.trim()}>
          Search
        </button>
      </form>
      <div className="connect-daily-modes" role="group" aria-label="Message collections">
        <button
          type="button"
          className="button button-secondary button-small"
          aria-pressed={mode === 'saved'}
          onClick={() => void load('saved')}
        >
          <Bookmark size={14} aria-hidden="true" />
          Saved and reminders
        </button>
        <button
          type="button"
          className="button button-secondary button-small"
          aria-pressed={mode === 'pins'}
          disabled={!conversation}
          onClick={() => void load('pins')}
        >
          <Pin size={14} aria-hidden="true" />
          Pinned messages
        </button>
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={() =>
            void command<typeof briefing>('/communication/briefing', undefined, 'GET')
              .then(setBriefing)
              .catch((e) => setError(e.message))
          }
        >
          <BarChart3 size={14} aria-hidden="true" />
          Published work briefing
        </button>
        {conversation && (
          <span className={'pill ' + (unread ? 'pill-orange' : 'pill-slate')}>
            {unread} unread here
          </span>
        )}
      </div>
      {briefing && (
        <div className="connect-briefing">
          <dl>
            <div>
              <dt>Visible tasks</dt>
              <dd>{briefing.visibleTaskCount}</dd>
            </div>
            <div>
              <dt>Open requests</dt>
              <dd>{briefing.visibleOpenRequestCount}</dd>
            </div>
            <div>
              <dt>Oldest open request</dt>
              <dd>{Math.floor(briefing.oldestVisibleOpenRequestAgeSeconds / 3600)} h</dd>
            </div>
          </dl>
          <p>{briefing.notice}</p>
        </div>
      )}
      {mode && (
        <div className="connect-results">
          <header>
            <h3>
              {mode === 'saved'
                ? 'Your saved messages and reminders'
                : mode === 'pins'
                  ? 'Pins in this conversation'
                  : 'Search results'}
              <span>{results.length}</span>
            </h3>
            <button
              type="button"
              className="button button-small connect-text-button"
              onClick={() => {
                setMode('');
                setResults([]);
              }}
            >
              Close results
            </button>
          </header>
          <ul>
            {results.map((m) => (
              <li key={m.id}>
                <p>{m.body}</p>
                <div className="connect-result-meta">
                  <span>
                    {data.people.find((p) => p.id === m.senderId)?.name ?? 'Company member'} ·
                    Revision {m.revision}
                  </span>
                  {reminders[m.id] && (
                    <span
                      className={
                        'pill ' +
                        (Date.parse(reminders[m.id]) <= Date.now() ? 'pill-red' : 'pill-orange')
                      }
                    >
                      {Date.parse(reminders[m.id]) <= Date.now() ? 'Reminder due' : 'Remind at'}{' '}
                      {new Date(reminders[m.id]).toLocaleString()}
                    </span>
                  )}
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    onClick={() => select(m.conversationId, m.id)}
                  >
                    Open conversation
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {results.length === 0 && <p className="connect-results-empty">No accessible messages.</p>}
        </div>
      )}
      {error && (
        <p role="alert" className="connect-error">
          {error}
        </p>
      )}
    </section>
  );
}
