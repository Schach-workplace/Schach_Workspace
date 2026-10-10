import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Users, Hash, Search, Check } from 'lucide-react';
import { Avatar, Modal } from '../components/UI';
import type { WorkspaceData } from '../types';
export default function NewConversation({
  data,
  command,
  onOpen,
  onClose,
}: {
  data: WorkspaceData;
  command: <T>(path: string, body: unknown, method?: string) => Promise<T>;
  onOpen: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<'dm' | 'group' | 'channel'>('dm');
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [publicChannel, setPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const people = data.people.filter(
    (p) =>
      p.active &&
      p.id !== data.me.id &&
      p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  async function create(participants = ids) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await command<{ id: string }>('/conversations', {
        kind,
        ...(kind !== 'dm' ? { title: title.trim() } : {}),
        participantIds: participants,
        public: kind === 'channel' && publicChannel,
      });
      if (alive.current) await onOpen(result.id);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="New conversation"
      description="Start with a person, or bring your team together."
      onClose={onClose}
    >
      <div className="connect-dialog-body">
        <div className="connect-kind-picker">
          {(
            [
              ['dm', 'Direct message', MessageCircle],
              ['group', 'Private group', Users],
              ['channel', 'Channel', Hash],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              type="button"
              key={value}
              aria-pressed={kind === value}
              disabled={busy}
              onClick={() => {
                setKind(value);
                setIds([]);
                setError('');
              }}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </div>
        {kind === 'dm' ? (
          <p className="connect-hint">
            Choose a person to open your existing chat or start a new one. Only the two of you can
            access it.
          </p>
        ) : (
          <label>
            Conversation name
            <input
              maxLength={120}
              placeholder={kind === 'group' ? 'e.g. Site coordination' : 'e.g. Project updates'}
              value={title}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        )}
        {kind === 'channel' && (
          <label className="connect-check">
            <input
              type="checkbox"
              checked={publicChannel}
              disabled={busy}
              onChange={(e) => setPublic(e.target.checked)}
            />
            Company channel — every active company member can read retained history.
          </label>
        )}
        <label className="connect-search">
          <Search size={17} />
          <input
            aria-label="Find a person"
            placeholder="Find a person…"
            value={query}
            disabled={busy}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="connect-people">
          {people.map((p) => (
            <button
              type="button"
              aria-label={p.name}
              aria-pressed={kind === 'dm' ? undefined : ids.includes(p.id)}
              disabled={busy}
              key={p.id}
              onClick={() =>
                kind === 'dm'
                  ? void create([p.id])
                  : setIds((old) =>
                      old.includes(p.id) ? old.filter((id) => id !== p.id) : [...old, p.id],
                    )
              }
            >
              <Avatar name={p.name} />
              <span>
                <strong>{p.name}</strong>
                <small>
                  {kind === 'dm'
                    ? 'Open direct message'
                    : ids.includes(p.id)
                      ? 'Selected'
                      : 'Add to conversation'}
                </small>
              </span>
              {ids.includes(p.id) && <Check size={18} />}
            </button>
          ))}
          {people.length === 0 && <p>No active people match your search.</p>}
        </div>
        {error && (
          <p role="alert" className="connect-error">
            {error}
          </p>
        )}
        {busy && <p role="status">Opening conversation…</p>}
        {kind !== 'dm' && (
          <div className="connect-dialog-footer">
            <span>{ids.length} people selected</span>
            <button
              className="button button-primary"
              disabled={busy || !title.trim() || (!publicChannel && ids.length === 0)}
              onClick={() => void create()}
            >
              {busy
                ? 'Creating…'
                : publicChannel && kind === 'channel'
                  ? 'Create company channel'
                  : 'Create conversation'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
