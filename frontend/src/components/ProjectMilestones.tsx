import { clearAttemptScope } from '../data/businessAttempts';
import { useEffect, useState } from 'react';
import { useWorkspace } from '../store';
import {
  executionRead,
  useExecutionRead,
  useExecutionMutation,
  type ExecutionProject,
  type MilestoneView,
  type TaskBasis,
} from '../data/execution';
import { commitmentLabel } from '../../../shared/business/types';
import { Field, ErrorMessage } from './UI';
import type { Task } from '../types';
export default function ProjectMilestones({
  project,
  canEdit,
  onTask = () => {},
}: {
  project: ExecutionProject;
  canEdit: boolean;
  onTask?: (id: string) => void;
}) {
  const q = useExecutionRead<{ milestones: MilestoneView[] }>(`/projects/${project.id}/milestones`);
  const [selected, setSelected] = useState('');
  const [creating, setCreating] = useState(false);
  return (
    <section className="panel execution-panel" aria-label="Project milestones">
      <h3>Human project milestones</h3>
      <p>
        Milestone acceptance records an independent decision. Task acceptance and goal measurements
        keep their own workflows.
      </p>
      {q.loading && <p role="status">Checking current milestone access…</p>}
      {q.error && (
        <>
          <p role="alert">{q.error.message}</p>
          <button className="button" onClick={() => void q.retry()}>
            Retry milestones
          </button>
        </>
      )}
      {q.data?.milestones.map((m) => (
        <button key={m.id} className="button" onClick={() => setSelected(m.id)}>
          Open milestone: {m.title}
        </button>
      ))}
      {q.ready && !q.data?.milestones.length && <p>No currently authorized milestones.</p>}
      {canEdit && (
        <button className="button" onClick={() => setCreating(true)}>
          New project milestone
        </button>
      )}
      {creating && (
        <MilestoneForm
          project={project}
          onDone={() => {
            setCreating(false);
            void q.retry();
          }}
        />
      )}
      {selected && (
        <MilestoneDetail
          key={selected}
          id={selected}
          project={project}
          onTask={onTask}
          onClose={() => {
            setSelected('');
            void q.retry();
          }}
        />
      )}
    </section>
  );
}
function MilestoneForm({
  project,
  milestone,
  onDone,
}: {
  project: ExecutionProject;
  milestone?: MilestoneView;
  onDone: () => void;
}) {
  const store = useWorkspace();
  const data = store.data!;
  const action = useExecutionMutation('milestone-form:' + (milestone?.id ?? project.id));
  const [projectVersion] = useState(project.version);
  const [version] = useState(milestone?.version);
  const [title, setTitle] = useState(milestone?.title ?? '');
  const [description, setDescription] = useState(milestone?.description ?? '');
  const [owner, setOwner] = useState(milestone?.ownerId ?? data.me.id);
  const [reviewer, setReviewer] = useState(milestone?.reviewerId ?? '');
  const [criteria, setCriteria] = useState(milestone?.criteria.map((c) => c.text).join('\n') ?? '');
  const [selected, setSelected] = useState<string[]>(milestone?.taskIds ?? []);
  const [date, setDate] = useState(milestone?.dueDate ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const tasks = data.tasks.filter((t) => t.projectId === project.id);
  return (
    <section aria-label="Milestone criteria form">
      <fieldset disabled={action.busy || !!action.attempt}>
        <legend>{milestone ? 'Edit draft milestone' : 'New milestone criteria'}</legend>
        <Field label="Milestone title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Milestone description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {!milestone && (
          <>
            <Field label="Milestone owner">
              <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                {data.people
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Independent milestone reviewer">
              <select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
                <option value="">Choose independent reviewer</option>
                {data.people
                  .filter((p) => p.active && p.role !== 'viewer' && p.id !== owner)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
          </>
        )}
        <Field label="Acceptance criteria, one per line">
          <textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} />
        </Field>
        <Field label="Milestone all-day deadline">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {milestone && date !== milestone.dueDate && (
          <Field label="Milestone deadline change reason">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        <p>Select tasks independently visible in this project.</p>
        {tasks.map((t) => (
          <label key={t.id} className="execution-choice">
            <input
              type="checkbox"
              checked={selected.includes(t.id)}
              onChange={(e) =>
                setSelected((ids) =>
                  e.target.checked ? [...ids, t.id] : ids.filter((id) => id !== t.id),
                )
              }
            />
            {t.code} · {t.title}
          </label>
        ))}
      </fieldset>
      <button className="button" onClick={onDone}>
        Cancel milestone editing
      </button>
      <button
        className="button button-primary"
        disabled={
          action.busy || !title || !criteria.trim() || !selected.length || (!milestone && !reviewer)
        }
        onClick={() =>
          void (async () => {
            try {
              const lines = criteria
                .split('\n')
                .map((c) => c.trim())
                .filter(Boolean);
              await action.execute(
                milestone
                  ? `/project-milestones/${milestone.id}`
                  : `/projects/${project.id}/milestones`,
                {
                  expectedProjectVersion: projectVersion,
                  ...(milestone ? { version } : { ownerId: owner, reviewerId: reviewer }),
                  title,
                  description,
                  criteria: lines.map((text, i) => ({
                    id: milestone?.criteria[i]?.id ?? crypto.randomUUID(),
                    text,
                  })),
                  taskIds: selected,
                  dueDate: date,
                  deadlineMode: 'all_day',
                  dueAt: '',
                  dueTimezone: '',
                  ...(milestone && date !== milestone.dueDate
                    ? { deadlineChangeReason: reason }
                    : {}),
                },
                milestone ? 'PATCH' : 'POST',
              );
              onDone();
            } catch (e) {
              setError((e as Error).message);
            }
          })()
        }
      >
        {action.attempt ? 'Retry same milestone save' : 'Save milestone criteria'}
      </button>
      {(error || action.error) && <ErrorMessage error={error || action.error} />}
    </section>
  );
}
function MilestoneDetail({
  id,
  project,
  onTask,
  onClose,
}: {
  id: string;
  project: ExecutionProject;
  onTask: (id: string) => void;
  onClose: () => void;
}) {
  const store = useWorkspace();
  const q = useExecutionRead<{ milestone: MilestoneView }>(`/project-milestones/${id}`);
  const action = useExecutionMutation('milestone-transition:' + id);
  const [assertions, setAssertions] = useState<Record<string, string>>({});
  const [basis, setBasis] = useState<TaskBasis[]>();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const m = q.data?.milestone;
  useEffect(() => {
    if (q.denied) {
      clearAttemptScope(action.scope);
      setBasis(undefined);
      setAssertions({});
      setEditing(false);
    }
  }, [q.denied]);
  async function run(fn: () => Promise<void>) {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function transition(kind: string) {
    if (!m) return;
    await run(async () => {
      await action.execute(`/project-milestones/${id}/transition`, {
        version: m.version,
        expectedProjectVersion: project.version,
        action: kind,
        ...(kind === 'submit'
          ? {
              criteriaVersion: m.criteriaVersion,
              assertions: m.criteria.map((c) => ({
                criterionId: c.id,
                statement: assertions[c.id] ?? '',
              })),
              tasks: basis,
            }
          : kind === 'reopen'
            ? { reason }
            : {
                criteriaVersion: m.criteriaVersion,
                tasks: m.submittedTasks,
                ...(kind === 'approve' ? { note } : { reason }),
              }),
      });
      setBasis(undefined);
      await q.retry();
    });
  }
  return (
    <section className="execution-panel" aria-label="Milestone review">
      <button className="button" onClick={onClose}>
        Close milestone
      </button>
      {q.loading && <p role="status">Checking current milestone and task access…</p>}
      {q.error && (
        <>
          <ErrorMessage error={q.error.message} />
          <button className="button" onClick={() => void q.retry()}>
            Retry milestone
          </button>
        </>
      )}
      {m && (
        <>
          <h4>{m.title}</h4>
          <p>
            {m.state.replaceAll('_', ' ')} · Criteria version {m.criteriaVersion}
          </p>
          <p>Original: {m.originalDueAt || m.originalDueDate || 'No deadline'}</p>
          <p>Current: {commitmentLabel(m)}</p>
          {!m.basisCurrent && <p role="alert">{m.basisNotice}</p>}
          {m.criteria.map((c) => (
            <div key={c.id}>
              <p>{c.text}</p>
              {m.canSubmit && (
                <Field label={'Criterion assertion: ' + c.text}>
                  <textarea
                    value={assertions[c.id] ?? ''}
                    onChange={(e) => setAssertions((v) => ({ ...v, [c.id]: e.target.value }))}
                    disabled={!!action.attempt}
                  />
                </Field>
              )}
            </div>
          ))}
          {m.taskIds.map((task) => (
            <button key={task} className="button" onClick={() => onTask(task)}>
              Inspect selected task evidence
            </button>
          ))}
          {m.canSubmit && (
            <>
              <button
                className="button"
                onClick={() =>
                  void run(async () => {
                    const tasks = await Promise.all(
                      m.taskIds.map((task) =>
                        executionRead<{ task: Task }>(
                          store.mode,
                          store.companyId,
                          store.session!.user.id,
                          `/tasks/${task}`,
                        ),
                      ),
                    );
                    if (tasks.some((t) => t.task.status !== 'done'))
                      throw Error('Every selected task must be accepted as done.');
                    setBasis(tasks.map((t) => ({ taskId: t.task.id, version: t.task.version })));
                  })
                }
              >
                Inspect current submission basis
              </button>
              {basis && <p>Inspected {basis.length} currently accepted tasks.</p>}
              <button
                className="button button-primary"
                disabled={
                  action.busy || !basis || m.criteria.some((c) => !assertions[c.id]?.trim())
                }
                onClick={() => void transition('submit')}
              >
                {action.attempt
                  ? 'Retry same milestone submission'
                  : 'Submit milestone for independent review'}
              </button>
            </>
          )}
          {m.canReview && (
            <>
              <p>
                Review assertions against each task’s current evidence. Bound task versions:{' '}
                {m.submittedTasks.map((t) => t.version).join(', ')}.
              </p>
              {m.assertions.map((a) => (
                <p key={a.criterionId}>{a.statement}</p>
              ))}
              <Field label="Independent milestone review note">
                <textarea value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <button
                className="button button-primary"
                disabled={action.busy || !m.basisCurrent}
                onClick={() => void transition('approve')}
              >
                {action.attempt
                  ? 'Retry same milestone decision'
                  : 'Accept milestone independently'}
              </button>
              <Field label="Milestone change request reason">
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <button
                className="button"
                disabled={action.busy || !reason.trim()}
                onClick={() => void transition('request_changes')}
              >
                Request milestone changes
              </button>
            </>
          )}
          {m.canReopen && (
            <>
              <Field label="Milestone reopen reason">
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <button
                className="button"
                disabled={action.busy || !reason.trim()}
                onClick={() => void transition('reopen')}
              >
                Reopen milestone for fresh review
              </button>
            </>
          )}
          {m.canEdit && (
            <button className="button" onClick={() => setEditing(true)}>
              Edit milestone criteria
            </button>
          )}
          {editing && (
            <MilestoneForm
              milestone={m}
              project={project}
              onDone={() => {
                setEditing(false);
                void q.retry();
              }}
            />
          )}
          {m.acceptances?.map((a) => (
            <article key={a.id}>
              <h4>Historical human acceptance</h4>
              <p>
                {a.createdAt} · Criteria {a.criteriaVersion} · Project {a.projectVersion}
              </p>
              <p>{a.note}</p>
            </article>
          ))}
        </>
      )}
      {(error || action.error) && <ErrorMessage error={error || action.error} />}
    </section>
  );
}
