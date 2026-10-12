import { useEffect, useState } from 'react';
import CommitmentFields, { commitmentInstant, type CommitmentDraft } from './CommitmentFields';
import type { Conversation, Message } from '../communication/types';
import type { CreateTaskInput, WorkspaceData } from '../types';
import '../styles/connect-dialogs.css';
// Mirrors backend previewTaskConversion. "existing" means this instruction
// action already has a task: nothing new is created and the listed audience
// belongs to that existing task.
interface ConversionPreview {
  outcome?: 'created' | 'existing';
  existingTaskId?: string;
  existingTaskTitle?: string;
  audienceUserIds: string[];
  notice: string;
}
export default function MessageTaskConversion({
  message,
  conversation,
  data,
  command,
  onClose,
}: {
  message: Message;
  conversation: Conversation;
  data: WorkspaceData;
  command: <T>(path: string, body: unknown, method?: string) => Promise<T>;
  onClose: () => void;
}) {
  const [actions, setActions] = useState<{ id: string; title: string; sourceRevision: number }[]>(
    [],
  );
  const [actionId, setActionId] = useState('primary');
  useEffect(() => {
    void command<{ actions: typeof actions }>(
      `/conversations/${conversation.id}/work-actions?anchorMessageId=${encodeURIComponent(message.id)}`,
      undefined,
      'GET',
    )
      .then((v) => setActions(v.actions))
      .catch(() => setActions([]));
  }, [conversation.id, message.id]);
  const [title, setTitle] = useState(message.body.slice(0, 200));
  const [owner, setOwner] = useState(data.me.id);
  const [reviewer, setReviewer] = useState('');
  const [excerpt, setExcerpt] = useState(false);
  const [preview, setPreview] = useState<ConversionPreview | null>(null);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const [commitment, setCommitment] = useState<CommitmentDraft>({
    dueDate: '',
    deadlineMode: 'all_day',
    wallTime: '16:00',
    dueTimezone: data.company.timezone,
    fold: '',
  });
  let dueAt = '';
  try {
    dueAt = commitmentInstant(commitment);
  } catch {
    /* Display validated fields before committing. */
  }
  const task: CreateTaskInput = {
    title,
    description: '',
    ownerId: owner,
    reviewerId: reviewer,
    departmentId: data.people.find((p) => p.id === owner)?.departmentId ?? '',
    projectId: '',
    parentId: '',
    priority: 'medium',
    status: 'todo',
    dueDate: commitment.dueDate,
    deadlineMode: commitment.deadlineMode,
    dueAt,
    dueTimezone: commitment.deadlineMode === 'timed' ? commitment.dueTimezone : '',
    startDate: '',
    estimatedHours: 0,
    tags: [],
    checklist: [],
    dependencies: [],
    collaborators: [],
    recurrence: 'none',
    requiresApproval: !!reviewer,
  };
  const input = {
    retryKey: key,
    anchorMessageId: message.id,
    actionId,
    sources: [{ messageId: message.id, revision: message.revision }],
    task,
    publication: { excerpt: excerpt ? message.body : '' },
    expectedPolicyVersion: conversation.version,
  };
  async function perform(create: boolean) {
    setBusy(true);
    setError('');
    // Any new preview (or a commit) needs the confirmation of the result it shows.
    if (!create) setAck(false);
    try {
      if (commitment.deadlineMode === 'timed') commitmentInstant(commitment);
      const result = await command<ConversionPreview>(
        `/conversations/${conversation.id}/task-conversions${create ? '' : '/preview'}`,
        input,
      );
      if (create) onClose();
      else {
        setAck(false);
        setPreview(result);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const existing = preview?.outcome === 'existing';
  const changed = () => {
    setPreview(null);
    setAck(false);
  };
  const audienceNames = preview
    ? preview.audienceUserIds.map(
        (id) => data.people.find((p) => p.id === id)?.name ?? 'Company member',
      )
    : [];
  return (
    <section aria-label="Create work from message" className="connect-conversion">
      <div className="connect-conversion-source">
        <span className="connect-conversion-eyebrow">
          Selected message · source revision {message.revision}
        </span>
        <blockquote>{message.body || 'Attachment'}</blockquote>
        <p>Publishing creates an independent work record.</p>
      </div>
      <div className="connect-conversion-grid">
        <label className="connect-conversion-wide">
          Instruction action
          <select
            value={actionId}
            onChange={(e) => {
              setActionId(e.target.value);
              const item = actions.find((a) => a.id === e.target.value);
              if (item) setTitle(item.title);
              changed();
            }}
          >
            <option value="primary">Primary instruction</option>
            {actions
              .filter((a) => a.sourceRevision === message.revision)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
          </select>
        </label>
        <label className="connect-conversion-wide">
          Task title
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              changed();
            }}
          />
        </label>
        <label>
          Owner
          <select
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value);
              changed();
            }}
          >
            {data.people
              .filter((p) => p.active)
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Independent reviewer
          <select
            value={reviewer}
            onChange={(e) => {
              setReviewer(e.target.value);
              changed();
            }}
          >
            <option value="">No review required</option>
            {data.people
              .filter((p) => p.active && p.id !== owner && p.role !== 'viewer')
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <div className="connect-conversion-wide connect-conversion-commitment">
          <CommitmentFields
            value={commitment}
            onChange={(next) => {
              setCommitment(next);
              changed();
            }}
          />
        </div>
        <label className="connect-conversion-wide connect-conversion-check">
          <input
            type="checkbox"
            checked={excerpt}
            onChange={(e) => {
              setExcerpt(e.target.checked);
              changed();
            }}
          />
          Publish this exact excerpt into the task description
        </label>
      </div>
      {preview ? (
        <div
          className={'connect-disclosure' + (existing ? ' connect-disclosure-existing' : '')}
          role="group"
          aria-label="Publication review"
        >
          <h3>{existing ? 'This message already has a task' : 'Review before publishing'}</h3>
          <p className="connect-disclosure-notice">{preview.notice}</p>
          <p className="connect-disclosure-title">
            {'Task title: ' + (existing ? (preview.existingTaskTitle ?? '') : title)}
          </p>
          <div className="connect-disclosure-audience">
            <span id={key + '-audience'}>
              Currently visible to {audienceNames.length}{' '}
              {audienceNames.length === 1 ? 'person' : 'people'}
            </span>
            <ul aria-labelledby={key + '-audience'}>
              {audienceNames.map((name, i) => (
                <li key={i}>{name}</li>
              ))}
            </ul>
          </div>
          {existing && (
            <p className="connect-disclosure-existing-note">
              No new task will be created. This message links to the existing task &ldquo;
              {preview.existingTaskTitle}&rdquo; and confirming opens it; the fields above are not
              applied.
            </p>
          )}
          <label className="connect-disclosure-ack">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            {existing
              ? 'I reviewed the existing task and its audience'
              : 'I reviewed the task audience and selected publication'}
          </label>
        </div>
      ) : (
        <p className="connect-conversion-step">
          Preview the audience to see who will be able to read this task before it is created.
        </p>
      )}
      {error && (
        <p role="alert" className="connect-error">
          {error}
        </p>
      )}
      <div className="connect-dialog-footer">
        <button type="button" className="button button-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={'button ' + (preview ? 'button-secondary' : 'button-primary')}
          disabled={busy || !commitment.dueDate || !title.trim()}
          onClick={() => void perform(false)}
        >
          Preview audience
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={busy || !preview || !ack}
          onClick={() => void perform(true)}
        >
          {existing ? 'Link to existing task' : 'Create task'}
        </button>
      </div>
    </section>
  );
}
