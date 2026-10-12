import AttentionInbox from '../components/AttentionInbox';
import { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  Wallet,
  Check,
  Plus,
  CircleAlert,
  Clock3,
  Layers3,
  ShieldCheck,
  Target,
  TriangleAlert,
} from 'lucide-react';
import { useWorkspace } from '../store';
import type { TaskFilters, View } from '../types';
import {
  addDays,
  Avatar,
  canAdmin,
  dateLabel,
  departmentName,
  EmptyState,
  isOpen,
  isOverdue,
  LinkButton,
  percent,
  personName,
  ProgressBar,
  relativeTime,
  SectionHeader,
  today,
} from '../components/UI';
import { TaskTable } from './Tasks';
import { financeSummary, fiscalYearStart, fiscalYearRange, formatMoney } from '../data/finance';

// Company-level activity (no task) is routed to the view that owns its record.
// Actions without a meaningful destination render as plain, non-interactive rows.
const activityTargets: Array<[RegExp, View]> = [
  [/^project_/, 'projects'],
  [/^goal_/, 'goals'],
  [/^tasks_imported$/, 'tasks'],
  [/^(expense|budget|finance)_/, 'finance'],
  [/^notifications_/, 'inbox'],
  [/^(company_updated|automations_run|password_changed)$/, 'settings'],
  [
    /^(person_|department_|people_|onboarding_|access_review_|company_departure_|membership_)/,
    'people',
  ],
];
export function activityTarget(action: string): View | null {
  return activityTargets.find(([pattern]) => pattern.test(action))?.[1] ?? null;
}

