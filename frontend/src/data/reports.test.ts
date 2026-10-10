import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import sample from './sample.json';
import { buildTaskReport, reportDeadlineMet } from './reports';
const task = (patch: Partial<Task> = {}): Task => ({ ...sample.workspaces[0].tasks[0], id: 'one', status: 'done', dueDate: '2026-10-10', originalDueDate: '2026-10-10', completedAt: '2026-10-10T10:35:00Z', deadlineMode: 'all_day', originalDeadlineMode: 'all_day', ...patch }) as Task;
const filters = { from: '2026-10-01', to: '2026-10-31' };
const now = new Date('2026-10-10T10:40:00Z');
describe('current-state report model', () => {
  it('uses exact instants for original/current rates and includes the equality boundary', () => {
    const late = task({ deadlineMode: 'timed', dueAt: '2026-10-10T16:00:00+05:30', originalDeadlineMode: 'timed', originalDueAt: '2026-10-10T10:30:00Z' });
    expect(reportDeadlineMet(late, 'Asia/Kolkata', true)).toBe(false);
    expect(reportDeadlineMet(late, 'Asia/Kolkata', false)).toBe(false);
    const equal = task({ ...late, id: 'equal', completedAt: '2026-10-10T10:30:00Z' });
    const r = buildTaskReport([late, equal], filters, 'Asia/Kolkata', now);
    expect(r.ontime.map(t => t.id)).toEqual(['equal']);
    expect(r.currentOnTime.map(t => t.id)).toEqual(['equal']);
  });
  it('uses the company calendar for all-day acceptance and period boundaries', () => {
    const t = task({ completedAt: '2026-10-10T20:00:00Z' });
    expect(reportDeadlineMet(t, 'Asia/Kolkata', true)).toBe(false);
    expect(reportDeadlineMet(t, 'America/New_York', true)).toBe(true);
    expect(buildTaskReport([t], { from: '2026-10-11', to: '2026-10-11' }, 'Asia/Kolkata', now).accepted).toHaveLength(1);
  });
  it('excludes missing or malformed deadlines/acceptances from denominators', () => {
    const invalid = task({ completedAt: 'not-an-instant' });
    expect(reportDeadlineMet(invalid, 'Asia/Kolkata', true)).toBeNull();
    expect(reportDeadlineMet(task({ originalDueDate: '' }), 'Asia/Kolkata', true)).toBeNull();
    expect(reportDeadlineMet(task({ originalDeadlineMode: 'timed', originalDueAt: '' }), 'Asia/Kolkata', true)).toBeNull();
    expect(buildTaskReport([invalid], filters, 'Asia/Kolkata', now).accepted).toEqual([]);
    expect(buildTaskReport([], filters, 'Asia/Kolkata', now).originals).toEqual([]);
  });
  it('counts time/mode/timezone changes even when the date is unchanged', () => {
    const rows = [task({ deadlineMode: 'timed', originalDeadlineMode: 'timed', dueAt: '2026-10-10T11:00:00Z', originalDueAt: '2026-10-10T10:00:00Z' }), task({ id: 'mode', deadlineMode: 'timed', dueAt: '2026-10-10T11:00:00Z' }), task({ id: 'zone', deadlineMode: 'timed', originalDeadlineMode: 'timed', dueAt: '2026-10-10T11:00:00Z', originalDueAt: '2026-10-10T11:00:00Z', dueTimezone: 'Asia/Kolkata', originalDueTimezone: 'UTC' })];
    expect(buildTaskReport(rows, filters, 'Asia/Kolkata', now).changed).toHaveLength(3);
  });
  it('intersects project/department/owner, excludes cancellation and uses captured now', () => {
    const t = task({ status: 'todo', projectId: 'p', departmentId: 'd', ownerId: 'u', deadlineMode: 'timed', dueAt: '2026-10-10T10:30:00Z' });
    const r = buildTaskReport([t, task({ ...t, id: 'other', projectId: 'q' }), task({ ...t, id: 'cancel', status: 'cancelled' })], { ...filters, projectId: 'p', departmentId: 'd', ownerId: 'u' }, 'Asia/Kolkata', now);
    expect(r.cohort.map(t => t.id)).toEqual(['one']);
    expect(r.overdue).toHaveLength(1);
    expect(buildTaskReport([t], filters, 'Asia/Kolkata', new Date('2026-10-10T10:30:00Z')).overdue).toEqual([]);
  });
  it('covers the entire long period with at most twelve chart buckets and rejects reversed dates', () => {
    const r = buildTaskReport([task()], { from: '2000-01-01', to: '2026-10-31' }, 'Asia/Kolkata', now);
    expect(r.buckets.length).toBeLessThanOrEqual(12);
    expect(r.buckets.reduce((n,b) => n + b.count, 0)).toBe(1);
    expect(buildTaskReport([task()], { from: '2026-11-01', to: '2026-10-01' }, 'Asia/Kolkata', now).cohort).toEqual([]);
  });
});
