import ExecutionRecovery from './ExecutionRecovery';
import { useExecutionInput, useExecutionBasis, clearExecutionForm } from '../data/executionInput';
import { deadlineCandidates, localDeadline } from '../data/deadlines';
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
import { Field, ErrorMessage, dateLabel, personName } from './UI';
import {
  CalendarDays,
  Check,
  ChevronRight,
  Flag,
  LoaderCircle,
  Pencil,
  Plus,
  ShieldCheck,
  X,
} from 'lucide-react';
import '../styles/work.css';
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
  const [selected, setSelected] = useExecutionInput('$project:' + project.id, 'selected', '');
  const [creating, setCreating] = useExecutionInput('$project:' + project.id, 'creating', false);
  const store = useWorkspace();
  const data = store.data!;
  return (
    <section className="panel wk-panel" aria-label="Project milestones">
      <div className="section-header">
        <div>
          <h2>Human project milestones</h2>
          <p>
            Milestone acceptance records an independent decision. Task acceptance and goal
            measurements keep their own workflows.
          </p>
        </div>
        {canEdit && (
          <button
            className="button button-secondary"
            aria-expanded={creating}
            onClick={() => setCreating(true)}
          >
            <Plus size={14} />
            New project milestone
          </button>
        )}
      </div>
      {q.data && q.data.milestones.length > 0 && (
        <ul className="wk-milestones">
          {q.data.milestones.map((m) => (
            <li key={m.id}>
              <button
                className="wk-milestone-row"
                aria-label={`Open milestone: ${m.title}`}
                aria-current={selected === m.id ? 'true' : undefined}
                onClick={() => setSelected(m.id)}
              >
                <strong>{m.title}</strong>
                <span className={`pill ${milestoneTone[m.state] ?? 'pill-slate'}`}>
                  {milestoneState[m.state] ?? m.state.replaceAll('_', ' ')}
                </span>
                <span>
                  <CalendarDays size={13} />
                  {m.dueDate ? dateLabel(m.dueDate) : 'No deadline'}
                </span>
                <span>
                  {m.criteria.length} criteria · {m.taskIds.length} tasks
                </span>
                <ChevronRight size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="wk-panel-body">
        {q.loading && (
          <p role="status" className="wk-status">
            <LoaderCircle size={14} className="spin" />
            Checking current milestone access…
          </p>
        )}
        {q.error && (
          <div className="wk-error">
            <p role="alert">{q.error.message}</p>
            <button className="button button-secondary button-small" onClick={() => void q.retry()}>
              Retry milestones
            </button>
          </div>
        )}
        {q.ready && !q.data?.milestones.length && (
          <div className="wk-empty">
            <Flag size={18} />
            <span>
              No currently authorized milestones.
              {canEdit &&
                ' Group accepted tasks under a milestone with its own acceptance criteria.'}
            </span>
          </div>
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
      </div>
    </section>
  );
}
const milestoneState: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  accepted: 'Accepted',
};
const milestoneTone: Record<string, string> = {
  draft: 'pill-slate',
  in_review: 'pill-purple',
  accepted: 'pill-green',
};
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
  const action = useExecutionMutation('milestone-form:' + (milestone?.id ?? project.id), [
    '/projects/' + project.id,
  ]);
  const form = '$milestone:' + (milestone?.id ?? project.id);
  const { basis, freeze: freezeBasis } = useExecutionBasis(form, {
    projectVersion: project.version,
    version: milestone?.version,
  });
  const { projectVersion, version } = basis;
  const [title, setTitle] = useExecutionInput(form, 'title', milestone?.title ?? '', freezeBasis);
  const [description, setDescription] = useExecutionInput(
    form,
    'description',
    milestone?.description ?? '',
    freezeBasis,
  );
  const [owner, setOwner] = useExecutionInput(
    form,
    'owner',
    milestone?.ownerId ?? data.me.id,
    freezeBasis,
  );
  const [reviewer, setReviewer] = useExecutionInput(
    form,
    'reviewer',
    milestone?.reviewerId ?? '',
    freezeBasis,
  );
  const [criteria, setCriteria] = useExecutionInput(
    form,
    'criteria',
    milestone?.criteria.map((c) => c.text).join('\n') ?? '',
    freezeBasis,
  );
  const [selected, setSelected] = useExecutionInput<string[]>(
    form,
    'selected',
    milestone?.taskIds ?? [],
    freezeBasis,
  );
  const [date, setDate] = useExecutionInput(form, 'date', milestone?.dueDate ?? '', freezeBasis);
  const [mode, setMode] = useExecutionInput(
    form,
    'mode',
    milestone?.deadlineMode ?? 'all_day',
    freezeBasis,
  );
  const [zone, setZone] = useExecutionInput(
    form,
    'zone',
    milestone?.dueTimezone || data.company.timezone,
    freezeBasis,
  );
  const [time, setTime] = useExecutionInput(
    form,
    'time',
    milestone?.dueAt
      ? localDeadline(milestone.dueAt, milestone.dueTimezone || data.company.timezone).slice(11)
      : '16:00',
    freezeBasis,
  );
  const [instant, setInstant] = useExecutionInput(
    form,
    'instant',
    milestone?.dueAt ?? '',
    freezeBasis,
  );
  const candidates = mode === 'timed' && date ? deadlineCandidates(date + 'T' + time, zone) : [];
  const changedDeadline =
    !!milestone &&
    (date !== milestone.dueDate ||
      mode !== milestone.deadlineMode ||
      (mode === 'timed' &&
        (zone !== milestone.dueTimezone ||
          (candidates.length === 1 ? candidates[0] : instant) !== milestone.dueAt)));
  const [reason, setReason] = useExecutionInput(form, 'reason', '', freezeBasis);
  const [error, setError] = useState('');
  const tasks = data.tasks.filter((t) => t.projectId === project.id);
  const save = () =>
    void (async () => {
      try {
        if (action.attempt) {
          await action.execute(
            action.attempt.target?.path ??
              (milestone
                ? `/project-milestones/${milestone.id}`
                : `/projects/${project.id}/milestones`),
            action.attempt.payload,
            action.attempt.target?.method ?? (milestone ? 'PATCH' : 'POST'),
            () => {
              clearExecutionForm(store.companyId, store.session?.user.id ?? data.me.id, form);
              onDone();
            },
          );
          return;
        }
        const at = mode === 'timed' ? (candidates.length === 1 ? candidates[0] : instant) : '';
        if (mode === 'timed' && (!at || !candidates.includes(at)))
          throw Error('Choose a valid local time and explicit repeated-time offset.');
        const lines = criteria
          .split('\n')
          .map((c) => c.trim())
          .filter(Boolean);
        await action.execute(
          milestone ? `/project-milestones/${milestone.id}` : `/projects/${project.id}/milestones`,
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
            deadlineMode: mode,
            dueAt: at,
            dueTimezone: mode === 'timed' ? zone : '',
            ...(changedDeadline ? { deadlineChangeReason: reason } : {}),
          },
          milestone ? 'PATCH' : 'POST',
          () => {
            clearExecutionForm(store.companyId, store.session?.user.id ?? data.me.id, form);
            onDone();
          },
        );
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  const saveBlocked =
    !action.attempt &&
    (!title || !criteria.trim() || !selected.length || (!milestone && !reviewer));
  const missing = [
    !title && 'a title',
    !criteria.trim() && 'at least one criterion',
    !selected.length && 'one or more tasks',
    !milestone && !reviewer && 'an independent reviewer',
  ].filter(Boolean);
  return (
    <section className="wk-card" aria-label="Milestone criteria form">
      <fieldset className="plain-fieldset wk-steps" disabled={action.busy || !!action.attempt}>
        <legend className="wk-sub-title">
          {milestone ? 'Edit draft milestone' : 'New milestone criteria'}
        </legend>
        <Field label="Milestone title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Milestone description">
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {!milestone && (
          <div className="form-grid">
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
          </div>
        )}
        {!milestone && (
          <p className="wk-hint">
            The reviewer must be someone other than the owner. Only they can accept the milestone.
          </p>
        )}
        <Field label="Acceptance criteria, one per line">
          <textarea rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
        </Field>
        <div className="form-grid">
          <Field label="Milestone all-day deadline">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Milestone deadline mode">
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="all_day">All day</option>
              <option value="timed">Timed with explicit offset</option>
            </select>
          </Field>
          {mode === 'timed' && (
            <>
              <Field label="Milestone local time">
                <input
                  type="time"
                  value={time}
                  onChange={(e) => {
                    setTime(e.target.value);
                    setInstant('');
                  }}
                />
              </Field>
              <Field label="Milestone commitment timezone">
                <input
                  value={zone}
                  onChange={(e) => {
                    setZone(e.target.value);
                    setInstant('');
                  }}
                />
              </Field>
              {candidates.length !== 1 && (
                <Field label="Milestone repeated time instant">
                  <select value={instant} onChange={(e) => setInstant(e.target.value)}>
                    <option value="">Choose a valid instant</option>
                    {candidates.map((at) => (
                      <option key={at} value={at}>
                        {at}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </>
          )}
        </div>
        {mode === 'timed' && !candidates.length && (
          <p role="alert" className="inline-error">
            This local time does not exist. Choose another time.
          </p>
        )}
        {changedDeadline && (
          <Field label="Milestone deadline change reason">
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        <div className="wk-pick-head">
          <span>Select tasks independently visible in this project.</span>
          <span className="wk-code">
            {selected.length} of {tasks.length} selected
          </span>
        </div>
        <div className="wk-pick">
          {tasks.map((t) => (
            <label key={t.id} className="wk-check wk-check-muted">
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
        </div>
      </fieldset>
      <ExecutionRecovery
        action={action}
        onReconcile={() => {
          clearExecutionForm(store.companyId, store.session?.user.id ?? data.me.id, form);
          onDone();
        }}
      />
      {(error || action.error) && <ErrorMessage error={error || action.error} />}
      <div className="wk-actions">
        {saveBlocked && missing.length > 0 && (
          <span className="wk-hint">To save, add {missing.join(', ')}.</span>
        )}
        <button className="button button-secondary" onClick={onDone}>
          Cancel milestone editing
        </button>
        <button
          className="button button-primary"
          disabled={action.busy || saveBlocked}
          onClick={save}
        >
          {action.attempt ? 'Retry same milestone save' : 'Save milestone criteria'}
        </button>
      </div>
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
  const action = useExecutionMutation('milestone-transition:' + id, ['/projects/' + project.id]);
  const [assertions, setAssertions] = useExecutionInput<Record<string, string>>(
    '$milestone:' + id,
    'assertions',
    {},
  );
  const [basis, setBasis] = useExecutionInput<TaskBasis[] | undefined>(
    '$milestone:' + id,
    'taskBasis',
    undefined,
  );
  const [reason, setReason] = useExecutionInput('$milestone:' + id, 'reason', '');
  const [note, setNote] = useExecutionInput('$milestone:' + id, 'note', '');
  const [error, setError] = useState('');
  const [editing, setEditing] = useExecutionInput('$milestone:' + id, 'editing', false);
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
  const inspectBasis = () =>
    void run(async () => {
      if (!m) return;
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
    });
  const data = store.data!;
  const assertionFor = (criterionId: string) =>
    m?.assertions.find((a) => a.criterionId === criterionId)?.statement;
  // Statements submitted against criteria that are no longer current are still
  // part of what was submitted; the reviewer must be able to read them.
  const otherAssertions = m
    ? m.assertions.filter((a) => !m.criteria.some((c) => c.id === a.criterionId))
    : [];
  const missingAssertions = !!m && m.criteria.some((c) => !assertions[c.id]?.trim());
  return (
    <section className="wk-card" aria-label="Milestone review">
      {q.loading && (
        <p role="status" className="wk-status">
          <LoaderCircle size={14} className="spin" />
          Checking current milestone and task access…
        </p>
      )}
      {q.error && (
        <div className="wk-error">
          <ErrorMessage error={q.error.message} />
          <button className="button button-secondary button-small" onClick={() => void q.retry()}>
            Retry milestone
          </button>
        </div>
      )}
      <header className="wk-head">
        <div>
          {m ? (
            <>
              <h4>{m.title}</h4>
              <div className="wk-chips">
                <span className={`pill ${milestoneTone[m.state] ?? 'pill-slate'}`}>
                  {milestoneState[m.state] ?? m.state.replaceAll('_', ' ')}
                </span>
                <span className="wk-chip">Criteria version {m.criteriaVersion}</span>
              </div>
              {m.description && <p>{m.description}</p>}
            </>
          ) : (
            <h4>Milestone</h4>
          )}
        </div>
        <button className="button button-secondary button-small" onClick={onClose}>
          <X size={13} />
          Close milestone
        </button>
      </header>
      {m && (
        <>
          <dl className="wk-review-facts">
            <div>
              <dt>Owner</dt>
              <dd>{personName(data, m.ownerId)}</dd>
            </div>
            <div>
              <dt>Independent reviewer</dt>
              <dd>{m.reviewerId ? personName(data, m.reviewerId) : 'Not assigned'}</dd>
            </div>
            <div>
              <dt>Original</dt>
              <dd>{m.originalDueAt || m.originalDueDate || 'No deadline'}</dd>
            </div>
            <div>
              <dt>Current</dt>
              <dd>{commitmentLabel(m)}</dd>
            </div>
          </dl>
          {!m.basisCurrent && (
            <p role="alert" className="notice notice-warning">
              {m.basisNotice}
            </p>
          )}
          <div className="wk-steps">
            <h5 className="wk-sub-title">Acceptance criteria</h5>
            <ol className="wk-criteria">
              {m.criteria.map((c) => (
                <li key={c.id}>
                  <p>{c.text}</p>
                  {m.canReview && assertionFor(c.id) && (
                    <blockquote>{assertionFor(c.id)}</blockquote>
                  )}
                  {m.canSubmit && !action.attempt && (
                    <Field label={'Criterion assertion: ' + c.text}>
                      <textarea
                        rows={2}
                        value={assertions[c.id] ?? ''}
                        onChange={(e) => setAssertions((v) => ({ ...v, [c.id]: e.target.value }))}
                        disabled={!!action.attempt}
                      />
                    </Field>
                  )}
                </li>
              ))}
            </ol>
            {m.canReview && otherAssertions.length > 0 && (
              <div className="wk-sub">
                <h6 className="wk-sub-title">Other submitted statements</h6>
                <p className="wk-caption">
                  Submitted against criteria that are no longer part of this milestone.
                </p>
                <ul className="wk-list">
                  {otherAssertions.map((a, i) => (
                    <li key={a.criterionId + ':' + i}>
                      <blockquote>{a.statement}</blockquote>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {m.taskIds.length > 0 && (
            <div className="wk-steps">
              <h5 className="wk-sub-title">Selected tasks</h5>
              <ul className="wk-list">
                {m.taskIds.map((task) => {
                  const t = data.tasks.find((v) => v.id === task);
                  return (
                    <li key={task}>
                      <button
                        className="wk-link"
                        aria-label={`Inspect selected task evidence${t ? `: ${t.code} ${t.title}` : ''}`}
                        onClick={() => onTask(task)}
                      >
                        {t ? (
                          <>
                            <span className="wk-code">{t.code}</span>
                            {t.title}
                          </>
                        ) : (
                          'Inspect selected task evidence'
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {m.canSubmit && !action.attempt && (
            <div className="wk-sub">
              <h5 className="wk-sub-title">Submit for independent review</h5>
              <p className="wk-caption">
                Confirm every selected task is currently accepted, then write an assertion for each
                criterion. {m.reviewerId ? personName(data, m.reviewerId) : 'The reviewer'} decides.
              </p>
              {basis && (
                <p className="pill pill-green wk-pill">
                  Inspected {basis.length} currently accepted tasks.
                </p>
              )}
              <div className="wk-actions">
                {(!basis || missingAssertions) && (
                  <span className="wk-hint">
                    {!basis
                      ? 'Inspect the current submission basis first.'
                      : 'Write an assertion for every criterion to submit.'}
                  </span>
                )}
                <button className="button button-secondary" onClick={inspectBasis}>
                  Inspect current submission basis
                </button>
                <button
                  className="button button-primary"
                  disabled={action.busy || !basis || missingAssertions}
                  onClick={() => void transition('submit')}
                >
                  {action.attempt
                    ? 'Retry same milestone submission'
                    : 'Submit milestone for independent review'}
                </button>
              </div>
            </div>
          )}
          {m.state === 'in_review' && !m.canReview && (
            <div className="wk-review wk-review-waiting">
              <div className="wk-review-head">
                <ShieldCheck size={16} />
                <h4>Waiting for independent review</h4>
              </div>
              <p>
                {m.reviewerId ? personName(data, m.reviewerId) : 'The assigned reviewer'} can accept
                this milestone. The owner cannot accept their own milestone.
              </p>
            </div>
          )}
          {m.canReview && !action.attempt && (
            <div className="wk-review">
              <div className="wk-review-head">
                <ShieldCheck size={16} />
                <h4>Your independent review</h4>
              </div>
              <p>
                Review assertions against each task’s current evidence. Bound task versions:{' '}
                {m.submittedTasks.map((t) => t.version).join(', ')}.
              </p>
              <Field label="Independent milestone review note">
                <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <div className="wk-actions">
                {!m.basisCurrent && (
                  <span className="wk-hint">
                    Acceptance is unavailable while the submitted task basis is out of date.
                  </span>
                )}
                <button
                  className="button button-dark"
                  disabled={action.busy || !m.basisCurrent}
                  onClick={() => void transition('approve')}
                >
                  <Check size={14} />
                  {action.attempt
                    ? 'Retry same milestone decision'
                    : 'Accept milestone independently'}
                </button>
              </div>
              <Field label="Milestone change request reason">
                <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <div className="wk-actions">
                {!reason.trim() && (
                  <span className="wk-hint">A reason is required to request changes.</span>
                )}
                <button
                  className="button button-secondary"
                  disabled={action.busy || !reason.trim()}
                  onClick={() => void transition('request_changes')}
                >
                  Request milestone changes
                </button>
              </div>
            </div>
          )}
          {m.canReopen && !action.attempt && (
            <div className="wk-sub">
              <Field label="Milestone reopen reason">
                <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <div className="wk-actions">
                <button
                  className="button button-secondary"
                  disabled={action.busy || !reason.trim()}
                  onClick={() => void transition('reopen')}
                >
                  Reopen milestone for fresh review
                </button>
              </div>
            </div>
          )}
          {m.canEdit && !editing && (
            <div className="wk-actions">
              <button className="button button-secondary" onClick={() => setEditing(true)}>
                <Pencil size={13} />
                Edit milestone criteria
              </button>
            </div>
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
          {!!action.attempt && (
            <div className="wk-actions">
              <button
                className="button button-primary"
                disabled={action.busy}
                onClick={() =>
                  void action
                    .execute(`/project-milestones/${id}/transition`, action.attempt!.payload)
                    .then(() => q.retry())
                    .catch(() => {})
                }
              >
                Retry same milestone action
              </button>
            </div>
          )}
          <ExecutionRecovery
            action={action}
            onReconcile={() => {
              clearExecutionForm(
                store.companyId,
                store.session?.user.id ?? store.data!.me.id,
                '$milestone:' + id,
              );
              void q.retry();
            }}
          />
          {m.acceptances && m.acceptances.length > 0 && (
            <div className="wk-steps">
              <h5 className="wk-sub-title">Historical human acceptance</h5>
              <ul className="wk-list wk-history">
                {m.acceptances.map((a) => (
                  <li key={a.id}>
                    <span className="wk-code">
                      {a.createdAt} · Criteria {a.criteriaVersion} · Project {a.projectVersion}
                    </span>
                    {a.note && <p>{a.note}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {(error || action.error) && <ErrorMessage error={error || action.error} />}
    </section>
  );
}