export default function Overview({
  onTask,
  onExpense,
  onNavigate,
  onProject,
}: {
  onTask: (id: string) => void;
  onExpense?: (id: string) => void;
  onNavigate: (view: View, filters?: Partial<TaskFilters>) => void;
  onProject: (id: string) => void;
}) {
  const { data: workspace } = useWorkspace();
  const data = workspace!;
  const date = today(data.company.timezone);
  const overdue = data.tasks.filter((t) => isOverdue(t, date));
  const blocked = data.tasks.filter((t) => t.status === 'blocked');
  const review = data.tasks.filter((t) => t.status === 'in_review');
  const soon = data.tasks.filter(
    (t) => isOpen(t) && !!t.dueDate && t.dueDate >= date && t.dueDate <= addDays(date, 7),
  );
  const completed = data.tasks.filter(
    (t) => t.status === 'done' && t.completedAt && t.originalDueDate,
  );
  const ontime = completed.filter(
    (t) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: data.company.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(t.completedAt)) <= t.originalDueDate,
  );
  const [focus, setFocus] = useState('overdue');
  const focusRows =
    focus === 'overdue'
      ? overdue
      : focus === 'blocked'
        ? blocked
        : focus === 'review'
          ? review
          : soon;
  const days = Array.from({ length: 7 }, (_, i) => addDays(date, i - 6));
  const completedDays = days.map(
    (day) =>
      data.tasks.filter(
        (t) =>
          t.status === 'done' &&
          t.completedAt &&
          todayOf(t.completedAt, data.company.timezone) === day,
      ).length,
  );
  const dailyMax = Math.max(2, ...completedDays);
  const totalAccepted = completedDays.reduce((a, b) => a + b, 0);
  const attentionCount = data.tasks.filter(
    (t) => isOverdue(t, date) || ['blocked', 'in_review'].includes(t.status),
  ).length;
  const activeProjects = data.projects.filter((p) => p.status === 'active');
  const cards = [
    {
      title: 'Open commitments',
      value: data.tasks.filter(isOpen).length,
      icon: Layers3,
      className: 'neutral',
      detail: `Across ${activeProjects.length} active projects`,
      action: () => onNavigate('tasks', { status: 'open' }),
    },
    {
      title: 'Overdue tasks',
      value: overdue.length,
      icon: TriangleAlert,
      className: 'danger',
      detail: overdue.length
        ? `${new Set(overdue.map((t) => t.ownerId)).size} owners need your attention`
        : 'All current deadlines are clear',
      action: () => onNavigate('tasks', { due: 'overdue' }),
    },
    {
      title: 'Awaiting review',
      value: review.length,
      icon: ShieldCheck,
      className: 'purple',
      detail: review.length ? 'Ready for a decision' : 'No pending decisions',
      action: () => onNavigate('tasks', { status: 'in_review' }),
    },
    {
      title: 'On-time acceptance',
      value: completed.length ? `${percent(ontime.length, completed.length)}%` : '—',
      icon: CheckCheck,
      className: 'green',
      detail: `${ontime.length} of ${completed.length} accepted · original deadline`,
      action: () => onNavigate('reports'),
    },
  ];
  const financialYear = fiscalYearRange(
    fiscalYearStart(date, data.company.fiscalYearStartMonth),
    data.company.fiscalYearStartMonth,
  );
  const finance = financeSummary(data, financialYear.startDate, financialYear.endDate);
  const setup = [
    { label: 'Create departments', done: data.departments.length > 0, view: 'people' as View },
    {
      label: 'Add people and reporting lines',
      done: data.people.filter((p) => p.active).length > 1,
      view: 'people' as View,
    },
    { label: 'Assign the first task', done: data.tasks.length > 0, view: 'tasks' as View },
    {
      label: 'Set department budgets',
      done: data.budgets.some((b) => b.status === 'active'),
      view: 'finance' as View,
    },
  ];
  return (
    <div className="page-content overview-page">
      <div className="overview-context">
        <div className="live-label">
          <span />
          {['founder', 'ceo', 'admin', 'viewer'].includes(data.me.role)
            ? 'Company overview'
            : data.me.role === 'head'
              ? 'Department overview'
              : 'Your work overview'}
        </div>
        <span>
          {dateLabel(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </span>
      </div>
      {canAdmin(data) && setup.some((item) => !item.done) && (
        <section className="panel workspace-setup" aria-label="Company setup">
          <div>
            <span className="eyebrow">YOUR COMPANY ENVIRONMENT</span>
            <h2>Put the foundations in place.</h2>
            <p>
              {setup.filter((item) => item.done).length} of {setup.length} setup steps complete.
              Start with your departments and people.
            </p>
          </div>
          <div className="setup-actions">
            {setup.map((item) => (
              <button
                key={item.label}
                className={item.done ? 'setup-step completed' : 'setup-step'}
                onClick={() => onNavigate(item.view)}
              >
                {item.done ? <Check size={17} /> : <Plus size={17} />}
                <span>{item.label}</span>
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="metric-grid">
        {cards.map((c) => (
          <button className={`metric-card metric-${c.className}`} key={c.title} onClick={c.action}>
            <div className="metric-card-label">
              <span>{c.title}</span>
              <c.icon size={17} />
            </div>
            <div className="metric-value">
              {c.value}
              <ArrowUpRight size={20} />
            </div>
            <p>{c.detail}</p>
          </button>
        ))}
      </div>
      {['company', 'department'].includes(data.financeScope) && (
        <section className="panel finance-overview-strip" aria-label="Financial overview">
          <div className="finance-overview-title">
            <Wallet size={20} />
            <div>
              <strong>Financial overview</strong>
              <span>
                {dateLabel(financialYear.startDate)} – {dateLabel(financialYear.endDate)}
              </span>
            </div>
          </div>
          <div>
            <span>Budget allocated</span>
            <strong>{formatMoney(finance.allocatedMinor, data.company.currency)}</strong>
          </div>
          <div>
            <span>Used · approved + paid</span>
            <strong>{formatMoney(finance.usedMinor, data.company.currency)}</strong>
          </div>
          <div>
            <span>Awaiting approval</span>
            <strong>{formatMoney(finance.pendingMinor, data.company.currency)}</strong>
          </div>
          <button className="text-button" onClick={() => onNavigate('finance')}>
            Open finance <ArrowRight size={15} />
          </button>
        </section>
      )}
      <AttentionInbox
        key={data.company.id + ':' + data.me.id}
        decisionsOnly
        onTask={onTask}
        onExpense={onExpense ?? (() => onNavigate('finance'))}
      />
      <div className="overview-main-grid">
        <section className="panel attention-panel">
          <SectionHeader
            title="Needs your attention"
            subtitle={`${attentionCount} distinct tasks need a decision, support or a new plan.`}
            action={
              <LinkButton
                onClick={() =>
                  onNavigate(
                    'tasks',
                    focus === 'overdue'
                      ? { due: 'overdue' }
                      : focus === 'soon'
                        ? { due: 'soon' }
                        : { status: focus === 'review' ? 'in_review' : 'blocked' },
                  )
                }
              >
                View all
              </LinkButton>
            }
          />
          <div className="attention-tabs" role="group" aria-label="Attention categories">
            {[
              { id: 'overdue', name: 'Overdue', count: overdue.length },
              { id: 'blocked', name: 'Blocked', count: blocked.length },
              { id: 'review', name: 'To review', count: review.length },
              { id: 'soon', name: 'Due soon', count: soon.length },
            ].map((t) => (
              <button
                key={t.id}
                aria-pressed={focus === t.id}
                className={focus === t.id ? 'active' : ''}
                onClick={() => setFocus(t.id)}
              >
                {t.name}
                <span>{t.count}</span>
              </button>
            ))}
          </div>
          <TaskTable compact tasks={focusRows.slice(0, 5)} data={data} onTask={onTask} />
          {focusRows.length > 5 && (
            <button
              className="panel-footer-link"
              onClick={() =>
                onNavigate(
                  'tasks',
                  focus === 'overdue'
                    ? { due: 'overdue' }
                    : focus === 'soon'
                      ? { due: 'soon' }
                      : { status: focus === 'review' ? 'in_review' : 'blocked' },
                )
              }
            >
              See {focusRows.length - 5} more tasks
              <ArrowRight size={14} />
            </button>
          )}
        </section>
        <section className="panel delivery-panel">
          <SectionHeader title="Delivery pulse" subtitle="Accepted work · last 7 days" />
          <div className="pulse-total">
            <strong>{totalAccepted}</strong>
            <div>
              tasks accepted
              <span>
                {dateLabel(days[0])} – {dateLabel(date)}
              </span>
            </div>
          </div>
          {totalAccepted === 0 && (
            <p className="chart-empty-note">No work was accepted in the last seven days.</p>
          )}
          <div
            className="bar-chart"
            aria-label={`Accepted tasks in the last seven days: ${totalAccepted} total`}
            role="img"
          >
            {days.map((day, i) => (
              <div className="bar-column" key={day}>
                <div className="bar-area">
                  <span className="bar-count">{completedDays[i]}</span>
                  <div
                    className={i === 6 ? 'chart-bar current' : 'chart-bar'}
                    style={{ height: `${(completedDays[i] / dailyMax) * 100}%` }}
                  />
                </div>
                <span>
                  {new Date(`${day}T12:00:00Z`)
                    .toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' })
                    .slice(0, 1)}
                </span>
              </div>
            ))}
          </div>
          <div className="pulse-footer">
            <span>
              <i className="legend-dot orange" />
              Accepted tasks
            </span>
            <button className="text-button" onClick={() => onNavigate('reports')}>
              Open reports
              <ArrowUpRight size={14} />
            </button>
          </div>
        </section>
      </div>
      <div className="overview-lower-grid">
        <section className="panel departments-panel">
          <SectionHeader
            title="Across departments"
            subtitle="A shared picture of delivery, without individual scores."
            action={<LinkButton onClick={() => onNavigate('people')}>People</LinkButton>}
          />
          <div className="table-scroll">
            <table className="department-table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Open</th>
                  <th>Overdue</th>
                  <th>Completion</th>
                </tr>
              </thead>
              <tbody>
                {data.departments.map((d) => {
                  const tasks = data.tasks.filter(
                    (t) => t.departmentId === d.id && t.status !== 'cancelled',
                  );
                  const done = tasks.filter((t) => t.status === 'done').length;
                  const late = tasks.filter((t) => isOverdue(t, date)).length;
                  return (
                    <tr key={d.id}>
                      <td>
                        <button
                          className="department-link"
                          onClick={() => onNavigate('tasks', { departmentId: d.id })}
                        >
                          <span
                            className="department-icon"
                            style={{ color: d.color, background: `${d.color}15` }}
                          >
                            {d.name.slice(0, 1)}
                          </span>
                          <div>
                            <strong>{d.name}</strong>
                            <span>
                              {
                                data.people.filter((p) => p.active && p.departmentId === d.id)
                                  .length
                              }{' '}
                              people
                            </span>
                          </div>
                        </button>
                      </td>
                      <td>{tasks.filter(isOpen).length}</td>
                      <td>
                        <button
                          className={late ? 'number-alert' : 'number-muted'}
                          onClick={() =>
                            onNavigate('tasks', { departmentId: d.id, due: 'overdue' })
                          }
                        >
                          {late}
                        </button>
                      </td>
                      <td>
                        <div className="department-progress">
                          <ProgressBar value={percent(done, tasks.length)} color="slate" />
                          <span>
                            {done}/{tasks.length}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.departments.length === 0 && (
            <EmptyState
              title="Build your organisation"
              description="Add departments in People to group work and ownership."
            />
          )}
        </section>
        <section className="panel project-health-panel">
          <SectionHeader
            title="Project health"
            subtitle={`${activeProjects.length} active initiatives`}
            action={<LinkButton onClick={() => onNavigate('projects')}>All projects</LinkButton>}
          />
          <div className="project-health-list">
            {activeProjects.slice(0, 4).map((p) => {
              const tasks = data.tasks.filter(
                (t) => t.projectId === p.id && t.status !== 'cancelled',
              );
              const risk = tasks.filter((t) => t.status === 'blocked' || isOverdue(t, date)).length;
              const done = tasks.filter((t) => t.status === 'done').length;
              return (
                <button className="health-project" key={p.id} onClick={() => onProject(p.id)}>
                  <div className="health-title">
                    <span
                      className="project-square"
                      style={{ background: `${p.color}18`, color: p.color }}
                    >
                      <Layers3 size={16} />
                    </span>
                    <strong>{p.name}</strong>
                    <ArrowUpRight size={15} />
                  </div>
                  <div className="health-project-meta">
                    <span>{departmentName(data, p.departmentId)}</span>
                    <span className={risk ? 'health-at-risk' : 'health-good'}>
                      {risk ? `${risk} need attention` : 'No overdue work'}
                    </span>
                  </div>
                  <ProgressBar
                    value={percent(done, tasks.length)}
                    color={risk ? 'orange' : 'green'}
                  />
                  <div className="health-project-bottom">
                    <span>
                      {done}/{tasks.length} tasks accepted
                    </span>
                    <Avatar person={data.people.find((v) => v.id === p.ownerId)} size="xs" />
                  </div>
                </button>
              );
            })}
            {activeProjects.length === 0 && (
              <EmptyState
                title="No active projects"
                description="Create a project to connect related work."
              />
            )}
          </div>
        </section>
      </div>
      <div className="overview-bottom-grid">
        <section className="panel activity-panel">
          <SectionHeader title="Latest activity" subtitle="A record of the work moving forward." />
          <div className="activity-preview">
            {data.activities
              .slice()
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .slice(0, 4)
              .map((a) => {
                const content = (
                  <>
                    <Avatar person={data.people.find((p) => p.id === a.userId)} size="sm" />
                    <div>
                      <p>
                        <strong>{personName(data, a.userId)}</strong>{' '}
                        {a.action.replaceAll('_', ' ')}
                      </p>
                      <span>{a.detail}</span>
                    </div>
                    <time>{relativeTime(a.createdAt)}</time>
                  </>
                );
                const target = a.taskId ? null : activityTarget(a.action);
                if (!a.taskId && !target)
                  return (
                    <div key={a.id} className="activity-preview-row">
                      {content}
                    </div>
                  );
                return (
                  <button
                    key={a.id}
                    className="activity-preview-row"
                    onClick={() => (a.taskId ? onTask(a.taskId) : onNavigate(target!))}
                  >
                    {content}
                  </button>
                );
              })}
            {data.activities.length === 0 && (
              <p className="panel-empty-note">Your team's updates will appear here.</p>
            )}
          </div>
        </section>
        <section className="plan-callout">
          <div className="callout-icon">
            <Target size={22} />
          </div>
          <span className="eyebrow">FROM ACTIVITY TO OUTCOMES</span>
          <h2>Keep the goal in sight.</h2>
          <p>
            {data.goals.length} company goals connect day-to-day work with the results that matter.
          </p>
          <button className="button button-dark" onClick={() => onNavigate('goals')}>
            Explore goals
            <ArrowRight size={15} />
          </button>
        </section>
      </div>
    </div>
  );
}
function todayOf(timestamp: string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));
}
