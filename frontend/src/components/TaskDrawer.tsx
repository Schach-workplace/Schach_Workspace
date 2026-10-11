import IntelligenceLauncher from './IntelligenceLauncher';
import ExecutionRecovery from './ExecutionRecovery';
import { clearAttemptScope } from '../data/businessAttempts';
import { ApiError } from '../data/api';
import TaskTemplates from './TaskTemplates';
import TaskImpact from './TaskImpact';
import ScheduleReview from './ScheduleReview';
import {
  useBusinessAttempt,
  beginAttempt,
  businessKey,
  markAttemptCommitted,
  retireAttempt,
} from '../data/businessAttempts';
import { deadlineCandidates, localDeadline, deadlineChanged } from '../data/deadlines';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowDownToLine,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCheck,
  ClipboardList,
  Clock3,
  FileText,
  History,
  LoaderCircle,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useTaskDetail, useWorkspace } from '../store';
import { useRecordDraft, useUserDraftState, type RecordDraftMemory } from './useRecordDraft';
import type { CreateTaskInput, Task, Person } from '../types';
import {
  Avatar,
  canAdmin,
  canEditTask,
  canManage,
  canStructureTask,
  ownsScope,
  dateLabel,
  ErrorMessage,
  Field,
  personName,
  priorities,
  relativeTime,
  SaveButton,
  statuses,
  statusLabel,
  StatusBadge,
  today,
} from './UI';

