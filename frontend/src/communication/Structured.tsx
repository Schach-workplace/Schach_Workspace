import IntelligenceLauncher from '../components/IntelligenceLauncher';
import { useEffect, useState } from 'react';
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
}: {
  conversation: Conversation;
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
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [editing, setEditing] = useState<RecordItem | null>(null);
  const [nextBody, setNextBody] = useState('');
  const [reason, setReason] = useState('');
  const root = `/conversations/${conversation.id}/records`;
  async function refresh() {
    const v = recordId
      ? await command<{ record: RecordItem; responses: Recipient[] }>(
          root + '/' + recordId,
          undefined,
          'GET',
        ).then((r) => ({ records: [r.record], responses: r.responses }))
      : await command<{ records: RecordItem[]; responses: Recipient[] }>(root, undefined, 'GET');
    setRecords(v.records);
    setRecipients(v.responses);
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [conversation.id, recordId]);
  async function create() {
    if (!source) return;
    setBusy(true);
    try {
      await command(root, {
        retryKey: key,
        kind,
        anchorMessageId: source.id,
        sourceRevision: source.revision,
        title,
        body,
        options: kind === 'poll' ? options.split('\n').filter(Boolean) : [],
        recipientIds: audience,
        reviewerId: kind === 'decision' ? reviewer : '',
        dueAt: due ? new Date(due).toISOString() : '',
      });
      setKey(crypto.randomUUID());
      await refresh();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="ack">Acknowledgement request</option>
              <option value="poll">Poll</option>
              <option value="event">Event / RSVP</option>
              <option value="decision">Reviewed decision</option>
            </select>
          </label>
          <label>
            Title
            <input required value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Selected content
            <textarea value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          {kind === 'poll' && (
            <label>
              Options, one per line
              <textarea value={options} onChange={(e) => setOptions(e.target.value)} />
            </label>
          )}
          <label>
            Response deadline (your local timezone)
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          {kind === 'decision' ? (
            <label>
              Independent reviewer
              <select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
                <option value="">Choose reviewer</option>
                {data.people
                  .filter((p) => p.active && p.role !== 'viewer' && p.id !== data.me.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          ) : (
            <fieldset>
              <legend>Fixed recipients with source access</legend>
              {data.people
                .filter((p) => p.active)
                .map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
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
          <button
            disabled={
              busy || !title.trim() || (kind === 'decision' ? !reviewer : audience.length === 0)
            }
          >
            Create structured record
          </button>
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
