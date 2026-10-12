import { useExecutionRead } from '../data/execution';
import type { CalendarTask, CalendarView } from '../data/planning';
import { useExecutionInput } from '../data/executionInput';
import PlanningView from '../components/PlanningView';
import { localDeadline } from '../data/deadlines';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Filter,
  UsersRound,
} from 'lucide-react';
import { useWorkspace } from '../store';
import type { Task } from '../types';
import {
  addDays,
  Avatar,
  cx,
  dateLabel,
  departmentName,
  EmptyState,
  isOpen,
  isOverdue,
  Modal,
  personName,
  ProgressBar,
  StatusBadge,
  today,
} from '../components/UI';
import { TaskTable } from './Tasks';

function weekStart(date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -(day === 0 ? 6 : day - 1));
}
function scheduled(task: Task, from: string, to: string) {
  if (!isOpen(task)) return false;
  const start = task.startDate || task.dueDate;
  const end = task.dueDate || task.startDate;
  return !!start && start <= to && end >= from;
}
function calendarTaskDate(t: CalendarTask, zone: string) {
  if (t.deadlineMode === 'timed') {
    if (!t.dueAt || !Number.isFinite(Date.parse(t.dueAt))) return '';
    return localDeadline(t.dueAt, zone).slice(0, 10);
  }
  return t.dueDate;
}
export function CalendarPage({ onTask }: { onTask: (id: string) => void }) {
  const { data: workspace, mode } = useWorkspace();
  const data = workspace!;
  const date = today(data.company.timezone);
  const [anchor, setAnchor] = useExecutionInput('$calendar', 'anchor', date);
  const [selected, setSelected] = useExecutionInput('$calendar', 'selected', date);
  const [view, setView] = useExecutionInput('$calendar', 'view', 'month');
  const [department, setDepartment] = useState('');
  const [owner, setOwner] = useState('');
  const [openOnly, setOpenOnly] = useState(true);
  const firstMonth = anchor.slice(0, 7) + '-01';
  const first = view === 'week' ? weekStart(anchor) : weekStart(firstMonth);
  const days = Array.from({ length: view === 'week' ? 7 : 42 }, (_, i) => addDays(first, i));
  const calendarQuery = new URLSearchParams({
    from: first,
    to: days[days.length - 1],
    departmentId: department,
    ownerId: owner,
    openOnly: String(openOnly),
  });
  const agenda = useExecutionRead<CalendarView>(
    '/planning/calendar?' + calendarQuery,
    mode !== 'demo',
  );
  const demo = mode === 'demo';
  const complete = demo || (agenda.ready && agenda.data?.complete === true);
  const tasks: CalendarTask[] = demo
    ? data.tasks.filter(
        (t) =>
          (!openOnly || isOpen(t)) &&
          (!department || t.departmentId === department) &&
          (!owner || t.ownerId === owner),
      )
    : complete
      ? agenda.data!.tasks
      : [];
  const calendarZone = !demo && complete ? agenda.data!.timezone : data.company.timezone;
  const taskDate = (task: CalendarTask) =>
    demo ? calendarTaskDate(task, calendarZone) : task.dueDate;
  const selectedTasks = tasks.filter((t) => taskDate(t) === selected);
  function change(direction: number) {
    if (view === 'week') {
      const next = addDays(anchor, 7 * direction);
      setAnchor(next);
      setSelected(next);
    } else {
      const d = new Date(`${firstMonth}T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + direction);
      const next = d.toISOString().slice(0, 10);
      setAnchor(next);
      setSelected(next);
    }
  }
  return (
    <div className="page-content">
      <div className="calendar-toolbar">
        <div className="calendar-month">
          <button
            className="icon-button bordered"
            aria-label="Previous period"
            onClick={() => change(-1)}
          >
            <ChevronLeft size={17} />
          </button>
          <h2>
            {view === 'week'
              ? `${dateLabel(days[0])} – ${dateLabel(days[6])}`
              : dateLabel(anchor, { month: 'long', year: 'numeric' })}
          </h2>
          <button
            className="icon-button bordered"
            aria-label="Next period"
            onClick={() => change(1)}
          >
            <ChevronRight size={17} />
          </button>
          <button
            className="button button-secondary"
            onClick={() => {
              setAnchor(date);
              setSelected(date);
            }}
          >
            Today
          </button>
        </div>
        <div className="segmented" role="group" aria-label="Calendar view">
          <button
            aria-pressed={view === 'month'}
            className={view === 'month' ? 'active' : ''}
            onClick={() => {
              setView('month');
              setSelected(anchor);
            }}
          >
            Month
          </button>
          <button
            aria-pressed={view === 'week'}
            className={view === 'week' ? 'active' : ''}
            onClick={() => {
              setView('week');
              setSelected(anchor);
            }}
          >
            Week
          </button>
        </div>
      </div>
      <div className="calendar-filters">
        <select
          aria-label="Calendar department"
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
          aria-label="Calendar owner"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        >
          <option value="">All owners</option>
          {data.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="check-field">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
          />
          Open work only
        </label>
        <span className="timezone-note">Deadlines in {calendarZone}</span>
      </div>
      {demo && (
        <p>Demo calendar shows the finite local sample; it is not a complete server calendar.</p>
      )}
      {!complete && (
        <p role="status">
          {agenda.error?.message ?? 'Checking the complete currently authorized calendar range…'}
        </p>
      )}
      <div className={cx('calendar-grid', view === 'week' && 'calendar-week')}>
        <div className="calendar-weekdays">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="calendar-days">
          {days.map((day) => {
            const work = tasks.filter((t) => taskDate(t) === day);
            return (
              <div
                className={cx(
                  'calendar-day',
                  day.slice(0, 7) !== anchor.slice(0, 7) && view === 'month' && 'outside',
                  day === selected && 'selected',
                  day === date && 'is-today',
                )}
                key={day}
              >
                <button
                  className="calendar-day-number"
                  aria-label={`${dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}, ${complete ? work.length + ' tasks' : 'checking current calendar'}`}
                  onClick={() => setSelected(day)}
                >
                  {Number(day.slice(-2))}
                  {work.length > 0 && <span className="mobile-task-count">{work.length}</span>}
                </button>
                <div className="calendar-day-tasks">
                  {work.slice(0, view === 'week' ? 8 : 2).map((t) => (
                    <button
                      className={cx(
                        'calendar-task',
                        isOverdue(t, date) && 'late',
                        t.status === 'done' && 'accepted',
                      )}
                      key={t.id}
                      onClick={() => onTask(t.id)}
                      title={t.title}
                    >
                      <span />
                      {t.title}
                    </button>
                  ))}
                  {work.length > (view === 'week' ? 8 : 2) && (
                    <button className="calendar-more" onClick={() => setSelected(day)}>
                      +{work.length - (view === 'week' ? 8 : 2)} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="section-header calendar-agenda-heading">
        <div>
          <h2>{dateLabel(selected, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          <p>
            {complete
              ? `${selectedTasks.length} deadlines on this day`
              : 'Current day count unavailable while the complete range is checked.'}
          </p>
        </div>
        <CalendarDays size={18} />
      </div>
      <div className="panel">
        {complete && <TaskTable tasks={selectedTasks} data={data} onTask={onTask} compact />}
        {!complete && agenda.error && (
          <button className="button" onClick={() => void agenda.retry()}>
            Retry current calendar range
          </button>
        )}
      </div>
      <PlanningView key={first} from={first} to={days[days.length - 1]} onTask={onTask} />
    </div>
  );
}

export function WorkloadPage({ onTask }: { onTask: (id: string) => void }) {
  return <PlanningView onTask={onTask} />;
}