type Draft = CreateTaskInput & {
  progress: number;
  blockerReason: string;
  deadlineChangeReason: string;
};
export default function TaskDrawer(props: {
  taskId: string;
  onClose: () => void;
  initialProject?: string;
}) {
  const [assistanceOpen, setAssistanceOpen] = useState(false);
  const detail = useTaskDetail(props.taskId);
  const store = useWorkspace();
  const data = store.data;
  const memory = useRecordDraft(
    JSON.stringify([
      store.mode,
      store.session?.user.id,
      store.companyId,
      props.taskId,
      data?.readBasis,
      data?.me.role,
      data?.me.departmentId,
      data?.me.managerId,
    ]),
    detail.accessRevoked ||
      (!!data && props.taskId !== 'new' && !data.tasks.some((t) => t.id === props.taskId)),
  );
  return (
    <>
      <IntelligenceLauncher
        controlledOpen={assistanceOpen}
        onClose={() => setAssistanceOpen(false)}
        choices={
          detail.task
            ? [
                {
                  label: 'Selected task fields',
                  source: {
                    kind: 'task_fields',
                    id: detail.task.id,
                    expectedVersion: detail.task.version,
                    selectedFieldSet: 'narrative',
                  },
                },
                ...(detail.task.comments ?? []).map((c) => ({
                  label: 'Task comment: ' + c.body.slice(0, 80),
                  source: {
                    kind: 'task_comment' as const,
                    id: c.id,
                    parentId: props.taskId,
                    selectedFieldSet: 'body',
                  },
                })),
              ]
            : []
        }
      />
      {props.taskId !== 'new' && !detail.task ? (
        <div role="dialog" aria-label="Task details">
          <button onClick={props.onClose}>Close</button>
          <p role={detail.error ? 'alert' : 'status'}>{detail.error || 'Loading task details…'}</p>
        </div>
      ) : (
        <TaskDrawerBody
          {...props}
          onAssist={() => setAssistanceOpen(true)}
          assistanceOpen={assistanceOpen}
          memory={memory}
          resolvedTask={detail.task}
          resolvedPeople={detail.people}
        />
      )}
    </>
  );
}
function TaskDrawerBody({
  onAssist,
  assistanceOpen,
  memory,
  resolvedTask,
  resolvedPeople,
  taskId,
  onClose,
  initialProject = '',
}: {
  onAssist: () => void;
  assistanceOpen: boolean;
  memory: RecordDraftMemory;
  resolvedTask?: Task;
  resolvedPeople?: Person[];
  taskId: string;
  onClose: () => void;
  initialProject?: string;
}) {
  const store = useWorkspace();
  const data = {
    ...store.data!,
    people: Array.from(
      new Map([...store.data!.people, ...(resolvedPeople ?? [])].map((p) => [p.id, p])).values(),
    ),
  };
  const task = resolvedTask;
  const business = useBusinessAttempt<CreateTaskInput>('task-create');
  const makeDraft = (t?: Task): Draft =>
    t
      ? {
          title: t.title,
          description: t.description,
          ownerId: t.ownerId,
          reviewerId: t.reviewerId,
          departmentId: t.departmentId,
          projectId: t.projectId,
          parentId: t.parentId,
          priority: t.priority,
          status: t.status,
          dueDate: t.dueDate,
          deadlineMode: t.deadlineMode ?? 'all_day',
          dueAt: t.dueAt ?? '',
          dueTimezone: t.dueTimezone ?? '',
          startDate: t.startDate,
          estimatedHours: t.estimatedHours,
          tags: [...t.tags],
          checklist: t.checklist.map((c) => ({ ...c })),
          dependencies: [...t.dependencies],
          collaborators: [...t.collaborators],
          recurrence: t.recurrence,
          requiresApproval: t.requiresApproval,
          progress: t.progress,
          blockerReason: t.blockerReason,
          deadlineChangeReason: '',
        }
      : {
          title: '',
          description: '',
          ownerId: data.me.id,
          reviewerId: data.me.managerId,
          departmentId: data.me.departmentId,
          projectId: initialProject,
          parentId: '',
          priority: 'medium',
          status: 'todo',
          dueDate: '',
          deadlineMode: 'all_day',
          dueAt: '',
          dueTimezone: '',
          startDate: today(data.company.timezone),
          estimatedHours: 0,
          tags: [],
          checklist: [],
          dependencies: [],
          collaborators: [],
          recurrence: 'none',
          requiresApproval: !!data.me.managerId,
          progress: 0,
          blockerReason: '',
          deadlineChangeReason: '',
        };
  const [draft, setDraft] = useState<Draft>(() => ({
    ...makeDraft(task),
    ...(!task ? business.attempt?.payload : {}),
    ...((memory.patch as Partial<Draft>) ?? {}),
  }));
  const [wallTime, setWallTime] = useUserDraftState(
    memory,
    'wallTime',
    task?.dueAt
      ? localDeadline(task.dueAt, task.dueTimezone || data.company.timezone).slice(11)
      : '16:00',
  );
  const [foldChoice, setFoldChoice] = useUserDraftState(
    memory,
    'foldChoice',
    task?.dueAt ? new Date(task.dueAt).toISOString() : '',
  );
  const candidates =
    draft.deadlineMode === 'timed' && draft.dueDate
      ? deadlineCandidates(
          draft.dueDate + 'T' + wallTime,
          draft.dueTimezone || data.company.timezone,
        )
      : [];
  const [version, setVersion] = useState(
    (memory.baseVersion as number | undefined) ?? task?.version ?? 0,
  );
  const [dirty, setDirtyState] = useState(!!memory.dirty);
  const setDirty = (next: boolean) => {
    if (next) {
      memory.baseVersion ??= version;
      memory.dirty = true;
    } else
      for (const key of ['patch', 'baseVersion', 'dirty', 'tagText', 'wallTime', 'foldChoice'])
        delete memory[key];
    setDirtyState(next);
  };
  const [tab, setTab] = useUserDraftState(memory, 'tab', 'details');
  const [error, setError] = useState('');
  const [checkText, setCheckText] = useUserDraftState(memory, 'checkText', '');
  const [comment, setComment] = useUserDraftState(memory, 'comment', '');
  const [tagText, setTagText, setFetchedTagText] = useUserDraftState(
    memory,
    'tagText',
    task?.tags.join(', ') || '',
  );
  const [reviewComment, setReviewComment] = useUserDraftState(memory, 'reviewComment', '');
  const [nudge, setNudge] = useUserDraftState(memory, 'nudge', '');
  const [hours, setHours] = useUserDraftState(memory, 'hours', '1');
  const [timeDate, setTimeDate] = useUserDraftState(
    memory,
    'timeDate',
    today(data.company.timezone),
  );
  const [timeNote, setTimeNote] = useUserDraftState(memory, 'timeNote', '');
  const fileRef = useRef<HTMLInputElement>(null);
  const writable = canEditTask(data, task);
  const structural = !task || canStructureTask(data, task);
  const canComment = data.me.role !== 'viewer';
  const canNudge = data.me.role !== 'viewer' && (writable || task?.reviewerId === data.me.id);
  const canEvidence =
    canNudge || (data.me.role !== 'viewer' && !!task?.collaborators.includes(data.me.id));
  const canLogTime = canEvidence;
  const canReview =
    task &&
    task.status === 'in_review' &&
    task.ownerId !== data.me.id &&
    (task.reviewerId === data.me.id || ['founder', 'ceo', 'admin'].includes(data.me.role));
  useEffect(() => {
    if (task && !dirty) {
      setDraft(makeDraft(task));
      setVersion(task.version);
      setFetchedTagText(task.tags.join(', '));
    }
  }, [task, dirty]); // Retain unsaved edits when a newer version arrives.
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    if (!task && business.attempt) return;
    memory.patch = { ...((memory.patch as Partial<Draft>) ?? {}), [key]: value };
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };
  async function perform(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
    } catch (e) {
      if (!task && e instanceof ApiError && [401, 403, 404].includes(e.status))
        clearAttemptScope(business.scope);
      setError(e instanceof Error ? e.message : 'The change could not be saved. Please try again.');
    }
  }
  const submitting = useRef(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    await perform(async () => {
      let dueAt = '';
      if (draft.deadlineMode === 'timed') {
        if (candidates.length === 0)
          throw new Error('This local time does not exist. Choose another time.');
        if (candidates.length > 1 && !candidates.includes(foldChoice))
          throw new Error('Choose an offset for this repeated local time.');
        dueAt = candidates.length === 1 ? candidates[0] : foldChoice;
      }
      const cleaned = {
        ...draft,
        dueAt,
        dueTimezone:
          draft.deadlineMode === 'timed' ? draft.dueTimezone || data.company.timezone : '',
        tags: [
          ...new Set(
            tagText
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        ],
      };
      if (task) {
        const { deadlineChangeReason, ...patch } = cleaned;
        await store.mutate(
          `/tasks/${task.id}`,
          {
            ...patch,
            ...(deadlineChanged(cleaned, task) ? { deadlineChangeReason } : {}),
            version,
          },
          'PATCH',
        );
      } else {
        const {
          progress: _progress,
          blockerReason: _blocker,
          deadlineChangeReason: _deadlineReason,
          ...input
        } = cleaned;
        const attempt = beginAttempt(
          business.scope,
          business.attempt?.payload ?? input,
          businessKey(),
          { path: '/tasks', method: 'POST' },
        );
        if (attempt.state === 'committed') {
          retireAttempt(business.scope, attempt.retryKey);
          onClose();
          return;
        }
        await store.mutate(
          '/tasks',
          { ...attempt.payload, retryKey: attempt.retryKey },
          'POST',
          (result) =>
            markAttemptCommitted(business.scope, attempt.retryKey, {
              ids: result.id ? [result.id] : [],
            }),
        );
        retireAttempt(business.scope, attempt.retryKey);
      }
      onClose();
    });
    submitting.current = false;
  }
  async function postComment(event: FormEvent) {
    event.preventDefault();
    if (!task || !comment.trim()) return;
    await perform(async () => {
      await store.mutate(`/tasks/${task.id}/comments`, { body: comment.trim() });
      setComment('');
    });
  }
  async function logTime(event: FormEvent) {
    event.preventDefault();
    if (!task) return;
    await perform(async () => {
      await store.mutate(`/tasks/${task.id}/time`, {
        hours: Number(hours),
        date: timeDate,
        note: timeNote,
      });
      setTimeNote('');
      setHours('1');
    });
  }
  const activity = task
    ? data.activities
        .filter((a) => a.taskId === task.id)
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  return (
    <Dialog.Root open modal={!assistanceOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="task-sheet"
          onOpenAutoFocus={(event) => {
            if (assistanceOpen) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            if (assistanceOpen) event.preventDefault();
          }}
        >
          <header className="sheet-header">
            <div className="sheet-breadcrumb">
              <ClipboardList size={17} />
              <span>{task ? task.code : 'New task'}</span>
              {task && (
                <>
                  <span className="slash">/</span>
                  <StatusBadge status={task.status} />
                </>
              )}
            </div>
            <Dialog.Close className="icon-button" aria-label="Close task details">
              <X size={20} />
            </Dialog.Close>
          </header>
          <div className="sheet-title">
            <Dialog.Title>{task ? task.title : 'Make the next step clear.'}</Dialog.Title>
            {task && (
              <button className="button" onClick={onAssist}>
                Local assistance
              </button>
            )}
            <Dialog.Description>
              {task
                ? `Created by ${personName(data, task.createdBy)} · ${dateLabel(task.createdAt)} · Version ${task.version}`
                : 'One outcome. One owner. A shared commitment.'}
            </Dialog.Description>
          </div>
          {task && (
            <div className="sheet-tabs" role="group" aria-label="Task sections">
              {[
                { id: 'details', icon: ClipboardList, label: 'Details' },
                {
                  id: 'activity',
                  icon: MessageSquare,
                  label: `Activity${task.comments.length ? ` · ${task.comments.length}` : ''}`,
                },
                { id: 'evidence', icon: Paperclip, label: `Evidence & time` },
              ].map((t) => (
                <button
                  key={t.id}
                  aria-pressed={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={tab === t.id ? 'active' : ''}
                >
                  <t.icon size={15} />
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <div className="sheet-scroll">
            <ErrorMessage error={error} />
            {task && dirty && task.version !== version && (
              <div className="notice notice-warning">
                This task was updated while you were editing. Your changes are preserved.{' '}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setDraft(makeDraft(task));
                    setVersion(task.version);
                    setFetchedTagText(task.tags.join(', '));
                    setDirty(false);
                  }}
                >
                  Load latest version
                </button>
              </div>
            )}
            {!writable && <div className="notice">Task fields are read-only for your role.</div>}
            {task?.status === 'done' && tab === 'details' && (
              <div className="notice">
                <strong>Accepted task.</strong> Reopen it before editing task fields. A required
                review must be repeated before completion.
                {writable && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={store.saving}
                    onClick={() =>
                      perform(async () => {
                        await store.mutate(
                          `/tasks/${task.id}`,
                          { status: 'in_progress', version: task.version },
                          'PATCH',
                        );
                        setDirty(false);
                      })
                    }
                  >
                    Reopen task
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
            )}
            {tab === 'details' && (
              <>
                {' '}
                {task ? (
                  <>
                    <TaskTemplates task={task} />
                    <TaskImpact taskId={task.id} />
                    <ScheduleReview tasks={[task]} />
                  </>
                ) : (
                  <TaskTemplates initialProject={initialProject} onCreated={() => onClose()} />
                )}
                <form onSubmit={save} id="task-edit-form">
                  {!task && business.attempt && (
                    <p role="alert">
                      The previous request may already have created work. Retry the same frozen
                      details before starting another task.
                    </p>
                  )}
                  {!task && (
                    <ExecutionRecovery
                      action={{
                        attempt: business.attempt,
                        busy: store.saving,
                        abandon: () => {
                          if (!submitting.current) {
                            clearAttemptScope(business.scope);
                            setError('');
                          }
                        },
                      }}
                    />
                  )}
                  <fieldset
                    disabled={
                      !writable ||
                      store.saving ||
                      task?.status === 'done' ||
                      (!task && !!business.attempt)
                    }
                    className="plain-fieldset"
                  >
                    <Field label="Task title">
                      <input
                        required
                        maxLength={240}
                        autoFocus={!task}
                        value={draft.title}
                        onChange={(e) => set('title', e.target.value)}
                        placeholder="What needs to get done?"
                        className="task-title-input"
                      />
                    </Field>
                    <Field
                      label="Outcome & context"
                      hint="Describe what a successful result looks like."
                    >
                      <textarea
                        value={draft.description}
                        onChange={(e) => set('description', e.target.value)}
                        rows={4}
                        placeholder="Give the owner the context they need…"
                      />
                    </Field>
                    <div className="form-grid">
                      <Field label="Accountable owner">
                        <select
                          required
                          disabled={!structural}
                          value={draft.ownerId}
                          onChange={(e) => {
                            const person = data.people.find((p) => p.id === e.target.value);
                            set('ownerId', e.target.value);
                            if (!task && person) {
                              const reviewer =
                                person.managerId ||
                                data.departments.find((d) => d.id === person.departmentId)
                                  ?.headId ||
                                '';
                              setDraft((d) => ({
                                ...d,
                                ownerId: person.id,
                                departmentId: person.departmentId,
                                reviewerId: reviewer !== person.id ? reviewer : '',
                                requiresApproval: !!reviewer && reviewer !== person.id,
                              }));
                            }
                          }}
                        >
                          <option value="">Choose a person</option>
                          {data.people
                            .filter(
                              (p) => p.active && (ownsScope(data, p.id) || p.id === draft.ownerId),
                            )
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <Field label="Status">
                        <select
                          value={draft.status}
                          onChange={(e) => set('status', e.target.value as Draft['status'])}
                        >
                          {(task
                            ? statuses
                            : statuses.filter((s) => s === 'todo' || s === 'backlog')
                          ).map((s) => (
                            <option
                              key={s}
                              value={s}
                              disabled={s === 'done' && draft.requiresApproval}
                            >
                              {statusLabel[s]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Department">
                        <select
                          disabled={!structural}
                          value={draft.departmentId}
                          onChange={(e) => set('departmentId', e.target.value)}
                        >
                          <option value="">No department</option>
                          {data.departments
                            .filter(
                              (d) =>
                                canAdmin(data) ||
                                d.id === data.me.departmentId ||
                                d.id === draft.departmentId,
                            )
                            .map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <Field label="Project">
                        <select
                          disabled={!structural}
                          value={draft.projectId}
                          onChange={(e) => set('projectId', e.target.value)}
                        >
                          <option value="">No project</option>
                          {data.projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Priority">
                        <select
                          value={draft.priority}
                          onChange={(e) => set('priority', e.target.value as Draft['priority'])}
                        >
                          {priorities.map((p) => (
                            <option key={p} value={p}>
                              {p[0].toUpperCase() + p.slice(1)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {task && (
                        <Field label="Progress estimate">
                          <div className="input-suffix">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              required
                              value={draft.progress}
                              onChange={(e) => set('progress', Number(e.target.value))}
                            />
                            <span>%</span>
                          </div>
                        </Field>
                      )}
                      <Field label="Start date">
                        <input
                          type="date"
                          value={draft.startDate}
                          onChange={(e) => set('startDate', e.target.value)}
                        />
                      </Field>
                      <Field label="Deadline">
                        <input
                          required
                          type="date"
                          min={draft.startDate || undefined}
                          value={draft.dueDate}
                          onChange={(e) => set('dueDate', e.target.value)}
                        />
                      </Field>
                    </div>
                    <div className="form-grid">
                      <Field label="Deadline type">
                        <select
                          value={draft.deadlineMode ?? 'all_day'}
                          onChange={(e) => {
                            set('deadlineMode', e.target.value as 'all_day' | 'timed');
                            set(
                              'dueTimezone',
                              e.target.value === 'timed' ? data.company.timezone : '',
                            );
                            set('dueAt', '');
                            setFoldChoice('');
                          }}
                        >
                          <option value="all_day">All day</option>
                          <option value="timed">At a specific time</option>
                        </select>
                      </Field>
                      {draft.deadlineMode === 'timed' && (
                        <>
                          <Field label="Commitment time">
                            <input
                              type="time"
                              required
                              value={wallTime}
                              onChange={(e) => {
                                setWallTime(e.target.value);
                                setFoldChoice('');
                                setDirty(true);
                              }}
                            />
                          </Field>
                          <Field label="Commitment timezone">
                            <input
                              required
                              value={draft.dueTimezone || data.company.timezone}
                              onChange={(e) => {
                                set('dueTimezone', e.target.value);
                                setFoldChoice('');
                              }}
                            />
                          </Field>
                          {candidates.length > 1 && (
                            <Field label="Repeated time — choose offset">
                              <select
                                required
                                value={foldChoice}
                                onChange={(e) => setFoldChoice(e.target.value)}
                              >
                                <option value="">Select occurrence</option>
                                {candidates.map((value) => (
                                  <option key={value} value={value}>
                                    {value} (UTC instant)
                                  </option>
                                ))}
                              </select>
                            </Field>
                          )}
                        </>
                      )}
                    </div>
                    {task?.originalDueDate && (
                      <div className="detail-note">
                        <CalendarDays size={14} />
                        Original commitment:{' '}
                        <strong>
                          {task.originalDeadlineMode === 'timed'
                            ? `${task.originalDueAt} (${task.originalDueTimezone})`
                            : dateLabel(task.originalDueDate)}
                        </strong>
                        {task.dueDate !== task.originalDueDate && (
                          <span>· Current deadline changed</span>
                        )}
                      </div>
                    )}
                    {task &&
                      deadlineChanged(
                        {
                          ...draft,
                          dueAt:
                            draft.deadlineMode === 'timed'
                              ? candidates.length === 1
                                ? candidates[0]
                                : foldChoice
                              : '',
                        },
                        task,
                      ) && (
                        <Field
                          label="Why is the deadline changing?"
                          hint="The original commitment stays in the audit history."
                        >
                          <textarea
                            required
                            value={draft.deadlineChangeReason}
                            onChange={(e) => set('deadlineChangeReason', e.target.value)}
                            placeholder="Explain the change in circumstances…"
                            rows={2}
                          />
                        </Field>
                      )}
                    {draft.status === 'blocked' && (
                      <Field label="What is blocking this task?">
                        <textarea
                          required
                          rows={2}
                          value={draft.blockerReason}
                          onChange={(e) => set('blockerReason', e.target.value)}
                          placeholder="Name the blocker and the help needed…"
                        />
                      </Field>
                    )}
                    <div className="form-section-heading">
                      <ShieldCheck size={17} />
                      <h3>Review & delivery</h3>
                    </div>
                    <div className="form-grid">
                      <Field label="Reviewer">
                        <select
                          disabled={!structural || (!!task && task.ownerId === data.me.id)}
                          value={draft.reviewerId}
                          onChange={(e) => {
                            set('reviewerId', e.target.value);
                            set('requiresApproval', !!e.target.value);
                          }}
                        >
                          <option value="">No reviewer</option>
                          {data.people
                            .filter(
                              (p) => p.active && p.role !== 'viewer' && p.id !== draft.ownerId,
                            )
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <Field label="Estimated effort">
                        <div className="input-suffix">
                          <input
                            type="number"
                            min={0}
                            max={100000}
                            step="0.25"
                            value={draft.estimatedHours}
                            onChange={(e) => set('estimatedHours', Number(e.target.value))}
                          />
                          <span>hours</span>
                        </div>
                      </Field>
                    </div>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        disabled={!structural || !!task?.requiresApproval}
                        checked={draft.requiresApproval}
                        onChange={(e) => set('requiresApproval', e.target.checked)}
                      />
                      <span>Require independent approval before completion</span>
                    </label>
                    {draft.requiresApproval && (
                      <p className="field-help">
                        Submit work as “In review”. An assigned reviewer or company leader can
                        accept the result. The owner cannot approve their own work.
                      </p>
                    )}
                    <div className="form-section-heading">
                      <CheckCheck size={17} />
                      <h3>Acceptance checklist</h3>
                      <span>
                        {draft.checklist.filter((c) => c.done).length}/{draft.checklist.length}
                      </span>
                    </div>
                    <div className="checklist">
                      {draft.checklist.map((c) => (
                        <div className="checklist-item" key={c.id}>
                          <label>
                            <input
                              type="checkbox"
                              checked={c.done}
                              onChange={(e) =>
                                set(
                                  'checklist',
                                  draft.checklist.map((v) =>
                                    v.id === c.id ? { ...v, done: e.target.checked } : v,
                                  ),
                                )
                              }
                            />
                            <span className={c.done ? 'checked' : ''}>{c.text}</span>
                          </label>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Remove ${c.text}`}
                            onClick={() =>
                              set(
                                'checklist',
                                draft.checklist.filter((v) => v.id !== c.id),
                              )
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="inline-input">
                      <input
                        aria-label="New checklist item"
                        placeholder="Add an acceptance criterion"
                        value={checkText}
                        onChange={(e) => setCheckText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (checkText.trim()) {
                              set('checklist', [
                                ...draft.checklist,
                                { id: crypto.randomUUID(), text: checkText.trim(), done: false },
                              ]);
                              setCheckText('');
                            }
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={!checkText.trim()}
                        onClick={() => {
                          set('checklist', [
                            ...draft.checklist,
                            { id: crypto.randomUUID(), text: checkText.trim(), done: false },
                          ]);
                          setCheckText('');
                        }}
                      >
                        <Plus size={15} />
                        Add
                      </button>
                    </div>
                    <details className="advanced-fields">
                      <summary>Dependencies, collaborators & recurring work</summary>
                      <Field
                        label="Depends on"
                        hint="Hold Ctrl / Cmd to select multiple. Dependencies must be complete before acceptance."
                      >
                        <select
                          multiple
                          disabled={!structural}
                          value={draft.dependencies}
                          onChange={(e) =>
                            set(
                              'dependencies',
                              Array.from(e.target.selectedOptions, (o) => o.value),
                            )
                          }
                          size={4}
                        >
                          {data.tasks
                            .filter((t) => t.id !== task?.id)
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.code} · {t.title}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <Field label="Parent task">
                        <select
                          disabled={!structural}
                          value={draft.parentId}
                          onChange={(e) => set('parentId', e.target.value)}
                        >
                          <option value="">No parent task</option>
                          {data.tasks
                            .filter((t) => t.id !== task?.id)
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.code} · {t.title}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <Field label="Collaborators" hint="Hold Ctrl / Cmd to select multiple.">
                        <select
                          multiple
                          size={3}
                          value={draft.collaborators}
                          onChange={(e) =>
                            set(
                              'collaborators',
                              Array.from(e.target.selectedOptions, (o) => o.value),
                            )
                          }
                        >
                          {data.people
                            .filter((p) => p.active)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <div className="form-grid">
                        <Field label="Repeat">
                          <select
                            disabled={!structural}
                            value={draft.recurrence}
                            onChange={(e) =>
                              set('recurrence', e.target.value as Draft['recurrence'])
                            }
                          >
                            <option value="none">Does not repeat</option>
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                          </select>
                        </Field>
                        <Field label="Tags" hint="Separate tags with commas.">
                          <input
                            value={tagText}
                            onChange={(e) => {
                              setTagText(e.target.value);
                              setDirty(true);
                            }}
                            placeholder="launch, operations"
                          />
                        </Field>
                      </div>
                    </details>
                  </fieldset>
                  {writable && task?.status !== 'done' && (
                    <div className="form-actions task-save">
                      <span>
                        {task ? `Editing version ${version}` : 'Every task has a clear owner.'}
                      </span>
                      <SaveButton saving={store.saving}>
                        {task
                          ? 'Save changes'
                          : business.attempt
                            ? 'Retry same submission'
                            : 'Create task'}
                      </SaveButton>
                    </div>
                  )}
                </form>
              </>
            )}
            {tab === 'details' && canReview && (
              <div className="review-box">
                <div className="form-section-heading">
                  <ShieldCheck size={18} />
                  <h3>Your review is needed</h3>
                </div>
                <p>
                  {dirty
                    ? 'Save your task edits before making a review decision.'
                    : 'Check the outcome, evidence and acceptance criteria before approving.'}
                </p>
                <textarea
                  aria-label="Review feedback"
                  rows={2}
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Add review feedback…"
                />
                <div className="review-actions">
                  <button
                    className="button button-secondary"
                    disabled={store.saving || dirty || !reviewComment.trim()}
                    onClick={() =>
                      perform(async () => {
                        await store.mutate(`/tasks/${task.id}/review`, {
                          decision: 'request_changes',
                          comment: reviewComment,
                          version: task.version,
                        });
                        setReviewComment('');
                      })
                    }
                  >
                    Request changes
                  </button>
                  <button
                    className="button button-dark"
                    disabled={store.saving || dirty}
                    onClick={() =>
                      perform(async () => {
                        await store.mutate(`/tasks/${task.id}/review`, {
                          decision: 'approve',
                          comment: reviewComment,
                          version: task.version,
                        });
                        setReviewComment('');
                      })
                    }
                  >
                    <Check size={15} />
                    Accept work
                  </button>
                </div>
              </div>
            )}
            {tab === 'activity' && task && (
              <>
                <h3 className="subsection-title">Conversation</h3>
                <div className="comments">
                  {task.comments.length === 0 && (
                    <p className="muted small">
                      No comments yet. Share an update or ask a question.
                    </p>
                  )}
                  {task.comments.map((c) => (
                    <article className="comment" key={c.id}>
                      <Avatar person={data.people.find((p) => p.id === c.userId)} />
                      <div>
                        <div className="comment-byline">
                          <strong>{personName(data, c.userId)}</strong>
                          <time>{relativeTime(c.createdAt)}</time>
                        </div>
                        <p>{c.body}</p>
                      </div>
                    </article>
                  ))}
                </div>
                {canComment && (
                  <form onSubmit={postComment} className="comment-form">
                    <textarea
                      aria-label="Write a comment"
                      required
                      rows={3}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Share progress, context, or a question…"
                    />
                    <button
                      type="submit"
                      className="button button-primary"
                      disabled={store.saving || !comment.trim()}
                    >
                      <Send size={14} />
                      Post comment
                    </button>
                  </form>
                )}
                {canNudge && task.ownerId !== data.me.id && (
                  <form
                    className="nudge-box"
                    onSubmit={(e) => {
                      e.preventDefault();
                      perform(async () => {
                        await store.mutate(`/tasks/${task.id}/nudge`, {
                          message: nudge || 'Please share a progress update on this task.',
                        });
                        setNudge('');
                      });
                    }}
                  >
                    <h3>Ask for an update</h3>
                    <p>Send an in-app notification to {personName(data, task.ownerId)}.</p>
                    <div className="inline-input">
                      <input
                        aria-label="Nudge message"
                        value={nudge}
                        onChange={(e) => setNudge(e.target.value)}
                        placeholder="A quick update would help…"
                      />
                      <button
                        className="button button-secondary"
                        disabled={store.saving}
                        type="submit"
                      >
                        Nudge
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </form>
                )}
                <div className="form-section-heading">
                  <History size={16} />
                  <h3>Audit trail</h3>
                </div>
                <div className="activity-list">
                  {activity.length === 0 && (
                    <p className="muted small">Changes to this task will appear here.</p>
                  )}
                  {activity.map((a) => (
                    <div className="activity-row" key={a.id}>
                      <span className="activity-dot" />
                      <div>
                        <p>
                          <strong>{personName(data, a.userId)}</strong>{' '}
                          {a.action.replaceAll('_', ' ')}
                        </p>
                        <span>{a.detail}</span>
                        <time>{new Date(a.createdAt).toLocaleString()}</time>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {tab === 'evidence' && task && (
              <>
                <div className="section-header">
                  <div>
                    <h3>Files & evidence</h3>
                    <p>Supporting documents for a confident review.</p>
                  </div>
                  {canEvidence && (
                    <button
                      className="button button-secondary"
                      disabled={store.saving}
                      onClick={() => fileRef.current?.click()}
                    >
                      <Upload size={14} />
                      Upload
                    </button>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) perform(() => store.upload(task.id, file));
                    e.target.value = '';
                  }}
                />
                <div className="attachments">
                  {task.attachments.length === 0 ? (
                    <div className="file-empty">
                      <Paperclip size={24} />
                      <p>No files attached</p>
                      <span>PDF, PNG, JPEG, WebP, TXT or CSV · up to 10 MB.</span>
                    </div>
                  ) : (
                    task.attachments.map((a) => (
                      <div className="attachment" key={a.id}>
                        <FileText size={22} />
                        <div>
                          <strong>{a.fileName}</strong>
                          <span>
                            {(a.size / 1024).toFixed(1)} KB · {dateLabel(a.createdAt)}
                          </span>
                        </div>
                        <button
                          className="icon-button"
                          aria-label={`Download ${a.fileName}`}
                          onClick={() => perform(() => store.downloadAttachment(a))}
                        >
                          <ArrowDownToLine size={17} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="form-section-heading">
                  <Clock3 size={17} />
                  <h3>Time recorded</h3>
                  <span>
                    {task.actualHours}h / {task.estimatedHours}h estimated
                  </span>
                </div>
                <p className="field-help">
                  Self-reported time helps plan future work. It is not an employee performance
                  rating.
                </p>
                {canLogTime && (
                  <form onSubmit={logTime} className="time-form">
                    <div className="form-grid">
                      <Field label="Hours">
                        <input
                          type="number"
                          required
                          min="0.25"
                          max="24"
                          step="0.25"
                          value={hours}
                          onChange={(e) => setHours(e.target.value)}
                        />
                      </Field>
                      <Field label="Date">
                        <input
                          type="date"
                          required
                          value={timeDate}
                          onChange={(e) => setTimeDate(e.target.value)}
                        />
                      </Field>
                    </div>
                    <Field label="Work completed">
                      <input
                        required
                        value={timeNote}
                        onChange={(e) => setTimeNote(e.target.value)}
                        placeholder="What did you work on?"
                      />
                    </Field>
                    <button
                      className="button button-secondary"
                      type="submit"
                      disabled={store.saving}
                    >
                      <Plus size={14} />
                      Log time
                    </button>
                  </form>
                )}
                <div className="time-entries">
                  {task.timeEntries.map((t) => (
                    <div className="time-entry" key={t.id}>
                      <Avatar person={data.people.find((p) => p.id === t.userId)} size="xs" />
                      <div>
                        <strong>{t.note || 'Work logged'}</strong>
                        <span>
                          {personName(data, t.userId)} · {dateLabel(t.date)}
                        </span>
                      </div>
                      <b>{t.hours}h</b>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          {store.saving && (
            <div className="sheet-saving" role="status">
              <LoaderCircle size={14} className="spin" />
              Saving your changes…
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
