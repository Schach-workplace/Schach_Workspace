import { useState } from 'react';
import { useWorkspace } from '../store';
import {
  usePlanningRead,
  type PlanningView as View,
  type PlanningDrill,
  type PlanningTask,
  type PlanningWarning,
} from '../data/planning';
import { useExecutionInput } from '../data/executionInput';
import type { ScheduleContext } from '../../../shared/business/types';
import type { Task } from '../types';
import ScheduleReview from './ScheduleReview';
import { addDays, today, Field } from './UI';
export default function PlanningView({
  onTask,
  from: initialFrom,
  to: initialTo,
}: {
  onTask: (id: string) => void;
  from?: string;
  to?: string;
}) {
  const w = useWorkspace();
  const data = w.data!;
  const date = today(data.company.timezone);
  const start = initialFrom ?? addDays(date, -(new Date(date + 'T12:00Z').getUTCDay() + 6) % 7);
  const [period, setPeriod] = useExecutionInput('$planning', 'period', () => ({
    from: start,
    to: initialTo ?? addDays(start, 6),
    ownerId: '',
    departmentId: '',
  }));
  const [drill, setDrill] = useExecutionInput<PlanningDrill | undefined>(
    '$planning',
    'drill',
    undefined,
  );
  const [selected, setSelected] = useExecutionInput<string[]>('$planning', 'selected', []);
  const [review, setReview] = useExecutionInput('$planning', 'review', false);
  const qs = new URLSearchParams(period).toString();
  const summary = usePlanningRead<View>('/planning/summary?' + qs);
  const view = summary.ready ? summary.data : undefined;
  const basis = view?.projectionBasis ?? '';
  const warnings = usePlanningRead<{ warnings: PlanningWarning[] }>(
    `/planning/warnings?${qs}&projectionBasis=${basis}`,
    !!view,
  );
  const tasks = usePlanningRead<{ tasks: PlanningTask[] }>(
    `/planning/tasks?${qs}&projectionBasis=${basis}&${new URLSearchParams(drill ?? {}).toString()}`,
    !!view && !!drill,
  );
  const seed = usePlanningRead<{ tasks: Task[]; context: ScheduleContext }>(
    `/planning/schedule-seed?${qs}&projectionBasis=${basis}&taskIds=${selected.join(',')}`,
    review && !!view && !!selected.length,
  );
  const change = (k: string, v: string) => {
    setPeriod((p) => ({ ...p, [k]: v }));
    setDrill(undefined);
    setSelected([]);
    setReview(false);
  };
  return (
    <section className="page-content">
      <h2>Planning authorized work</h2>
      {w.mode === 'demo' ? (
        <p>
          Current planning projections and schedule suggestions require a connected company server.
        </p>
      ) : (
        <>
          <div className="form-grid">
            <Field label="Planning from">
              <input
                type="date"
                value={period.from}
                onChange={(e) => change('from', e.target.value)}
              />
            </Field>
            <Field label="Planning to">
              <input type="date" value={period.to} onChange={(e) => change('to', e.target.value)} />
            </Field>
            <Field label="Planning owner">
              <select value={period.ownerId} onChange={(e) => change('ownerId', e.target.value)}>
                <option value="">Authorized owners</option>
                {data.people
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Planning department">
              <select
                value={period.departmentId}
                onChange={(e) => change('departmentId', e.target.value)}
              >
                <option value="">Authorized departments</option>
                {data.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {!view ? (
            <p role="status">{summary.error?.message ?? 'Checking current planning sources…'}</p>
          ) : (
            <>
              <p>{view.methodDescription}</p>
              <p>Unique selected effort: {view.coverage.uniqueSelectedRemainingHours} h</p>
              <p>Weekly exposure: {view.coverage.weeklyExposureHours} h</p>
              <p>
                Visible coverage: {view.coverage.undated} undated; {view.coverage.invalidInterval}{' '}
                invalid intervals; {view.coverage.recordedZeroEstimate} recorded zero estimates;{' '}
                {view.coverage.missingOwner} missing owners; {view.coverage.invalidNumeric} invalid
                effort inputs.
              </p>
              {(['undated', 'invalid', 'zero_estimate'] as const).map((category) => (
                <button className="button" key={category} onClick={() => setDrill({ category })}>
                  Inspect {category.replace('_', ' ')}
                </button>
              ))}
              {view.weeks.map((week) => (
                <section className="panel" key={week.from}>
                  <h3>
                    {week.from} – {week.to}
                  </h3>
                  <p>
                    {week.partial
                      ? 'Partial selected week uses whole recorded weekly capacity.'
                      : 'Whole recorded weekly capacity.'}{' '}
                    Visible remaining effort: {week.remainingHours} h
                  </p>
                  {week.people.map((p) => (
                    <article key={p.id}>
                      <h4>{p.name}</h4>
                      <p>
                        Recorded capacity: {p.recordedCapacity} h · Visible remaining:{' '}
                        {p.remainingHours} h ·{' '}
                        {p.utilization === null
                          ? p.capacityState === 'recorded_zero'
                            ? 'Recorded zero / utilization unavailable'
                            : 'Invalid capacity / utilization unavailable'
                          : p.utilization + '% utilization'}
                      </p>
                      <button
                        className="button"
                        onClick={() => {
                          setDrill(p.drill);
                          setReview(false);
                        }}
                      >
                        Inspect work for {p.name}
                      </button>
                    </article>
                  ))}
                  <button
                    className="button"
                    onClick={() => {
                      setDrill(week.drill);
                      setReview(false);
                    }}
                  >
                    Inspect week
                  </button>
                </section>
              ))}
              {warnings.ready &&
                warnings.data?.warnings.map((warning, i) => (
                  <section key={i} className="panel">
                    <p>{warning.description}</p>
                    <button
                      className="button"
                      onClick={() => {
                        setDrill(warning.drill);
                        setReview(false);
                      }}
                    >
                      Inspect warning work
                    </button>
                  </section>
                ))}
            </>
          )}
          {view && drill && (
            <section aria-label="Current planning drill">
              <h3>Authorized task drill</h3>
              {tasks.ready ? (
                tasks.data?.tasks.map((task) => (
                  <article key={task.id}>
                    <button className="button" onClick={() => onTask(task.id)}>
                      {task.title}
                    </button>
                    <span>
                      {' '}
                      {task.remainingHours} h · {task.dueDate || task.state}
                    </span>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.includes(task.id)}
                        onChange={(e) => {
                          setSelected((ids) =>
                            e.target.checked
                              ? [...ids, task.id]
                              : ids.filter((id) => id !== task.id),
                          );
                          setReview(false);
                        }}
                      />
                      Select for explicit schedule review
                    </label>
                  </article>
                ))
              ) : (
                <p role="status">{tasks.error?.message ?? 'Checking currently included tasks…'}</p>
              )}
              <button
                className="button"
                disabled={!tasks.ready || !selected.length}
                onClick={() => setReview(true)}
              >
                Review selected schedule
              </button>
            </section>
          )}
          {review && (
            <section>
              {
                <StableSchedule
                  seed={seed.ready ? seed.data : undefined}
                  selected={selected}
                  ready={!!view && seed.ready}
                  onDone={() => {
                    setReview(false);
                    setSelected([]);
                    void summary.retry?.();
                  }}
                />
              }
            </section>
          )}
        </>
      )}
    </section>
  );
}

function StableSchedule({
  seed,
  selected,
  ready,
  onDone,
}: {
  seed?: { tasks: Task[]; context: ScheduleContext };
  selected: string[];
  ready: boolean;
  onDone: () => void;
}) {
  const [base, setBase] = useState(seed);
  if (seed && !base) setBase(seed);
  return base ? (
    <ScheduleReview
      tasks={ready && seed ? seed.tasks : base.tasks.map((t) => ({ ...t, title: '' }))}
      context={base.context}
      ready={ready}
      onDone={onDone}
    />
  ) : (
    <p role="status">Checking current selected task and prerequisite versions…</p>
  );
}
