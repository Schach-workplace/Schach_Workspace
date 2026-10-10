import { describe, it, expect } from 'vitest';
import { todayInTimezone, isOverdue, taskMetrics, goalProgress, personLoad } from './metrics';
import sample from './sample.json';
import type { Task, Goal, Person } from '../types';
const task = (patch: Partial<Task> = {}) =>
  ({ ...sample.workspaces[0].tasks[0], ...patch }) as Task;
describe('commitment metrics', () => {
  it('uses company calendar date across the UTC boundary', () => {
    expect(todayInTimezone('Asia/Kolkata', new Date('2026-10-09T20:00:00Z'))).toBe('2026-10-10');
    expect(todayInTimezone('America/New_York', new Date('2026-10-10T01:00:00Z'))).toBe(
      '2026-10-09',
    );
  });
  it('keeps today available and excludes completed/cancelled overdue work', () => {
    expect(isOverdue(task({ dueDate: '2026-10-10' }), '2026-10-10')).toBe(false);
    expect(isOverdue(task({ dueDate: '2026-10-09' }), '2026-10-10')).toBe(true);
    expect(isOverdue(task({ dueDate: '2026-10-09', status: 'done' }), '2026-10-10')).toBe(false);
  });
  it('uses original commitments and local acceptance dates for on-time rate', () => {
    const tasks = [
      task({
        status: 'done',
        dueDate: '2026-10-15',
        originalDueDate: '2026-10-09',
        completedAt: '2026-10-09T20:00:00Z',
      }),
      task({
        id: 'other',
        status: 'done',
        dueDate: '2026-10-10',
        originalDueDate: '2026-10-10',
        completedAt: '2026-10-10T10:00:00Z',
      }),
    ];
    expect(taskMetrics(tasks, '2026-10-10', 'Asia/Kolkata').onTimeRate).toBe(50);
  });
  it('does not invent a percentage for no accepted work', () => {
    expect(taskMetrics([], '2026-10-10').onTimeRate).toBeNull();
    expect(taskMetrics([], '2026-10-10').completionRate).toBeNull();
  });
  it('supports lower-is-better outcomes', () => {
    expect(goalProgress({ baseline: 8, target: 3, current: 4.8 } as Goal)).toBeCloseTo(64);
    expect(goalProgress({ baseline: 0, target: 0, current: 0 } as Goal)).toBe(0);
  });
  it('uses remaining effort and excludes finished and future work from capacity', () => {
    const p = { id: 'u1', capacityHours: 40 } as Person;
    const ts = [
      task({ ownerId: 'u1', estimatedHours: 20, progress: 50, dueDate: '2026-10-12' }),
      task({ ownerId: 'u1', estimatedHours: 80, status: 'done', dueDate: '2026-10-12' }),
      task({ ownerId: 'u1', estimatedHours: 80, dueDate: '2026-11-12', startDate: '2026-11-10' }),
    ];
    expect(personLoad(ts, p, '2026-10-10').hours).toBe(10);
    expect(personLoad(ts, p, '2026-10-10').percentage).toBe(25);
  });
});
