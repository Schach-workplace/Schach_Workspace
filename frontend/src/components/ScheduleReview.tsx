import { clearAttemptScope } from '../data/businessAttempts';
import { commitmentLabel } from '../../../shared/business/types';
import { useEffect, useState } from 'react';
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
export default function ScheduleReview({ tasks, onDone }: { tasks: Task[]; onDone?: () => void }) {
  const store = useWorkspace();
  const data = store.data!;
  const identity = tasks
    .map((t) => t.id)
    .sort()
    .join(':');
  const previewAction = useExecutionMutation('schedule-preview:' + identity);
  const applyAction = useExecutionMutation('schedule-apply:' + identity);
  const [rows, setRows] = useState<ScheduleChange[]>(
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
  const [selected, setSelected] = useState<string[]>(rows.map((r) => r.taskId));
  const [proposal, setProposal] = useState<ScheduleProposalView>();
  const [method, setMethod] = useState<'manual' | 'calendar_day_shift'>('manual');
  const [offset, setOffset] = useState(1);
  const [error, setError] = useState('');
  const [wall, setWall] = useState<Record<string, string>>({});
  const [fold, setFold] = useState<Record<string, string>>({});
  const inspected = useExecutionRead<{ proposal: ScheduleProposalView }>(
    `/task-schedule/${proposal?.id}`,
    !!proposal,
  );
  const view = inspected.data?.proposal ?? (inspected.ready ? proposal : undefined);
  useEffect(() => {
    if (inspected.denied) {
      clearAttemptScope(previewAction.scope);
      clearAttemptScope(applyAction.scope);
      setProposal(undefined);
    }
  }, [inspected.denied]);
  const update = (id: string, key: keyof ScheduleChange, value: unknown) => {
    setProposal(undefined);
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
  return (
    <section className="panel execution-panel" aria-label="Reviewed schedule">
      <h3>Reviewed schedule</h3>
      <p>
        Select authorized open work and review each original, current and proposed commitment.
        Cancel changes no tasks.
      </p>
      {tasks.every((t) => t.status === 'done') && (
        <p>Accepted work must be reopened through its existing review workflow.</p>
      )}
      {!proposal && (
        <>
          <Field label="Schedule method">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as typeof method)}
              disabled={!!previewAction.attempt}
            >
              <option value="manual">Manual reviewed dates</option>
              <option value="calendar_day_shift">Company-calendar day shift</option>
            </select>
          </Field>
          {method === 'calendar_day_shift' && (
            <Field label="Signed day offset">
              <input
                type="number"
                min={-366}
                max={366}
                value={offset}
                onChange={(e) => setOffset(Number(e.target.value))}
              />
            </Field>
          )}
          {rows.map((r) => {
            const task = tasks.find((t) => t.id === r.taskId)!;
            const title = task.title;
            const time =
              wall[r.taskId] ??
              (r.dueAt
                ? localDeadline(r.dueAt, r.dueTimezone || data.company.timezone).slice(11)
                : '16:00');
            const candidates =
              r.deadlineMode === 'timed' && r.dueDate
                ? deadlineCandidates(r.dueDate + 'T' + time, r.dueTimezone || data.company.timezone)
                : [];
            return (
              <fieldset key={r.taskId} disabled={!!previewAction.attempt || previewAction.busy}>
                <legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(r.taskId)}
                      onChange={(e) =>
                        setSelected((ids) =>
                          e.target.checked
                            ? [...ids, r.taskId]
                            : ids.filter((id) => id !== r.taskId),
                        )
                      }
                    />
                    {title}
                  </label>
                </legend>
                <p>
                  Original:{' '}
                  {commitmentLabel({
                    dueDate: task.originalDueDate,
                    deadlineMode: task.originalDeadlineMode ?? 'all_day',
                    dueAt: task.originalDueAt ?? '',
                    dueTimezone: task.originalDueTimezone ?? '',
                  })}
                </p>
                <p>Current: {commitmentLabel(task)}</p>
                {method === 'manual' && (
                  <>
                    <Field label={'Start date: ' + title}>
                      <input
                        type="date"
                        value={r.startDate}
                        onChange={(e) => update(r.taskId, 'startDate', e.target.value)}
                      />
                    </Field>
                    <Field label={'Due date: ' + title}>
                      <input
                        type="date"
                        value={r.dueDate}
                        onChange={(e) => update(r.taskId, 'dueDate', e.target.value)}
                      />
                    </Field>
                    <Field label={'Deadline mode: ' + title}>
                      <select
                        value={r.deadlineMode}
                        onChange={(e) => update(r.taskId, 'deadlineMode', e.target.value)}
                      >
                        <option value="all_day">All day</option>
                        <option value="timed">Timed with explicit offset</option>
                      </select>
                    </Field>
                    {r.deadlineMode === 'timed' && (
                      <>
                        <Field label={'Local deadline time: ' + title}>
                          <input
                            type="time"
                            value={time}
                            onChange={(e) => setWall((v) => ({ ...v, [r.taskId]: e.target.value }))}
                          />
                        </Field>
                        <Field label={'Commitment timezone: ' + title}>
                          <input
                            value={r.dueTimezone || data.company.timezone}
                            onChange={(e) => update(r.taskId, 'dueTimezone', e.target.value)}
                          />
                        </Field>
                        {candidates.length > 1 && (
                          <Field label={'Repeated time offset: ' + title}>
                            <select
                              value={fold[r.taskId] ?? ''}
                              onChange={(e) =>
                                setFold((v) => ({ ...v, [r.taskId]: e.target.value }))
                              }
                            >
                              <option value="">Choose an instant</option>
                              {candidates.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </Field>
                        )}
                        {candidates.length === 0 && (
                          <p role="alert">This local time does not exist. Choose another time.</p>
                        )}
                      </>
                    )}
                  </>
                )}
                <Field label={'Reason: ' + title}>
                  <textarea
                    value={r.reason}
                    onChange={(e) => update(r.taskId, 'reason', e.target.value)}
                  />
                </Field>
              </fieldset>
            );
          })}
          <button
            className="button button-primary"
            disabled={
              previewAction.busy ||
              !selected.length ||
              rows.some((r) => selected.includes(r.taskId) && !r.reason.trim())
            }
            onClick={() =>
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
                      wall[r.taskId] ??
                      (r.dueAt ? localDeadline(r.dueAt, zone).slice(11) : '16:00');
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
                const projects = projectIds.map((id) => {
                  const p = data.projects.find((p) => p.id === id);
                  if (!p?.version)
                    throw Error('Open and inspect the current project before previewing.');
                  return { id, version: p.version };
                });
                const result = await previewAction.execute<{ proposal: ScheduleProposalView }>(
                  '/task-schedule/preview',
                  {
                    method,
                    ...(method === 'calendar_day_shift' ? { dayOffset: offset } : {}),
                    changes,
                    context: { projects, milestones: [] },
                  },
                );
                setProposal(result.proposal);
              })
            }
          >
            {previewAction.attempt ? 'Retry same schedule preview' : 'Preview schedule'}
          </button>
        </>
      )}
      {proposal && !view && <p role="status">Checking the proposal’s current source access…</p>}
      {view && (
        <>
          <p>
            {view.method} · Expires {view.expiresAt}
          </p>
          {view.rows.map((row) => (
            <article key={row.taskId}>
              <h4>{row.title}</h4>
              <p>Original: {commitmentLabel(row.original)}</p>
              <p>Before preview: {commitmentLabel(row.before)}</p>
              <p>Current: {commitmentLabel(row.current)}</p>
              <p>Proposed: {commitmentLabel(row.after)}</p>
              <p>Reason: {row.reason}</p>
            </article>
          ))}
          {view.advisories.map((a) => (
            <p key={a}>{a}</p>
          ))}
          {view.expired && (
            <p role="alert">This preview expired. Review the dates in a fresh preview.</p>
          )}
          <button
            className="button"
            disabled={applyAction.busy || !!applyAction.attempt}
            onClick={() => setProposal(undefined)}
          >
            Edit and create a fresh preview
          </button>
          <button
            className="button button-primary"
            disabled={applyAction.busy || (view.expired && !applyAction.attempt)}
            onClick={() =>
              void run(async () => {
                await applyAction.execute('/task-schedule/apply', {
                  proposalId: view.id,
                  expectedProposalVersion: view.version,
                });
                setProposal(undefined);
                onDone?.();
              })
            }
          >
            {applyAction.attempt ? 'Retry same schedule confirmation' : 'Confirm reviewed schedule'}
          </button>
        </>
      )}
      <button className="button" disabled={applyAction.busy || previewAction.busy} onClick={onDone}>
        Cancel schedule review
      </button>
      {(error || previewAction.error || applyAction.error || inspected.error) && (
        <ErrorMessage
          error={
            error || previewAction.error || applyAction.error || inspected.error?.message || ''
          }
        />
      )}
    </section>
  );
}
