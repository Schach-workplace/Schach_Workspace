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
export function CalendarPage({ onTask }: { onTask: (id: string) => void }) {
  const { data: workspace } = useWorkspace();
  const data = workspace!;
  const date = today(data.company.timezone);
  const [anchor, setAnchor] = useState(date);
  const [selected, setSelected] = useState(date);
  const [view, setView] = useState('month');
  const [department, setDepartment] = useState('');
  const [owner, setOwner] = useState('');
  const [openOnly, setOpenOnly] = useState(true);
  const firstMonth = anchor.slice(0, 7) + '-01';
  const first = view === 'week' ? weekStart(anchor) : weekStart(firstMonth);
  const days = Array.from({ length: view === 'week' ? 7 : 42 }, (_, i) => addDays(first, i));
  const tasks = data.tasks.filter(
    (t) =>
      (!openOnly || isOpen(t)) &&
      (!department || t.departmentId === department) &&
      (!owner || t.ownerId === owner),
  );
  const selectedTasks = tasks.filter((t) => (t.deadlineMode==='timed'&&t.dueAt?localDeadline(t.dueAt,data.company.timezone).slice(0,10):t.dueDate) === selected);
  function change(direction: number) {
    if (view === 'week') setAnchor(addDays(anchor, 7 * direction));
    else {
      const d = new Date(`${firstMonth}T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + direction);
      setAnchor(d.toISOString().slice(0, 10));
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
        <div className="segmented">
          <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>
            Month
          </button>
          <button className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>
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
        <span className="timezone-note">Deadlines in {data.company.timezone}</span>
      </div>
      <div className={cx('calendar-grid', view === 'week' && 'calendar-week')}>
        <div className="calendar-weekdays">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="calendar-days">
          {days.map((day) => {
            const work = tasks.filter((t) => (t.deadlineMode==='timed'&&t.dueAt?localDeadline(t.dueAt,data.company.timezone).slice(0,10):t.dueDate) === day);
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
                  aria-label={`${dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}, ${work.length} tasks`}
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
          <p>{selectedTasks.length} deadlines on this day</p>
        </div>
        <CalendarDays size={18} />
      </div>
      <div className="panel">
        <TaskTable tasks={selectedTasks} data={data} onTask={onTask} compact />
      </div>
    </div>
  );
}

export function WorkloadPage({ onTask }: { onTask: (id: string) => void }) {
  const { data: workspace } = useWorkspace();
  const data = workspace!;
  const date = today(data.company.timezone);
  const [start, setStart] = useState(weekStart(date));
  const [department, setDepartment] = useState('');
  const [selected, setSelected] = useState('');
  const end = addDays(start, 6);
  const people = data.people.filter(
    (p) => p.active && (!department || p.departmentId === department),
  );
  const rows = people
    .map((person) => {
      const tasks = data.tasks.filter((t) => t.ownerId === person.id && scheduled(t, start, end));
      const planned =
        Math.round(
          tasks.reduce((sum, t) => sum + t.estimatedHours * (1 - t.progress / 100), 0) * 10,
        ) / 10;
      return {
        person,
        tasks,
        planned,
        utilization: person.capacityHours
          ? (planned / person.capacityHours) * 100
          : planned > 0
            ? 101
            : 0,
      };
    })
    .sort((a, b) => b.utilization - a.utilization);
  const totalCapacity = people.reduce((sum, p) => sum + p.capacityHours, 0);
  const planned = Math.round(rows.reduce((sum, row) => sum + row.planned, 0) * 10) / 10;
  const selectedRow = rows.find((r) => r.person.id === selected);
  const unscheduled = data.tasks.filter(
    (t) =>
      isOpen(t) && !t.startDate && !t.dueDate && (!department || t.departmentId === department),
  );
  return (
    <div className="page-content">
      <div className="task-toolbar">
        <div className="calendar-month">
          <button
            className="icon-button bordered"
            aria-label="Previous week"
            onClick={() => setStart(addDays(start, -7))}
          >
            <ChevronLeft size={17} />
          </button>
          <h2>
            {dateLabel(start)} – {dateLabel(end)}
          </h2>
          <button
            className="icon-button bordered"
            aria-label="Next week"
            onClick={() => setStart(addDays(start, 7))}
          >
            <ChevronRight size={17} />
          </button>
          <button className="button button-secondary" onClick={() => setStart(weekStart(date))}>
            This week
          </button>
        </div>
        <select
          aria-label="Workload department"
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
      </div>
      <div className="capacity-summary">
        <div>
          <Clock3 size={19} />
          <span>Remaining planned effort</span>
          <strong>
            {planned}
            <small>h</small>
          </strong>
        </div>
        <div>
          <UsersRound size={19} />
          <span>Declared weekly capacity</span>
          <strong>
            {totalCapacity}
            <small>h</small>
          </strong>
        </div>
        <div>
          <CircleHelp size={19} />
          <span>People over capacity</span>
          <strong>
            {rows.filter((r) => r.utilization > 100).length}
            <small> / {people.length}</small>
          </strong>
        </div>
      </div>
      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Make room for the right work</h2>
            <p>Estimated remaining effort, compared with each person's weekly availability.</p>
          </div>
          <span className="pill pill-slate">{people.length} people</span>
        </div>
        <div className="workload-list">
          {rows.map((row) => (
            <button
              className="workload-row"
              key={row.person.id}
              onClick={() => setSelected(row.person.id)}
            >
              <div className="workload-person">
                <Avatar person={row.person} size="md" />
                <div>
                  <strong>{row.person.name}</strong>
                  <span>{row.person.title || departmentName(data, row.person.departmentId)}</span>
                </div>
              </div>
              <div className="workload-bar">
                <div>
                  <span>
                    {row.planned}h planned{' '}
                    <span className="muted">/ {row.person.capacityHours}h available</span>
                  </span>
                  <strong>
                    {row.person.capacityHours ? `${Math.round(row.utilization)}%` : '—'}
                  </strong>
                </div>
                <ProgressBar
                  value={row.utilization}
                  color={row.utilization > 100 ? 'red' : row.utilization > 80 ? 'orange' : 'green'}
                />
              </div>
              <span
                className={`pill ${row.utilization > 100 ? 'pill-red' : row.utilization >= 80 ? 'pill-orange' : 'pill-green'}`}
              >
                {!row.person.capacityHours
                  ? 'No capacity set'
                  : row.utilization > 100
                    ? 'Over capacity'
                    : row.utilization >= 80
                      ? 'Near capacity'
                      : 'Room available'}
              </span>
              <span className="workload-task-count">
                {row.tasks.length} tasks
                <ArrowRight size={15} />
              </span>
            </button>
          ))}
          {rows.length === 0 && (
            <EmptyState
              title="No people in this view"
              description="Choose another department, or add a company member."
            />
          )}
        </div>
      </section>
      <div className="method-note">
        <CircleHelp size={18} />
        <div>
          <h3>How capacity is calculated</h3>
          <p>
            Remaining effort = estimated hours × (1 − progress ÷ 100). Open tasks whose
            start–deadline interval overlaps {dateLabel(start)}–{dateLabel(end)} contribute their
            full remaining estimate once. Tasks with only one date use that date. This is a
            conservative planning view, not a timesheet or an employee rating.
          </p>
          {unscheduled.length > 0 && (
            <p>
              <strong>{unscheduled.length} undated tasks</strong> are excluded until scheduled.
            </p>
          )}
        </div>
      </div>
      {selectedRow && (
        <Modal
          open
          onClose={() => setSelected('')}
          title={`${selectedRow.person.name}'s planned work`}
          description={`${dateLabel(start)} – ${dateLabel(end)} · ${selectedRow.planned}h remaining / ${selectedRow.person.capacityHours}h capacity`}
          wide
        >
          <TaskTable
            tasks={selectedRow.tasks}
            data={data}
            onTask={(id) => {
              setSelected('');
              onTask(id);
            }}
            compact
          />
        </Modal>
      )}
    </div>
  );
}
