import IntelligenceLauncher from '../components/IntelligenceLauncher';
import MeasuredGoals from '../components/MeasuredGoals';
import { useEffect, useState } from 'react';
import HistoricalReports from '../components/HistoricalReports';
import SavedReports from '../components/SavedReports';
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
import type { Goal } from '../types';
import { buildTaskReport, reportDeadlineMet } from '../data/reports';
import { useTaskReport } from '../data/useTaskReport';
import { exportTasksCSV } from '../data/imports';
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
  Modal,
  percent,
  personName,
  ProgressBar,
  today,
} from '../components/UI';
import { TaskTable } from './Tasks';

export function GoalsPage({ onTask }: { onTask: (id: string) => void }) {
  return <MeasuredGoals onTask={onTask} />;
}

function CurrentReportsPage({ onTask }: { onTask: (id: string) => void }) {
  const { data: workspace, notify, mode } = useWorkspace();
  const data = workspace!;
  const date = today(data.company.timezone);
  const [from, setFrom] = useState(date.slice(0, 7) + '-01');
  const [to, setTo] = useState(date);
  const [department, setDepartment] = useState('');
  const [owner, setOwner] = useState('');
  const [tab, setTab] = useState('commitments');
  const [project, setProject] = useState('');
  const filters = { from, to, departmentId: department, ownerId: owner, projectId: project };
  const input = useTaskReport(data, mode, filters, tab);
  const report = buildTaskReport(
    input.tasks,
    filters,
    data.company.timezone,
    input.generatedAt ? new Date(input.generatedAt) : new Date(),
  );
  const {
    valid,
    cohort,
    accepted,
    originals,
    ontime,
    currents,
    currentOnTime,
    done,
    changed,
    overdue,
    blocked,
    pending,
  } = report;
  const counts = input.summary ?? {
    cohort: cohort.length,
    accepted: accepted.length,
    originals: originals.length,
    ontime: ontime.length,
    currents: currents.length,
    currentOnTime: currentOnTime.length,
    done: done.length,
    overdue: overdue.length,
    blocked: blocked.length,
    pending: pending.length,
    changed: changed.length,
    needsAttention: 0,
  };
  const buckets = input.summary?.buckets ?? report.buckets;
  const overdueIDs = new Set(overdue.map((t) => t.id));
  const needsAttention = cohort.filter(
    (t) => overdueIDs.has(t.id) || t.status === 'blocked' || t.status === 'in_review',
  );
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const tableTasks =
    mode === 'api'
      ? input.tasks
      : tab === 'accepted'
        ? accepted
        : tab === 'exceptions'
          ? needsAttention
          : cohort;
  const attentionCount = input.summary?.needsAttention ?? needsAttention.length;
  return (
    <div className="page-content">
      <IntelligenceLauncher
        operation="report_explanation"
        sourceRead={{
          ready: input.available && !!input.snapshot && !input.checking,
          denied: input.denied,
        }}
        choices={
          input.available && input.snapshot && !input.checking
            ? [
                {
                  label: 'Selected current report facts',
                  source: {
                    kind: 'report_current',
                    id: input.snapshot,
                    selectedFieldSet: 'metrics',
                  },
                },
              ]
            : []
        }
      />
      <p className="field-help">
        Current-state report · {data.company.timezone} · later task changes can change these
        figures.
      </p>
      {input.loading && <p role="status">Loading authorized report…</p>}
      {input.error && (
        <div className="inline-error" role="alert">
          {input.error}{' '}
          <button className="button button-secondary" onClick={input.retry}>
            Retry report
          </button>
        </div>
      )}
      <section className="report-controls panel" aria-busy={input.loading}>
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
          <div className="report-presets" role="group" aria-label="Report date presets">
            <button
              className="button button-secondary"
              onClick={() => {
                setFrom(date.slice(0, 7) + '-01');
                setTo(date);
              }}
            >
              This month
            </button>
            <button
              className="button button-secondary"
              onClick={() => {
                setFrom(addDays(date, -6));
                setTo(date);
              }}
            >
              Last 7 days
            </button>
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
          <select
            aria-label="Report project"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            <option value="">All projects</option>
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            className="button button-dark"
            disabled={!valid || !input.available}
            onClick={() => {
              if (mode === 'demo') {
                downloadText(
                  `schach-report-${from}-to-${to}.csv`,
                  exportTasksCSV(tableTasks, data),
                );
                notify(`Exported ${tableTasks.length} tasks from the selected report tab.`);
                return;
              }
              void input
                .exportCSV()
                .then((blob) => {
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `schach-report-${from}-to-${to}.csv`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                  notify('Report exported.');
                })
                .catch((error) => notify(error.message));
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
          <strong>{counts.accepted}</strong>
          <p>Completion date within range</p>
        </div>
        <div className="panel">
          <span>Original commitment met</span>
          <strong>{counts.originals ? `${percent(counts.ontime, counts.originals)}%` : '—'}</strong>
          <p>
            {counts.ontime} of {counts.originals} with an original deadline
          </p>
        </div>
        <div className="panel">
          <span>Current deadline met</span>
          <strong>
            {counts.currents ? `${percent(counts.currentOnTime, counts.currents)}%` : '—'}
          </strong>
          <p>
            {counts.currentOnTime} of {counts.currents} with a current deadline
          </p>
        </div>
        <div className="panel">
          <span>Commitment completion</span>
          <strong>{counts.cohort ? `${percent(counts.done, counts.cohort)}%` : '—'}</strong>
          <p>
            {counts.done} accepted / {counts.cohort} tasks due in range
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
          {valid && counts.accepted === 0 && (
            <p className="chart-empty-note">No work was accepted in this period.</p>
          )}
          {buckets.length > 0 ? (
            <div
              className="report-chart"
              role="img"
              aria-label={`${counts.accepted} tasks accepted from ${from} through ${to}`}
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
            { label: 'Currently overdue', count: counts.overdue, color: 'red' },
            { label: 'Blocked', count: counts.blocked, color: 'orange' },
            { label: 'Awaiting review', count: counts.pending, color: 'purple' },
            { label: 'Deadline changed', count: counts.changed, color: 'slate' },
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
                  const dated = done.filter(
                    (t) => reportDeadlineMet(t, data.company.timezone, true) !== null,
                  );
                  const onTime = dated.filter((t) =>
                    reportDeadlineMet(t, data.company.timezone, true),
                  );
                  const summary = input.summary?.departments[d.id];
                  const totals = summary ?? {
                    cohort: due.length,
                    accepted: done.length,
                    originals: dated.length,
                    ontime: onTime.length,
                    overdue: due.filter((t) => overdueIDs.has(t.id)).length,
                  };
                  return (
                    <tr key={d.id}>
                      <td>
                        <strong>{d.name}</strong>
                      </td>
                      <td>{totals.cohort}</td>
                      <td>{totals.accepted}</td>
                      <td>
                        {totals.originals
                          ? `${percent(totals.ontime, totals.originals)}% (${totals.ontime}/${totals.originals})`
                          : 'No data'}
                      </td>
                      <td>{totals.overdue}</td>
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
            { id: 'commitments', name: 'Due in period', count: counts.cohort },
            { id: 'accepted', name: 'Accepted in period', count: counts.accepted },
            {
              id: 'exceptions',
              name: 'Needs attention',
              count: attentionCount,
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
        {input.rowsLoading && <p role="status">Loading report rows…</p>}
        <TaskTable tasks={tableTasks} data={data} onTask={onTask} compact />
        {input.hasMore && (
          <button
            className="button button-secondary"
            disabled={input.loadingMore}
            onClick={input.loadMore}
          >
            Load more report rows
          </button>
        )}
      </section>
      <div className="method-note">
        <CircleHelp size={18} />
        <div>
          <h3>Read the denominators</h3>
          <p>
            Acceptance metrics use completion dates in the selected period. On-time rates include
            only accepted tasks with the relevant deadline. Commitment completion uses non-cancelled
            tasks whose current deadline falls in the period. Timed deadlines compare exact
            instants; all-day deadlines use company calendar dates. Overdue is evaluated at report
            refresh. This is current state, not a historical snapshot. No data is shown as a dash;
            an empty group never becomes 100%.
          </p>
        </div>
      </div>
    </div>
  );
}

export function ReportsPage({ onTask }: { onTask: (id: string) => void }) {
  const store = useWorkspace();
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const direct = hash.startsWith('#report?');
  const params = new URLSearchParams(hash.split('?')[1] ?? '');
  const [basis, setBasis] = useState(direct ? 'history' : 'current');
  useEffect(() => {
    if (hash.startsWith('#report?')) setBasis('history');
  }, [hash]);
  if (direct && params.get('company') !== store.companyId)
    return <p className="panel">Switch to the report company before opening this report.</p>;
  return (
    <div>
      <div className="tabs" role="group" aria-label="Report basis">
        <button className="button button-secondary" onClick={() => setBasis('current')}>
          Current state
        </button>
        <button className="button button-secondary" onClick={() => setBasis('history')}>
          Historical reports
        </button>
        <button className="button button-secondary" onClick={() => setBasis('saved')}>
          Saved reports
        </button>
      </div>
      {basis === 'current' ? (
        <CurrentReportsPage onTask={onTask} />
      ) : basis === 'history' ? (
        <HistoricalReports
          key={direct ? hash : 'manual'}
          onTask={onTask}
          initialJob={direct ? (params.get('job') ?? '') : ''}
          initialSnapshot={direct ? (params.get('snapshot') ?? '') : ''}
        />
      ) : (
        <SavedReports
          onOpen={(id) => {
            window.location.hash = `#report?company=${encodeURIComponent(store.companyId)}&snapshot=${encodeURIComponent(id)}`;
            setBasis('history');
          }}
        />
      )}
    </div>
  );
}
