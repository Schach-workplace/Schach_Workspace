import IntelligenceLauncher from './IntelligenceLauncher';
import { useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  ChevronDown,
  CircleHelp,
  Gauge,
  Layers,
  ScanSearch,
  TriangleAlert,
} from 'lucide-react';
import { useWorkspace } from '../store';
import {
  usePlanningRead,
  type PlanningView as View,
  type PlanningDrill,
  type PlanningPerson,
  type PlanningTask,
  type PlanningWarning,
  type PlanningWeek,
} from '../data/planning';
import { useExecutionInput } from '../data/executionInput';
import type { ScheduleContext } from '../../../shared/business/types';
import type { Task } from '../types';
import ScheduleReview from './ScheduleReview';
import { addDays, today, cx, dateLabel, Modal } from './UI';
import '../styles/planning.css';

/** Presentation thresholds for utilization bars. They never change the server projection. */
const NEAR_CAPACITY = 85;
function level(u: number | null) {
  if (u === null) return 'na';
  if (u > 100) return 'over';
  if (u >= NEAR_CAPACITY) return 'near';
  return 'ok';
}
const hours = (n: number) => `${n} h`;
function weekLabel(from: string, to: string) {
  return `${dateLabel(from, { day: 'numeric', month: 'short' })} – ${dateLabel(to, { day: 'numeric', month: 'short' })}`;
}
const CATEGORY_LABEL: Record<PlanningDrill['category'], string> = {
  scheduled: 'Scheduled work',
  undated: 'Undated work',
  invalid: 'Work with invalid planning inputs',
  zero_estimate: 'Work with a zero estimate recorded',
};

