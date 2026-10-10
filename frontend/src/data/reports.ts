import type { Task } from '../types';
import { deadlineChanged, isTaskOverdue } from './deadlines';
import { validDate } from './imports';
import { addDays, todayInTimezone } from './metrics';
export interface ReportFilters {
  from: string;
  to: string;
  departmentId?: string;
  ownerId?: string;
  projectId?: string;
}
function acceptanceDate(task: Task, timezone: string): string {
  const accepted = new Date(task.completedAt);
  return Number.isFinite(accepted.getTime()) ? todayInTimezone(timezone, accepted) : '';
}
export function reportDeadlineMet(task: Task, timezone: string, original: boolean): boolean | null {
  const accepted = Date.parse(task.completedAt);
  if (!Number.isFinite(accepted)) return null;
  const mode = original ? task.originalDeadlineMode : task.deadlineMode;
  if (mode === 'timed') {
    const due = Date.parse((original ? task.originalDueAt : task.dueAt) ?? '');
    return Number.isFinite(due) ? accepted <= due : null;
  }
  const due = original ? task.originalDueDate : task.dueDate;
  return validDate(due) ? acceptanceDate(task, timezone) <= due : null;
}
export function buildTaskReport(
  tasks: Task[],
  filters: ReportFilters,
  timezone: string,
  now: Date,
) {
  const { from, to, departmentId, ownerId, projectId } = filters;
  const valid = validDate(from) && validDate(to) && from <= to;
  const filtered = valid
    ? tasks.filter(
        (t) =>
          (!departmentId || t.departmentId === departmentId) &&
          (!ownerId || t.ownerId === ownerId) &&
          (!projectId || t.projectId === projectId),
      )
    : [];
  const cohort = filtered.filter(
    (t) => validDate(t.dueDate) && t.dueDate >= from && t.dueDate <= to && t.status !== 'cancelled',
  );
  const accepted = filtered.filter((t) => {
    const date = acceptanceDate(t, timezone);
    return t.status === 'done' && date !== '' && date >= from && date <= to;
  });
  const originals = accepted.filter((t) => reportDeadlineMet(t, timezone, true) !== null);
  const ontime = originals.filter((t) => reportDeadlineMet(t, timezone, true));
  const currents = accepted.filter((t) => reportDeadlineMet(t, timezone, false) !== null);
  const currentOnTime = currents.filter((t) => reportDeadlineMet(t, timezone, false));
  const overdue = cohort.filter((t) => isTaskOverdue(t, now, timezone));
  const changed = cohort.filter(
    (t) =>
      (t.originalDueDate || t.originalDueAt) &&
      deadlineChanged(t, {
        dueDate: t.originalDueDate,
        deadlineMode: t.originalDeadlineMode,
        dueAt: t.originalDueAt,
        dueTimezone: t.originalDueTimezone,
      }),
  );
  const days = valid
    ? Math.floor((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000) + 1
    : 0;
  const size = Math.max(1, Math.ceil(days / 12));
  const acceptedDates = accepted.map((t) => acceptanceDate(t, timezone));
  const buckets = Array.from({ length: Math.ceil(days / size) }, (_, i) => {
    const start = addDays(from, i * size);
    const end = addDays(from, Math.min(days - 1, (i + 1) * size - 1));
    return {
      start,
      end,
      count: acceptedDates.filter((date) => date >= start && date <= end).length,
    };
  });
  return {
    valid,
    cohort,
    accepted,
    originals,
    ontime,
    currents,
    currentOnTime,
    overdue,
    changed,
    done: cohort.filter((t) => t.status === 'done'),
    blocked: cohort.filter((t) => t.status === 'blocked'),
    pending: cohort.filter((t) => t.status === 'in_review'),
    buckets,
  };
}
