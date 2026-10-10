import { useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  CalendarDays,
  CheckCheck,
  CircleHelp,
  Flag,
  Pencil,
  Plus,
  Target,
  TrendingUp,
} from 'lucide-react';
import { useWorkspace } from '../store';
import type { Goal, Task } from '../types';
import { exportTasksCSV, validDate } from '../data/imports';
import EntityForm from '../components/EntityForm';
import {
  addDays,
  Avatar,
  canManage,
  dateLabel,
  departmentName,
  downloadText,
  EmptyState,
  goalPercent,
  isOpen,
  isOverdue,
  Modal,
  percent,
  personName,
  ProgressBar,
  today,
} from '../components/UI';
import { TaskTable } from './Tasks';

export function GoalsPage({ onTask }: { onTask: (id: string) => void }) {
  const { data: workspace } = useWorkspace();
  const data = workspace!;
  const [department, setDepartment] = useState('');
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const [linked, setLinked] = useState<Goal | null>(null);
  const shown = data.goals.filter((g) => !department || g.departmentId === department);
  return (
    <div className="page-content">
      <div className="goals-intro">
        <div className="goals-intro-icon">
          <Target size={28} />
        </div>
        <div>
          <span className="eyebrow">THE RESULTS THAT MATTER</span>
          <h2>Connect the work to the why.</h2>
          <p>Track outcomes with clear baselines, measurable targets and accountable owners.</p>
        </div>
      </div>
      <div className="task-toolbar">
        <span className="muted">
          <strong>{shown.length}</strong> company goals
        </span>
        <div className="toolbar-actions">
          <select
            aria-label="Filter goals by department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="">All departments</option>
            {data.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {canManage(data) && (
            <button className="button button-primary" onClick={() => setEditing('new')}>
              <Plus size={15} />
              New goal
            </button>
          )}
        </div>
      </div>
      <div className="goal-grid">
        {shown.map((g) => {
          const progress = goalPercent(g.baseline, g.current, g.target);
          return (
            <section className="goal-card panel" key={g.id}>
              <div className="goal-card-top">
                <span className="pill pill-slate">{departmentName(data, g.departmentId)}</span>
                {canManage(data) && (
                  <button
                    className="icon-button"
                    aria-label={`Edit ${g.name}`}
                    onClick={() => setEditing(g)}
                  >
                    <Pencil size={15} />
                  </button>
                )}
              </div>
              <h2>{g.name}</h2>
              <p>{g.description}</p>
              <div className="goal-outcome">
                <div>
                  <strong>
                    {g.current.toLocaleString()}
                    <span>{g.unit}</span>
                  </strong>
                  <small>Current result</small>
                </div>
                <div>
                  <strong>
                    {g.target.toLocaleString()}
                    <span>{g.unit}</span>
                  </strong>
                  <small>Target</small>
                </div>
                <span className={progress >= 100 ? 'pill pill-green' : 'pill pill-orange'}>
                  {progress}%
                </span>
              </div>
              <ProgressBar
                value={progress}
                color={progress >= 100 ? 'green' : 'orange'}
                label={`${g.name} attainment`}
              />
              <div className="goal-baseline">
                <span>
                  Baseline: {g.baseline.toLocaleString()} {g.unit}
                </span>
                <span>{g.target < g.baseline ? 'Lower is better' : 'Higher is better'}</span>
              </div>
              <div className="goal-owner">
                <span>
                  <Avatar person={data.people.find((p) => p.id === g.ownerId)} size="xs" />
                  {personName(data, g.ownerId)}
                </span>
                <span>
                  <CalendarDays size={13} />
                  {dateLabel(g.dueDate)}
                </span>
              </div>
              <div className="goal-footer">
                <button className="text-button" onClick={() => setLinked(g)}>
                  {g.taskIds.length} linked tasks
                  <ArrowRight size={14} />
                </button>
                {canManage(data) && (
                  <button
                    className="button button-secondary button-small"
                    onClick={() => setEditing(g)}
                  >
                    Update result
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {shown.length === 0 && (
        <EmptyState
          icon={<Target size={28} />}
          title="Give progress a destination"
          description="Add a measurable goal and connect the tasks that contribute to it."
        />
      )}
      <div className="method-note">
        <CircleHelp size={18} />
        <div>
          <h3>Transparent progress</h3>
          <p>
            Attainment = (current − baseline) ÷ (target − baseline), bounded from 0–100% in the
            display. Underlying values remain visible. Completing linked tasks does not
            automatically change a business outcome.
          </p>
        </div>
      </div>
      {editing && (
        <EntityForm
          kind="goal"
          item={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {linked && (
        <Modal
          open
          onClose={() => setLinked(null)}
          title="Work behind the goal"
          description={linked.name}
          wide
        >
          <TaskTable
            tasks={data.tasks.filter((t) => linked.taskIds.includes(t.id))}
            data={data}
            onTask={(id) => {
              setLinked(null);
              onTask(id);
            }}
            compact
          />
        </Modal>
      )}
    </div>
  );
}

function completionDate(task: Task, zone: string) {
  return task.completedAt
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(task.completedAt))
    : '';
}
export function ReportsPage({ onTask }: { onTask: (id: string) => void }) {
  const { data: workspace, notify } = useWorkspace();
  const data = workspace!;
  const date = today(data.company.timezone);
  const [from, setFrom] = useState(date.slice(0, 7) + '-01');
  const [to, setTo] = useState(date);
  const [department, setDepartment] = useState('');
  const [owner, setOwner] = useState('');
  const [tab, setTab] = useState('commitments');
  const valid = validDate(from) && validDate(to) && from <= to;
  const filtered = data.tasks.filter(
    (t) => (!department || t.departmentId === department) && (!owner || t.ownerId === owner),
  );
  const cohort = valid
    ? filtered.filter(
        (t) => t.dueDate && t.dueDate >= from && t.dueDate <= to && t.status !== 'cancelled',
      )
    : [];
  const accepted = valid
    ? filtered.filter(
        (t) =>
          t.status === 'done' &&
          completionDate(t, data.company.timezone) >= from &&
          completionDate(t, data.company.timezone) <= to,
      )
    : [];
  const originals = accepted.filter((t) => t.originalDueDate);
  const ontime = originals.filter(
    (t) => completionDate(t, data.company.timezone) <= t.originalDueDate,
  );
  const currents = accepted.filter((t) => t.dueDate);
  const currentOnTime = currents.filter(
    (t) => completionDate(t, data.company.timezone) <= t.dueDate,
  );
  const done = cohort.filter((t) => t.status === 'done');
  const changed = cohort.filter((t) => t.originalDueDate && t.originalDueDate !== t.dueDate);
  const overdue = cohort.filter((t) => isOverdue(t, date));
  const blocked = cohort.filter((t) => t.status === 'blocked');
  const pending = cohort.filter((t) => t.status === 'in_review');
  const days = valid
    ? Math.floor(
        (new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) /
          86400000,
      ) + 1
    : 0;
  const bucketSize = Math.max(1, Math.ceil(days / 12));
  const buckets = Array.from({ length: Math.ceil(days / bucketSize) }, (_, i) => {
    const start = addDays(from, i * bucketSize);
    const end = addDays(from, Math.min(days - 1, (i + 1) * bucketSize - 1));
    return {
      start,
      end,
      count: accepted.filter(
        (t) =>
          completionDate(t, data.company.timezone) >= start &&
          completionDate(t, data.company.timezone) <= end,
      ).length,
    };
  });
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const tableTasks =
    tab === 'accepted'
      ? accepted
      : tab === 'exceptions'
        ? cohort.filter(
            (t) => isOverdue(t, date) || t.status === 'blocked' || t.status === 'in_review',
          )
        : cohort;
  return (
    <div className="page-content">
      <section className="report-controls panel">
        <div className="report-dates">
          <label>
            From
            <input
              type="date"
              aria-label="Report start date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <span>—</span>
          <label>
            Through
            <input
              type="date"
              aria-label="Report end date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button
            className="button button-secondary"
            onClick={() => {
              setFrom(addDays(date, -29));
              setTo(date);
            }}
          >
            Last 30 days
          </button>
        </div>
        <div className="report-filter-row">
          <select
            aria-label="Report department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="">All departments</option>
            {data.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Report person"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          >
            <option value="">All people</option>
            {data.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            className="button button-dark"
            disabled={!valid}
            onClick={() => {
              downloadText(`schach-report-${from}-to-${to}.csv`, exportTasksCSV(tableTasks, data));
              notify(`Exported ${tableTasks.length} tasks from the selected report tab.`);
            }}
          >
            <ArrowDownToLine size={15} />
            Export report
          </button>
        </div>
        {!valid && (
          <div className="inline-error" role="alert">
            Choose a valid start and end date.
          </div>
        )}
      </section>
      <div className="report-metrics">
        <div className="panel">
          <span>Tasks accepted in period</span>
          <strong>{accepted.length}</strong>
          <p>Completion date within range</p>
        </div>
        <div className="panel">
          <span>Original commitment met</span>
          <strong>{originals.length ? `${percent(ontime.length, originals.length)}%` : '—'}</strong>
          <p>
            {ontime.length} of {originals.length} with an original deadline
          </p>
        </div>
        <div className="panel">
          <span>Current deadline met</span>
          <strong>
            {currents.length ? `${percent(currentOnTime.length, currents.length)}%` : '—'}
          </strong>
          <p>
            {currentOnTime.length} of {currents.length} with a current deadline
          </p>
        </div>
        <div className="panel">
          <span>Commitment completion</span>
          <strong>{cohort.length ? `${percent(done.length, cohort.length)}%` : '—'}</strong>
          <p>
            {done.length} accepted / {cohort.length} tasks due in range
          </p>
        </div>
      </div>
      <div className="report-chart-grid">
        <section className="panel">
          <div className="section-header">
            <div>
              <h2>Accepted work over time</h2>
              <p>Actual completion dates · {data.company.timezone}</p>
            </div>
            <TrendingUp size={19} />
          </div>
          {valid && accepted.length === 0 && (
            <p className="chart-empty-note">No work was accepted in this period.</p>
          )}
          {buckets.length > 0 ? (
            <div
              className="report-chart"
              role="img"
              aria-label={`${accepted.length} tasks accepted from ${from} through ${to}`}
            >
              {buckets.map((b) => (
                <div className="report-chart-column" key={b.start}>
                  <div className="report-chart-bar-area">
                    <span>{b.count}</span>
                    <div
                      className="report-chart-bar"
                      style={{ height: `${(b.count / max) * 100}%` }}
                    />
                  </div>
                  <small>{dateLabel(b.start)}</small>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Select a reporting period"
              description="The chart will show accepted work in that period."
            />
          )}
        </section>
        <section className="panel report-exceptions">
          <div className="section-header">
            <div>
              <h2>Commitments at a glance</h2>
              <p>Current state of tasks due in the period</p>
            </div>
          </div>
          {[
            { label: 'Currently overdue', count: overdue.length, color: 'red' },
            { label: 'Blocked', count: blocked.length, color: 'orange' },
            { label: 'Awaiting review', count: pending.length, color: 'purple' },
            { label: 'Deadline changed', count: changed.length, color: 'slate' },
          ].map((r) => (
            <div key={r.label}>
              <span>
                <i className={`legend-dot ${r.color}`} />
                {r.label}
              </span>
              <strong>{r.count}</strong>
            </div>
          ))}
          <p className="field-help">
            Categories can overlap. Deadline changes retain the original commitment and recorded
            reason.
          </p>
        </section>
      </div>
      <section className="panel report-departments">
        <div className="section-header">
          <div>
            <h2>Department delivery</h2>
            <p>
              Use the counts as a starting point for a conversation, with context from the work.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Department</th>
                <th>Due in period</th>
                <th>Accepted in period</th>
                <th>Original deadline met</th>
                <th>Overdue now</th>
              </tr>
            </thead>
            <tbody>
              {data.departments
                .filter((d) => !department || d.id === department)
                .map((d) => {
                  const due = cohort.filter((t) => t.departmentId === d.id);
                  const done = accepted.filter((t) => t.departmentId === d.id);
                  const dated = done.filter((t) => t.originalDueDate);
                  const onTime = dated.filter(
                    (t) => completionDate(t, data.company.timezone) <= t.originalDueDate,
                  );
                  return (
                    <tr key={d.id}>
                      <td>
                        <strong>{d.name}</strong>
                      </td>
                      <td>{due.length}</td>
                      <td>{done.length}</td>
                      <td>
                        {dated.length
                          ? `${percent(onTime.length, dated.length)}% (${onTime.length}/${dated.length})`
                          : 'No data'}
                      </td>
                      <td>{due.filter((t) => isOverdue(t, date)).length}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="attention-tabs" role="group" aria-label="Report task cohort">
          {[
            { id: 'commitments', name: 'Due in period', count: cohort.length },
            { id: 'accepted', name: 'Accepted in period', count: accepted.length },
            {
              id: 'exceptions',
              name: 'Needs attention',
              count: cohort.filter(
                (t) => isOverdue(t, date) || t.status === 'blocked' || t.status === 'in_review',
              ).length,
            },
          ].map((t) => (
            <button
              key={t.id}
              aria-pressed={tab === t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.name}
              <span>{t.count}</span>
            </button>
          ))}
        </div>
        <TaskTable tasks={tableTasks} data={data} onTask={onTask} compact />
      </section>
      <div className="method-note">
        <CircleHelp size={18} />
        <div>
          <h3>Read the denominators</h3>
          <p>
            Acceptance metrics use completion dates in the selected period. On-time rates include
            only accepted tasks with the relevant deadline. Commitment completion uses non-cancelled
            tasks whose current deadline falls in the period. Overdue is evaluated today in the
            company timezone. No data is shown as a dash; an empty group never becomes 100%.
          </p>
        </div>
      </div>
    </div>
  );
}