export default function PlanningView({
  onTask,
  from: initialFrom,
  to: initialTo,
  compact = false,
}: {
  onTask: (id: string) => void;
  from?: string;
  to?: string;
  /** Calendar placement: summary first, detail behind a disclosure, link to Workload. */
  compact?: boolean;
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
  const [moreOpen, setMoreOpen] = useState(!compact);
  const coverageRef = useRef<HTMLElement>(null);
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
  const inspect = (next: PlanningDrill) => {
    setDrill(next);
    setReview(false);
  };
  const closeDrill = () => {
    setDrill(undefined);
    setReview(false);
  };
  // A schedule preview/confirmation in flight keeps the modal (and its focus
  // trap) open: dismissing it would hide the outcome of that submission.
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const dismissDrill = () => {
    if (!scheduleBusy) closeDrill();
  };
  const warningList = warnings.ready ? (warnings.data?.warnings ?? []) : [];
  const cov = view?.coverage;
  const gaps = cov
    ? cov.undated +
      cov.invalidInterval +
      cov.recordedZeroEstimate +
      cov.missingOwner +
      cov.invalidNumeric
    : 0;
  const peak = view ? peakOf(view.weeks) : undefined;
  const drillTitle = drill ? describeDrill(drill, data.people) : '';
  const detail = view && cov && (
    <>
      <CapacityMatrix weeks={view.weeks} onInspect={inspect} />
      <div className="planning-lower">
        <section className="panel planning-coverage" ref={coverageRef}>
          <div className="section-header">
            <div>
              <h3>Coverage gaps</h3>
              <p>Visible work with incomplete planning inputs.</p>
            </div>
          </div>
          <CoverageRow label="Undated" count={cov.undated} drill="undated" onInspect={inspect} />
          <CoverageRow
            label="Invalid intervals"
            count={cov.invalidInterval}
            drill="invalid"
            onInspect={inspect}
          />
          <CoverageRow label="Invalid effort inputs" count={cov.invalidNumeric} />
          <CoverageRow
            label="Zero estimates recorded"
            hint="Possibly unestimated"
            count={cov.recordedZeroEstimate}
            drill="zero_estimate"
            onInspect={inspect}
          />
          <CoverageRow label="Missing owners" count={cov.missingOwner} />
        </section>
        <Advisories
          ready={warnings.ready}
          error={warnings.error?.message}
          warnings={warningList}
          onInspect={inspect}
        />
      </div>
    </>
  );
  return (
    <section className={cx('page-content planning-view', compact && 'planning-compact')}>
      <header className="planning-head">
        <div>
          <h2>Planning authorized work</h2>
          <p>
            Remaining estimates of authorized work against recorded weekly capacity. Capacity is not
            attendance or free time.
          </p>
        </div>
        <div className="planning-head-actions">
          {compact && (
            <a className="button button-secondary" href="#workload">
              Open Workload <ArrowUpRight size={14} aria-hidden />
            </a>
          )}
          <IntelligenceLauncher
            label="Explain selected planning facts"
            operation="report_explanation"
            choices={
              view
                ? [
                    {
                      label: 'Current capacity projection',
                      source: {
                        kind: 'planning_projection',
                        id: view.projectionBasis,
                        selectedFieldSet: 'capacity',
                        filters: { ...period, projectId: '' },
                      },
                    },
                  ]
                : []
            }
          />
        </div>
      </header>
      {w.mode === 'demo' ? (
        <p className="notice planning-notice">
          Current planning projections and schedule suggestions require a connected company server.
        </p>
      ) : (
        <>
          <section
            className="report-controls panel planning-controls"
            aria-label="Planning filters"
          >
            <div className="report-dates">
              <label>
                From
                <input
                  type="date"
                  aria-label="Planning from"
                  value={period.from}
                  onChange={(e) => change('from', e.target.value)}
                />
              </label>
              <span aria-hidden>—</span>
              <label>
                Through
                <input
                  type="date"
                  aria-label="Planning to"
                  value={period.to}
                  onChange={(e) => change('to', e.target.value)}
                />
              </label>
            </div>
            <div className="report-filter-row">
              <select
                aria-label="Planning owner"
                value={period.ownerId}
                onChange={(e) => change('ownerId', e.target.value)}
              >
                <option value="">Authorized owners</option>
                {data.people
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <select
                aria-label="Planning department"
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
            </div>
          </section>
          {!view || !cov ? (
            <p className="panel planning-status" role="status">
              {summary.error?.message ?? 'Checking current planning sources…'}
            </p>
          ) : (
            <>
              <div className="metric-grid planning-metrics">
                <Metric
                  label="Unique selected effort"
                  value={hours(cov.uniqueSelectedRemainingHours)}
                  note="Each visible task counted once"
                  icon={<Layers size={16} />}
                />
                <Metric
                  label="Weekly exposure"
                  value={hours(cov.weeklyExposureHours)}
                  note="Counted once per overlapping week"
                  icon={<Gauge size={16} />}
                />
                <Metric
                  label="Peak utilization"
                  value={peak ? `${peak.person.utilization}%` : '—'}
                  note={
                    peak
                      ? `${peak.person.name} · ${weekLabel(peak.week.from, peak.week.to)}`
                      : 'No positive recorded capacity'
                  }
                  danger={!!peak && level(peak.person.utilization) === 'over'}
                  icon={<TriangleAlert size={16} />}
                />
                <button
                  type="button"
                  className={cx('metric-card planning-metric-button', gaps > 0 && 'metric-danger')}
                  onClick={() => {
                    setMoreOpen(true);
                    requestAnimationFrame(() =>
                      coverageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                    );
                  }}
                >
                  <span className="metric-card-label">
                    Coverage gaps <ScanSearch size={16} aria-hidden />
                  </span>
                  <span className="metric-value">{gaps}</span>
                  <p>Undated, invalid, zero-estimate or unowned</p>
                </button>
              </div>
              {compact ? (
                <details
                  className="planning-more"
                  open={moreOpen}
                  onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}
                >
                  <summary>
                    <span>
                      Capacity by person, coverage gaps and advisories
                      {warningList.length > 0 && (
                        <span className="count-badge planning-count">{warningList.length}</span>
                      )}
                    </span>
                    <ChevronDown size={16} aria-hidden className="planning-chevron" />
                  </summary>
                  <div className="planning-more-body">{detail}</div>
                </details>
              ) : (
                detail
              )}
              <details className="planning-method">
                <summary>
                  <CircleHelp size={15} aria-hidden /> How this is calculated
                </summary>
                <div>
                  <p>{view.methodDescription}</p>
                  <ul>
                    <li>
                      Unique selected effort counts each visible task&apos;s remaining estimate
                      once. Weekly exposure counts the full remaining estimate once in every week
                      its interval overlaps, so it can be larger.
                    </li>
                    <li>
                      Partial selected weeks are measured against the whole recorded weekly
                      capacity.
                    </li>
                    <li>
                      Bars mark {NEAR_CAPACITY}% and above as near capacity and above 100% as over
                      capacity. A zero recorded capacity leaves utilization unavailable.
                    </li>
                    <li>Capacity is not attendance or free time.</li>
                    <li>
                      Overlap advisories do not prove simultaneous bookings or daily availability.
                    </li>
                  </ul>
                </div>
              </details>
            </>
          )}
          {view && drill && (
            <Modal
              open
              wide
              title="Inspect planning work"
              description={drillTitle}
              onClose={dismissDrill}
            >
              <section className="planning-drill" aria-label="Current planning drill">
                <h3 className="sr-only">Authorized task drill</h3>
                {tasks.ready ? (
                  (tasks.data?.tasks.length ?? 0) === 0 ? (
                    <p className="planning-empty">No authorized work matches this selection.</p>
                  ) : (
                    <div className="table-scroll">
                      <table className="planning-drill-table">
                        <thead>
                          <tr>
                            <th scope="col">
                              <span className="sr-only">Select for explicit schedule review</span>
                              Review
                            </th>
                            <th scope="col">Task</th>
                            <th scope="col" className="num">
                              Remaining
                            </th>
                            <th scope="col">Due</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tasks.data!.tasks.map((task) => (
                            <tr key={task.id}>
                              <td>
                                <label className="planning-select">
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
                                  <span className="sr-only">
                                    Select {task.title} for explicit schedule review
                                  </span>
                                </label>
                              </td>
                              <td>
                                <button
                                  className="planning-task-link"
                                  onClick={() => {
                                    closeDrill();
                                    onTask(task.id);
                                  }}
                                >
                                  {task.title}
                                </button>
                              </td>
                              <td className="num">{hours(task.remainingHours)}</td>
                              <td>
                                {task.dueDate ? (
                                  dateLabel(task.dueDate)
                                ) : (
                                  <span className="pill pill-slate">
                                    {task.state.replace(/_/g, ' ')}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : (
                  <p className="planning-empty" role="status">
                    {tasks.error?.message ?? 'Checking currently included tasks…'}
                  </p>
                )}
                <div className="planning-drill-footer">
                  <span>
                    {selected.length
                      ? `${selected.length} selected for explicit schedule review`
                      : 'Select work to review its schedule explicitly.'}
                  </span>
                  <button
                    className="button button-primary"
                    disabled={!tasks.ready || !selected.length}
                    onClick={() => setReview(true)}
                  >
                    Review selected schedule
                  </button>
                </div>
                {review && (
                  <section className="planning-review">
                    <StableSchedule
                      seed={seed.ready ? seed.data : undefined}
                      selected={selected}
                      ready={!!view && seed.ready}
                      onBusyChange={setScheduleBusy}
                      onDone={() => {
                        setReview(false);
                        setSelected([]);
                        void summary.retry?.();
                      }}
                    />
                  </section>
                )}
              </section>
            </Modal>
          )}
        </>
      )}
    </section>
  );
}

function peakOf(weeks: PlanningWeek[]) {
  let best: { week: PlanningWeek; person: PlanningPerson } | undefined;
  for (const week of weeks)
    for (const person of week.people)
      if (
        person.utilization !== null &&
        (!best || person.utilization > (best.person.utilization ?? -1))
      )
        best = { week, person };
  return best;
}

function describeDrill(drill: PlanningDrill, people: { id: string; name: string }[]) {
  const parts = [CATEGORY_LABEL[drill.category] ?? 'Planning work'];
  if (drill.personId)
    parts.push(people.find((p) => p.id === drill.personId)?.name ?? 'Selected person');
  if (drill.week) parts.push(`week of ${dateLabel(drill.week)}`);
  return parts.join(' · ');
}

function Metric({
  label,
  value,
  note,
  icon,
  danger,
}: {
  label: string;
  value: string;
  note: string;
  icon: ReactNode;
  danger?: boolean;
}) {
  return (
    <div className={cx('metric-card planning-metric', danger && 'metric-danger')}>
      <span className="metric-card-label">
        {label} <span aria-hidden>{icon}</span>
      </span>
      <span className="metric-value">{value}</span>
      <p title={note}>{note}</p>
    </div>
  );
}

function CoverageRow({
  label,
  count,
  hint,
  drill,
  onInspect,
}: {
  label: string;
  count: number;
  hint?: string;
  drill?: PlanningDrill['category'];
  onInspect?: (d: PlanningDrill) => void;
}) {
  return (
    <div className={cx('planning-coverage-row', count > 0 && 'has-gap')}>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <strong>{count}</strong>
      {drill && onInspect ? (
        <button
          className="text-button"
          aria-label={`Inspect ${drill.replace('_', ' ')}`}
          onClick={() => onInspect({ category: drill })}
        >
          Inspect
        </button>
      ) : (
        <span aria-hidden />
      )}
    </div>
  );
}

function CapacityMatrix({
  weeks,
  onInspect,
}: {
  weeks: PlanningWeek[];
  onInspect: (d: PlanningDrill) => void;
}) {
  const people: { id: string; name: string }[] = [];
  for (const week of weeks)
    for (const p of week.people)
      if (!people.some((x) => x.id === p.id)) people.push({ id: p.id, name: p.name });
  const anyPartial = weeks.some((w) => w.partial);
  return (
    <section className="panel planning-capacity">
      <div className="section-header">
        <div>
          <h3>Weekly capacity by person</h3>
          <p>
            Visible remaining effort against recorded weekly capacity. Select a cell to inspect.
          </p>
        </div>
        <ul className="planning-legend" aria-label="Utilization thresholds">
          <li>
            <i className="lvl-ok" /> Under {NEAR_CAPACITY}%
          </li>
          <li>
            <i className="lvl-near" /> {NEAR_CAPACITY}–100%
          </li>
          <li>
            <i className="lvl-over" /> Over 100%
          </li>
        </ul>
      </div>
      {weeks.length === 0 ? (
        <p className="planning-empty">No weeks in the selected range.</p>
      ) : (
        <div className="table-scroll planning-matrix-scroll">
          <table className="planning-matrix">
            <thead>
              <tr>
                <th scope="col" className="planning-person-col">
                  Person
                </th>
                {weeks.map((week) => {
                  const label = weekLabel(week.from, week.to);
                  return (
                    <th scope="col" key={week.from}>
                      <div className="planning-week-head">
                        <span>
                          {label}
                          {week.partial && (
                            <span
                              className="pill pill-slate planning-partial"
                              title="Partial selected week uses whole recorded weekly capacity."
                            >
                              Partial
                            </span>
                          )}
                        </span>
                        <button
                          className="icon-button"
                          aria-label={`Inspect week ${label}`}
                          title="Inspect week"
                          onClick={() => onInspect(week.drill)}
                        >
                          <ScanSearch size={14} />
                        </button>
                      </div>
                      <small>{hours(week.remainingHours)} visible remaining</small>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {people.length === 0 && (
                <tr>
                  <td colSpan={weeks.length + 1} className="planning-empty">
                    No scheduled authorized work in this range.
                  </td>
                </tr>
              )}
              {people.map((person) => (
                <tr key={person.id}>
                  <th scope="row" className="planning-person-col">
                    {person.name}
                  </th>
                  {weeks.map((week) => {
                    const p = week.people.find((x) => x.id === person.id);
                    return (
                      <td key={week.from}>
                        {p ? (
                          <CapacityCell
                            person={p}
                            week={weekLabel(week.from, week.to)}
                            onInspect={() => onInspect(p.drill)}
                          />
                        ) : (
                          <span className="planning-cell-empty">
                            <span aria-hidden>—</span>
                            <span className="sr-only">Not listed this week</span>
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {anyPartial && (
        <p className="planning-footnote">
          Partial selected weeks use the whole recorded weekly capacity.
        </p>
      )}
    </section>
  );
}

function CapacityCell({
  person: p,
  week,
  onInspect,
}: {
  person: PlanningPerson;
  week: string;
  onInspect: () => void;
}) {
  const lvl = level(p.utilization);
  const unavailable = p.capacityState === 'recorded_zero' ? 'Recorded zero' : 'Invalid capacity';
  const valueText =
    p.utilization === null
      ? `${unavailable}, utilization unavailable`
      : `${p.utilization}% utilization`;
  return (
    <button
      className={cx('planning-cell', `lvl-${lvl}`)}
      onClick={onInspect}
      aria-label={`Inspect work for ${p.name}, week ${week}: ${hours(p.remainingHours)} visible remaining of ${hours(p.recordedCapacity)} recorded capacity, ${valueText}`}
    >
      <span className="planning-cell-top">
        {p.utilization === null ? (
          <span className="planning-cell-na">
            <span>{unavailable}</span>
            <small>utilization unavailable</small>
          </span>
        ) : (
          <strong>
            {lvl === 'over' && <TriangleAlert size={12} aria-hidden />}
            {p.utilization}%
          </strong>
        )}
        <small>
          {p.remainingHours} / {hours(p.recordedCapacity)}
        </small>
      </span>
      <span className="planning-bar" aria-hidden>
        <span style={{ width: `${Math.min(100, Math.max(0, p.utilization ?? 0))}%` }} />
      </span>
    </button>
  );
}

function Advisories({
  ready,
  error,
  warnings,
  onInspect,
}: {
  ready: boolean;
  error?: string;
  warnings: PlanningWarning[];
  onInspect: (d: PlanningDrill) => void;
}) {
  const groups: { description: string; items: PlanningWarning[] }[] = [];
  for (const warning of warnings) {
    const g = groups.find((x) => x.description === warning.description);
    if (g) g.items.push(warning);
    else groups.push({ description: warning.description, items: [warning] });
  }
  return (
    <section className="panel planning-advisories">
      <div className="section-header">
        <div>
          <h3>Planning advisories</h3>
          <p>
            {ready
              ? `${warnings.length} advisor${warnings.length === 1 ? 'y' : 'ies'} in ${groups.length} group${groups.length === 1 ? '' : 's'}. Advisory only.`
              : 'Advisory only.'}
          </p>
        </div>
      </div>
      {!ready ? (
        <p className="planning-empty" role="status">
          {error ?? 'Checking current planning advisories…'}
        </p>
      ) : groups.length === 0 ? (
        <p className="planning-empty">No advisories for this selection.</p>
      ) : (
        groups.map((group) => (
          <details className="planning-advisory" key={group.description}>
            <summary>
              <TriangleAlert size={15} aria-hidden />
              <span className="planning-advisory-text">{group.description}</span>
              <span
                className="count-badge planning-count"
                aria-label={`${group.items.length} affected`}
              >
                {group.items.length}
              </span>
              <ChevronDown size={15} aria-hidden className="planning-chevron" />
            </summary>
            <ul>
              {group.items.map((warning, i) => {
                const label =
                  [warning.title, warning.week ? `week of ${dateLabel(warning.week)}` : '']
                    .filter(Boolean)
                    .join(' · ') || `Affected work ${i + 1}`;
                return (
                  <li key={i}>
                    <span>{label}</span>
                    <button
                      className="text-button"
                      aria-label={`Inspect warning work: ${label}`}
                      onClick={() => onInspect(warning.drill)}
                    >
                      Inspect
                    </button>
                  </li>
                );
              })}
            </ul>
          </details>
        ))
      )}
    </section>
  );
}

function StableSchedule({
  seed,
  selected,
  ready,
  onDone,
  onBusyChange,
}: {
  seed?: { tasks: Task[]; context: ScheduleContext };
  selected: string[];
  ready: boolean;
  onDone: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [base, setBase] = useState(seed);
  if (seed && !base) setBase(seed);
  return base ? (
    <ScheduleReview
      tasks={ready && seed ? seed.tasks : base.tasks.map((t) => ({ ...t, title: '' }))}
      context={base.context}
      ready={ready}
      onDone={onDone}
      onBusyChange={onBusyChange}
    />
  ) : (
    <p role="status">Checking current selected task and prerequisite versions…</p>
  );
}
