import IntelligenceLauncher from '../components/IntelligenceLauncher';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  structuredPeople,
  type StructuredMember,
} from '../../../shared/communication/structuredPeople';
import { deadlineCandidates } from '../data/deadlines';
import type { Message, Conversation } from './types';
import type { WorkspaceData } from '../types';
interface RecordItem {
  id: string;
  kind: 'ack' | 'poll' | 'event' | 'decision';
  title: string;
  body: string;
  revision: number;
  createdBy: string;
  reviewerId: string;
  options: string[];
  state: string;
  anchorMessageId: string;
  dueAt: string;
}
interface Recipient {
  recordId: string;
  revision: number;
  userId: string;
  response: string;
}
export default function Structured({
  conversation,
  source,
  data,
  command,
  onClose,
  recordId,
  members = [],
  sourceReady = false,
}: {
  conversation: Conversation;
  members?: StructuredMember[];
  sourceReady?: boolean;
  recordId?: string;
  source: Message | null;
  data: WorkspaceData;
  command: <T>(path: string, body: unknown, method?: string) => Promise<T>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<RecordItem['kind']>('ack');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [options, setOptions] = useState('Yes\nNo');
  const [audience, setAudience] = useState<string[]>([]);
  const [reviewer, setReviewer] = useState('');
  const [due, setDue] = useState('');
  const [fold, setFold] = useState('');
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const creating = useRef(false);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [editing, setEditing] = useState<RecordItem | null>(null);
  const [nextBody, setNextBody] = useState('');
  const [reason, setReason] = useState('');
  const root = `/conversations/${conversation.id}/records`;
  const owner = useMemo(
    () => ({}),
    [
      root,
      recordId,
      data.me.id,
      data.readBasis,
      conversation.version,
      source?.id,
      source?.revision,
      sourceReady,
    ],
  );
  const active = useRef<object | null>(null);
  useLayoutEffect(() => {
    active.current = owner;
    return () => {
      if (active.current === owner) active.current = null;
    };
  }, [owner]);
  const current = () => active.current === owner;
  const choices = structuredPeople(
    data.people,
    members,
    conversation.public,
    source?.sequence ?? 0,
    data.me.id,
    kind === 'decision',
  );
  const matching = choices.filter((p) =>
    p.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const selectionReady =
    kind === 'decision'
      ? choices.some((p) => p.id === reviewer)
      : audience.length > 0 && audience.every((id) => choices.some((p) => p.id === id));
  const candidates = due ? deadlineCandidates(due, data.company.timezone) : [];
  const locked = busy || !!pending;
  async function refresh() {
    const v = recordId
      ? await command<{ record: RecordItem; responses: Recipient[] }>(
          root + '/' + recordId,
          undefined,
          'GET',
        ).then((r) => ({ records: [r.record], responses: r.responses }))
      : await command<{ records: RecordItem[]; responses: Recipient[] }>(root, undefined, 'GET');
    if (current()) {
      setRecords(v.records);
      setRecipients(v.responses);
    }
  }
  useEffect(() => {
    void refresh().catch((e) => {
      if (current()) setError(e.message);
    });
  }, [conversation.id, recordId]);
  async function create() {
    if (!source || !sourceReady || creating.current || (!pending && !selectionReady)) return;
    creating.current = true;
    setBusy(true);
    setError('');
    try {
      let input = pending;
      if (!input) {
        if (due && (!candidates.length || (candidates.length > 1 && !candidates.includes(fold))))
          throw Error(
            candidates.length
              ? 'Choose an offset for this repeated local time.'
              : 'This local time does not exist. Choose another time.',
          );
        input = {
          retryKey: key,
          kind,
          anchorMessageId: source.id,
          sourceRevision: source.revision,
          title,
          body,
          options: kind === 'poll' ? options.split('\n').filter(Boolean) : [],
          recipientIds: audience,
          reviewerId: kind === 'decision' ? reviewer : '',
          dueAt: due ? (candidates.length === 1 ? candidates[0] : fold) : '',
        };
        setPending(input);
      }
      await command(root, input);
      if (!current()) return;
      await refresh();
      if (current()) {
        setPending(null);
        setKey(crypto.randomUUID());
        onClose();
      }
    } catch (e) {
      if (current()) setError((e as Error).message);
    } finally {
      creating.current = false;
      if (current()) setBusy(false);
    }
  }
  async function respond(record: RecordItem, response: string) {
    try {
      await command(`${root}/${record.id}/respond`, {
        expectedRevision: record.revision,
        response,
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function revise() {
    if (!editing || !reason.trim() || busy) return;
    setBusy(true);
    try {
      await command(
        `${root}/${editing.id}`,
        {
          expectedRevision: editing.revision,
          title: editing.title,
          body: nextBody,
          options: editing.options,
          dueAt: editing.dueAt,
          reason,
        },
        'PATCH',
      );
      setEditing(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Structured communication">
      <h3>Structured communication</h3>
      <p>
        Acknowledgement confirms receipt of a revision. Polls, RSVPs and decisions have their own
        records; task and financial approvals remain separate.
      </p>
      {source && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <p>Source revision {source.revision}</p>
          <label>
            Record type
            <select
              disabled={locked}
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="ack">Acknowledgement request</option>
              <option value="poll">Poll</option>
              <option value="event">Event / RSVP</option>
              <option value="decision">Reviewed decision</option>
            </select>
          </label>
          <label>
            Title
            <input
              required
              disabled={locked}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Selected content
            <textarea disabled={locked} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          {kind === 'poll' && (
            <label>
              Options, one per line
              <textarea
                disabled={locked}
                value={options}
                onChange={(e) => setOptions(e.target.value)}
              />
            </label>
          )}
          <label>
            Response deadline ({data.company.timezone}, optional)
            <input
              type="datetime-local"
              disabled={locked}
              value={due}
              onChange={(e) => {
                setDue(e.target.value);
                setFold('');
              }}
            />
          </label>
          {due && candidates.length > 1 && (
            <label>
              Repeated time offset
              <select disabled={locked} value={fold} onChange={(e) => setFold(e.target.value)}>
                <option value="">Choose offset</option>
                {candidates.map((instant) => (
                  <option key={instant} value={instant}>
                    {instant}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Search eligible people
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          {!sourceReady && <p role="status">Checking current source access…</p>}
          {kind === 'decision' ? (
            <label>
              Independent reviewer
              <select
                disabled={locked || !sourceReady}
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
              >
                <option value="">Choose reviewer</option>
                {matching.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <fieldset>
              <legend>Fixed recipients with source access</legend>
              {matching.map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    disabled={locked || !sourceReady}
                    checked={audience.includes(p.id)}
                    onChange={(e) =>
                      setAudience((old) =>
                        e.target.checked ? [...old, p.id] : old.filter((id) => id !== p.id),
                      )
                    }
                  />
                  {p.name}
                </label>
              ))}
            </fieldset>
          )}
          <button disabled={busy || !sourceReady || !title.trim() || (!pending && !selectionReady)}>
            {pending ? 'Retry same structured record' : 'Create structured record'}
          </button>
          {pending && (
            <p>
              Submitted intent is frozen. Retry it unchanged. If you close, inspect existing records
              before creating another.
            </p>
          )}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </form>
      )}
      <IntelligenceLauncher
        choices={records.flatMap((record) =>
          ['content', 'content_responses'].map((selectedFieldSet) => ({
            label:
              record.title +
              (selectedFieldSet === 'content_responses' ? ' and current responses' : ''),
            source: {
              kind: 'record',
              id: record.id,
              parentId: record.anchorMessageId,
              conversationId: conversation.id,
              expectedRevision: record.revision,
              selectedFieldSet,
            },
          })),
        )}
      />
      {records.map((record) => {
        const mine = recipients.find(
          (p) =>
            p.recordId === record.id && p.revision === record.revision && p.userId === data.me.id,
        );
        return (
          <article key={record.id}>
            <h4>
              {record.title} · revision {record.revision}
            </h4>
            <p>{record.body}</p>
            <p>
              {record.state}
              {mine?.response ? ` · Your response: ${mine.response}` : ''}
            </p>
            {mine &&
              record.state === 'open' &&
              data.me.role !== 'viewer' &&
              (record.kind === 'ack'
                ? ['acknowledged']
                : record.kind === 'poll'
                  ? record.options
                  : record.kind === 'event'
                    ? ['attending', 'maybe', 'declined']
                    : ['confirmed', 'rejected']
              ).map((response) => (
                <button key={response} onClick={() => void respond(record, response)}>
                  {response}
                </button>
              ))}
            {record.createdBy === data.me.id && (
              <button
                onClick={() => {
                  setEditing(record);
                  setNextBody(record.body);
                  setReason('');
                }}
              >
                Publish a new revision
              </button>
            )}
          </article>
        );
      })}
      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void revise();
          }}
        >
          <h4>Publish a new material revision</h4>
          <label>
            New revision content
            <textarea
              value={nextBody}
              disabled={busy}
              onChange={(e) => setNextBody(e.target.value)}
            />
          </label>
          <label>
            Revision reason
            <input
              required
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <p>Recipients must respond to the new revision.</p>
          <button disabled={busy || !reason.trim()}>Publish new revision</button>
          <button type="button" onClick={() => setEditing(null)}>
            Cancel revision
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
