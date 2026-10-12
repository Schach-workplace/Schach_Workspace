import { useEffect, useState } from 'react';
import CommitmentFields, { commitmentInstant, type CommitmentDraft } from './CommitmentFields';
import type { Conversation, Message } from '../communication/types';
import type { CreateTaskInput, WorkspaceData } from '../types';
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
  return (
    <section aria-label="Create work from message" className="panel">
      <h3>Create work from selected message</h3>
      <p>Source revision {message.revision}. Publishing creates an independent work record.</p>
      <label>
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
      <label>
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
      <CommitmentFields
        value={commitment}
        onChange={(next) => {
          setCommitment(next);
          changed();
        }}
      />
      <label>
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
      {preview && (
        <div>
          <p>{preview.notice}</p>
          <p>{'Task title: ' + (existing ? (preview.existingTaskTitle ?? '') : title)}</p>
          {existing && (
            <p>
              No new task will be created. This message links to the existing task &ldquo;
              {preview.existingTaskTitle}&rdquo; and confirming opens it; the fields above are not
              applied.
            </p>
          )}
          <p>
            Currently visible to:{' '}
            {preview.audienceUserIds
              .map((id) => data.people.find((p) => p.id === id)?.name ?? 'Company member')
              .join(', ')}
          </p>
          <label>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            {existing
              ? 'I reviewed the existing task and its audience'
              : 'I reviewed the task audience and selected publication'}
          </label>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        disabled={busy || !commitment.dueDate || !title.trim()}
        onClick={() => void perform(false)}
      >
        Preview audience
      </button>
      <button disabled={busy || !preview || !ack} onClick={() => void perform(true)}>
        {existing ? 'Link to existing task' : 'Create task'}
      </button>
      <button onClick={onClose}>Cancel</button>
    </section>
  );
}
