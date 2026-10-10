import { originalDeadlineMet, deadlineChanged } from './deadlines';
import type { Goal, Person, Task } from '../types';

export function todayInTimezone(timezone = 'Asia/Kolkata', now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function addDays(value: string, days: number): string {
  const d = new Date(`${value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function isOpen(task: Task): boolean {
  return !['done', 'cancelled'].includes(task.status);
}
export function isOverdue(task: Task, today: string): boolean {
  return isOpen(task) && (task.deadlineMode==='timed' ? !!task.dueAt && Date.now()>Date.parse(task.dueAt) : !!task.dueDate && task.dueDate < today);
}
export function isDueSoon(task: Task, today: string, days = 7): boolean {
  return (
    isOpen(task) && !!task.dueDate && task.dueDate >= today && task.dueDate <= addDays(today, days)
  );
}
export function remainingHours(task: Task): number {
  return isOpen(task)
    ? Math.max(0, task.estimatedHours * (1 - Math.min(100, Math.max(0, task.progress)) / 100))
    : 0;
}
export function goalProgress(goal: Goal): number {
  if (goal.target === goal.baseline) return 0;
  return Math.max(
    0,
    Math.min(100, ((goal.current - goal.baseline) / (goal.target - goal.baseline)) * 100),
  );
}
export function taskMetrics(tasks: Task[], today: string, timezone = 'Asia/Kolkata') {
  const completed = tasks.filter((t) => t.status === 'done');
  const measured = completed.filter((t) => t.originalDueDate && t.completedAt);
  const onTime = measured.filter(
    (t) => originalDeadlineMet(t,timezone),
  ).length;
  const relevant = tasks.filter((t) => t.status !== 'cancelled');
  const open = relevant.filter(isOpen).length;
  const review = tasks.filter((t) => t.status === 'in_review').length;
  return {
    total: tasks.length,
    open,
    active: open,
    overdue: tasks.filter((t) => isOverdue(t, today)).length,
    blocked: tasks.filter((t) => t.status === 'blocked').length,
    inReview: review,
    review,
    done: completed.length,
    completed: completed.length,
    dueSoon: tasks.filter((t) => isDueSoon(t, today)).length,
    onTimeRate: measured.length ? Math.round((onTime / measured.length) * 100) : null,
    onTimeCount: onTime,
    onTimeDenominator: measured.length,
    completionRate: relevant.length ? Math.round((completed.length / relevant.length) * 100) : null,
    deadlineChanges: tasks.filter((t) => deadlineChanged(t,{dueDate:t.originalDueDate,deadlineMode:t.originalDeadlineMode,dueAt:t.originalDueAt,dueTimezone:t.originalDueTimezone})).length,
    estimatedHours: relevant.reduce((sum, t) => sum + t.estimatedHours, 0),
    actualHours: relevant.reduce((sum, t) => sum + t.actualHours, 0),
  };
}
export function personLoad(tasks: Task[], person: Person, today: string) {
  const end = addDays(today, 7);
  // Include current overdue commitments and work due within this planning window.
  const assigned = tasks.filter(
    (t) => t.ownerId === person.id && isOpen(t) && !!t.dueDate && t.dueDate <= end,
  );
  const hours = Math.round(assigned.reduce((sum, t) => sum + remainingHours(t), 0) * 10) / 10;
  const capacity = Math.max(0, person.capacityHours);
  const percentage = capacity ? Math.round((hours / capacity) * 100) : 0;
  return {
    tasks: assigned,
    hours,
    capacity,
    percentage,
    overloaded: hours > capacity,
    count: assigned.length,
  };
}
export function dateInRange(value: string, from: string, to: string) {
  return !!value && (!from || value >= from) && (!to || value <= to);
}
