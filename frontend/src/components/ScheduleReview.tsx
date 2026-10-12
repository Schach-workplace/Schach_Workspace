import type { ScheduleContext } from '../../../shared/business/types';
import ExecutionRecovery from './ExecutionRecovery';
import { useExecutionInput, clearExecutionForm } from '../data/executionInput';
import { clearAttemptScope } from '../data/businessAttempts';
import { commitmentLabel } from '../../../shared/business/types';
import { useEffect, useState, type ReactNode } from 'react';
import '../styles/work.css';
import { useWorkspace } from '../store';
import type { Task } from '../types';
import {
  useExecutionRead,
  useExecutionMutation,
  type ScheduleChange,
  type ScheduleProposalView,
} from '../data/execution';
import { deadlineCandidates, localDeadline } from '../data/deadlines';
import { Field, ErrorMessage } from './UI';
export default function ScheduleReview({
  tasks,
  onDone,
  context,
  ready = true,
  embedded = false,
  onPendingChange,
  onBusyChange,
}: {
  tasks: Task[];
  onDone?: () => void;
  context?: ScheduleContext;
  ready?: boolean;
  embedded?: boolean;
  /** Reports whether a submission is in flight or a frozen attempt awaits recovery. */
  onPendingChange?: (pending: boolean) => void;
  /** Reports whether a preview or confirmation request is currently in flight. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const store = useWorkspace();
  const data = store.data!;
  const identity = tasks
    .map((t) => t.id)
    .sort()
    .join(':');
  const [inspectedContext, freezeContext] = useExecutionInput<ScheduleContext | undefined>(
    '$schedule:' + identity,
    'context',
    context,
  );
  const previewAction = useExecutionMutation('schedule-preview:' + identity);
  const applyAction = useExecutionMutation('schedule-apply:' + identity);
  const pending = !!(
    previewAction.attempt ||
    applyAction.attempt ||
    previewAction.busy ||
    applyAction.busy
  );
  useEffect(() => {
    if (!pending) return;
    onPendingChange?.(true);
    return () => onPendingChange?.(false);
  }, [pending, onPendingChange]);
  const busy = previewAction.busy || applyAction.busy;
  useEffect(() => {
    if (!busy) return;
    onBusyChange?.(true);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const [rows, setRows] = useExecutionInput<ScheduleChange[]>(
    '$schedule:' + identity,
    'rows',
    () =>
      (previewAction.attempt?.payload.changes as ScheduleChange[]) ??
      tasks
        .filter((t) => t.status !== 'done')
        .map((t) => ({
          taskId: t.id,
          version: t.version,
          startDate: t.startDate,
          dueDate: t.dueDate,
          deadlineMode: t.deadlineMode ?? 'all_day',
          dueAt: t.dueAt ?? '',
          dueTimezone: t.dueTimezone ?? '',
          reason: '',
        })),
  );
  const [selected, setSelected] = useExecutionInput<string[]>(
    '$schedule:' + identity,
    'selected',
    () => rows.map((r) => r.taskId),
  );
  const [proposalId, setProposalId] = useExecutionInput(
    '$schedule:' + identity,
    'proposal',
    String(applyAction.attempt?.payload.proposalId ?? ''),
  );
  const [method, setMethod] = useExecutionInput<'manual' | 'calendar_day_shift'>(
    '$schedule:' + identity,
    'method',
    'manual',
  );
  const [offset, setOffset] = useExecutionInput('$schedule:' + identity, 'offset', 1);
  const [error, setError] = useState('');
  const [wall, setWall] = useExecutionInput<Record<string, string>>(
    '$schedule:' + identity,
    'wall',
    {},
  );
  const [fold, setFold] = useExecutionInput<Record<string, string>>(
    '$schedule:' + identity,
    'fold',
    {},
  );
  const inspected = useExecutionRead<{ proposal: ScheduleProposalView }>(
    `/task-schedule/${proposalId}`,
    !!proposalId,
  );
  const view = inspected.data?.proposal;
  useEffect(() => {
    if (inspected.denied) {
      clearAttemptScope(previewAction.scope);
      clearAttemptScope(applyAction.scope);
      setProposalId('');
    }
  }, [inspected.denied]);
  const freezeInspected = () => {
    freezeContext(inspectedContext);
    setRows(rows);
  };
  const update = (id: string, key: keyof ScheduleChange, value: unknown) => {
    if (inspectedContext) freezeContext(inspectedContext);
    setProposalId('');
    setMethod('manual');
    setRows((rows) => rows.map((r) => (r.taskId === id ? { ...r, [key]: value } : r)));
  };
  async function run(fn: () => Promise<void>) {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const preview = () =>
    void run(async () => {
      const changes = rows
        .filter((r) => selected.includes(r.taskId))
        .map((r) => {
          if (method === 'calendar_day_shift') {
            const shift = (date: string) => {
              if (!date) return '';
              const d = new Date(date + 'T12:00:00Z');
              d.setUTCDate(d.getUTCDate() + offset);
              return d.toISOString().slice(0, 10);
            };
            return {
              ...r,
              startDate: shift(r.startDate),
              dueDate: shift(r.dueDate),
              deadlineMode: 'all_day',
              dueAt: '',
              dueTimezone: '',
            };
          }
          if (r.deadlineMode === 'all_day') return { ...r, dueAt: '', dueTimezone: '' };
          const zone = r.dueTimezone || data.company.timezone;
          const time =
            wall[r.taskId] ?? (r.dueAt ? localDeadline(r.dueAt, zone).slice(11) : '16:00');
          const candidates = deadlineCandidates(r.dueDate + 'T' + time, zone);
          const at = candidates.length === 1 ? candidates[0] : fold[r.taskId];
          if (!at || !candidates.includes(at))
            throw Error('Choose a valid local time and explicit repeated-time offset.');
          return { ...r, dueAt: at, dueTimezone: zone };
        });
      const projectIds = [
        ...new Set(
          tasks
            .filter((t) => selected.includes(t.id))
            .map((t) => t.projectId)
            .filter(Boolean),
        ),
      ];
      const projects =
        inspectedContext?.projects ??
        projectIds.map((id) => {
          const p = data.projects.find((p) => p.id === id);
          if (!p?.version) throw Error('Open and inspect the current project before previewing.');
          return { id, version: p.version };
        });
      const result = await previewAction.execute<{ proposal: ScheduleProposalView }>(
        '/task-schedule/preview',
        previewAction.attempt?.payload ?? {
          method,
          ...(method === 'calendar_day_shift' ? { dayOffset: offset } : {}),
          changes,
          context: inspectedContext ?? { projects, milestones: [] },
        },
      );
      setProposalId(result.proposal.id);
    });
  const confirm = (view: ScheduleProposalView) =>
    void run(async () => {
      await applyAction.execute(
        '/task-schedule/apply',
        applyAction.attempt?.payload ?? {
          proposalId: view.id,
          expectedProposalVersion: view.version,
        },
      );
      setProposalId('');
      onDone?.();
    });
  const methodLabel: Record<string, string> = {
    manual: 'Manual reviewed dates',
    calendar_day_shift: 'Company-calendar day shift',
  };
  const missingReason = rows.some((r) => selected.includes(r.taskId) && !r.reason.trim());
  return (
    <section className={`wk-card${embedded ? ' wk-embedded' : ''}`} aria-label="Reviewed schedule">
      <header className={embedded ? 'wk-caption-only' : 'wk-head'}>
        <div>
          {!embedded && <h3>Reviewed schedule</h3>}
          <p className={embedded ? 'wk-caption' : undefined}>
            Select authorized open work and review each original, current and proposed commitment.
            Cancel changes no tasks.
          </p>
        </div>
      </header>
      {tasks.every((t) => t.status === 'done') && (
        <p className="notice">
          Accepted work must be reopened through its existing review workflow.
        </p>
      )}
      {!proposalId && !applyAction.attempt && (
        <>
          <div className="form-grid">
            <Field label="Schedule method">
              <select
                value={method}
                onChange={(e) => {
                  freezeInspected();
                  setMethod(e.target.value as typeof method);
                }}
                disabled={!!previewAction.attempt}
              >
                <option value="manual">Manual reviewed dates</option>
                <option value="calendar_day_shift">Company-calendar day shift</option>
              </select>
            </Field>
            {method === 'calendar_day_shift' && (
              <Field label="Signed day offset" hint="Negative moves earlier, positive later.">
                <input
                  type="number"
                  min={-366}
                  max={366}
                  value={offset}
                  onChange={(e) => {
                    freezeInspected();
                    setOffset(Number(e.target.value));
                  }}
                />
              </Field>
            )}
          </div>
          <div className="wk-rows">
            {rows.map((r) => {
              const task = tasks.find((t) => t.id === r.taskId)!;
              const title = ready ? task.title : 'Selected work';
              const time =
                wall[r.taskId] ??
                (r.dueAt
                  ? localDeadline(r.dueAt, r.dueTimezone || data.company.timezone).slice(11)
                  : '16:00');
              const candidates =
                r.deadlineMode === 'timed' && r.dueDate
                  ? deadlineCandidates(
                      r.dueDate + 'T' + time,
                      r.dueTimezone || data.company.timezone,
                    )
                  : [];
              const isSelected = selected.includes(r.taskId);
              return (
                <fieldset
                  key={r.taskId}
                  className="wk-row-card"
                  disabled={!!previewAction.attempt || previewAction.busy}
                >
                  <legend>
                    <label className="wk-check">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          freezeInspected();
                          setSelected((ids) =>
                            e.target.checked
                              ? [...ids, r.taskId]
                              : ids.filter((id) => id !== r.taskId),
                          );
                        }}
                      />
                      {title}
                    </label>
                  </legend>
                  <div className="wk-commit">
                    <p>
                      Original:{' '}
                      {ready &&
                        commitmentLabel({
                          dueDate: task.originalDueDate,
                          deadlineMode: task.originalDeadlineMode ?? 'all_day',
                          dueAt: task.originalDueAt ?? '',
                          dueTimezone: task.originalDueTimezone ?? '',
                        })}
                    </p>
                    <p>Current: {ready ? commitmentLabel(task) : 'Checking current source…'}</p>
                  </div>
                  {method === 'manual' && (
                    <div className="form-grid">
                      <RowField label="Start date" title={title}>
                        <input
                          type="date"
                          value={r.startDate}
                          onChange={(e) => update(r.taskId, 'startDate', e.target.value)}
                        />
                      </RowField>
                      <RowField label="Due date" title={title}>
                        <input
                          type="date"
                          value={r.dueDate}
                          onChange={(e) => update(r.taskId, 'dueDate', e.target.value)}
                        />
                      </RowField>
                      <RowField label="Deadline mode" title={title}>
                        <select
                          value={r.deadlineMode}
                          onChange={(e) => update(r.taskId, 'deadlineMode', e.target.value)}
                        >
                          <option value="all_day">All day</option>
                          <option value="timed">Timed with explicit offset</option>
                        </select>
                      </RowField>
                      {r.deadlineMode === 'timed' && (
                        <>
                          <RowField label="Local deadline time" title={title}>
                            <input
                              type="time"
                              value={time}
                              onChange={(e) => {
                                freezeInspected();
                                setWall((v) => ({ ...v, [r.taskId]: e.target.value }));
                              }}
                            />
                          </RowField>
                          <RowField label="Commitment timezone" title={title}>
                            <input
                              value={r.dueTimezone || data.company.timezone}
                              onChange={(e) => update(r.taskId, 'dueTimezone', e.target.value)}
                            />
                          </RowField>
                          {candidates.length > 1 && (
                            <RowField label="Repeated time offset" title={title}>
                              <select
                                value={fold[r.taskId] ?? ''}
                                onChange={(e) => {
                                  freezeInspected();
                                  setFold((v) => ({ ...v, [r.taskId]: e.target.value }));
                                }}
                              >
                                <option value="">Choose an instant</option>
                                {candidates.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </RowField>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  {method === 'manual' && r.deadlineMode === 'timed' && candidates.length === 0 && (
                    <p role="alert" className="inline-error">
                      This local time does not exist. Choose another time.
                    </p>
                  )}
                  <RowField label="Reason" title={title}>
                    <textarea
                      rows={2}
                      value={r.reason}
                      onChange={(e) => update(r.taskId, 'reason', e.target.value)}
                    />
                  </RowField>
                </fieldset>
              );
            })}
          </div>
        </>
      )}
      {proposalId && !view && (
        <p role="status" className="wk-status">
          Checking the proposal’s current source access…
        </p>
      )}
      {view && (
        <>
          <div className="wk-chips">
            <span className="pill pill-slate">{methodLabel[view.method] ?? view.method}</span>
            <span className="wk-chip">Expires {view.expiresAt}</span>
          </div>
          <div className="wk-rows">
            {view.rows.map((row) => (
              <article className="wk-row-card" key={row.taskId}>
                <h4>{row.title}</h4>
                <div className="wk-commit">
                  <p>Original: {commitmentLabel(row.original)}</p>
                  <p>Before preview: {commitmentLabel(row.before)}</p>
                  <p>Current: {commitmentLabel(row.current)}</p>
                  <p className="wk-proposed">Proposed: {commitmentLabel(row.after)}</p>
                </div>
                <p className="wk-reason">Reason: {row.reason}</p>
              </article>
            ))}
          </div>
          {view.advisories.length > 0 && (
            <div className="notice notice-warning">
              <strong>
                {view.advisories.length} advisor{view.advisories.length === 1 ? 'y' : 'ies'}
              </strong>
              <ul>
                {view.advisories.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {view.expired && (
            <p role="alert" className="notice notice-warning">
              This preview expired. Review the dates in a fresh preview.
            </p>
          )}
        </>
      )}
      <ExecutionRecovery action={previewAction} />
      <ExecutionRecovery
        action={applyAction}
        onReconcile={() => {
          setProposalId('');
          clearExecutionForm(
            store.companyId,
            store.session?.user.id ?? data.me.id,
            '$schedule:' + identity,
          );
        }}
      />
      {(error || previewAction.error || applyAction.error || inspected.error) && (
        <ErrorMessage
          error={
            error || previewAction.error || applyAction.error || inspected.error?.message || ''
          }
        />
      )}
      <div className="wk-actions">
        {!proposalId && !applyAction.attempt && missingReason && (
          <span className="wk-hint">Add a reason for each selected task to preview.</span>
        )}
        <button
          className="button button-secondary"
          disabled={applyAction.busy || previewAction.busy}
          onClick={onDone}
        >
          Cancel schedule review
        </button>
        {!proposalId && !applyAction.attempt && (
          <button
            className="button button-primary"
            disabled={!ready || previewAction.busy || !selected.length || missingReason}
            onClick={preview}
          >
            {previewAction.attempt ? 'Retry same schedule preview' : 'Preview schedule'}
          </button>
        )}
        {view && (
          <>
            <button
              className="button button-secondary"
              disabled={applyAction.busy || !!applyAction.attempt}
              onClick={() => setProposalId('')}
            >
              Edit and create a fresh preview
            </button>
            <button
              className="button button-primary"
              disabled={!ready || applyAction.busy || (view.expired && !applyAction.attempt)}
              onClick={() => confirm(view)}
            >
              {applyAction.attempt
                ? 'Retry same schedule confirmation'
                : 'Confirm reviewed schedule'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
function RowField({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        <span className="sr-only">: {title}</span>
      </span>
      {children}
    </label>
  );
}
