import { describe, expect, it } from 'vitest';
import { deadlineCandidates, isTaskOverdue, originalDeadlineMet } from './deadlines';
import type { Task } from '../types';
describe('timed commitments', () => {
 it('normalizes Kolkata 16:00 and compares equality at the instant', () => {
  expect(deadlineCandidates('2026-10-14T16:00','Asia/Kolkata')).toEqual(['2026-10-14T10:30:00.000Z']);
  const task={status:'todo',deadlineMode:'timed',dueAt:'2026-10-14T10:30:00Z'} as Task;
  expect(isTaskOverdue(task,new Date(task.dueAt!), 'UTC')).toBe(false);
  expect(isTaskOverdue(task,new Date('2026-10-14T10:30:01Z'), 'America/New_York')).toBe(true);
 });
 it('rejects DST gaps and offers both explicit fold choices',()=>{
  expect(deadlineCandidates('2026-03-08T02:30','America/New_York')).toEqual([]);
  expect(deadlineCandidates('2026-11-01T01:30','America/New_York')).toEqual(['2026-11-01T05:30:00.000Z','2026-11-01T06:30:00.000Z']);
 });
 it('uses original timed commitment for acceptance',()=>{
  const task={originalDeadlineMode:'timed',originalDueAt:'2026-10-14T10:30:00Z',completedAt:'2026-10-14T10:30:01Z',dueAt:'2026-10-15T10:30:00Z'} as Task;
  expect(originalDeadlineMet(task,'UTC')).toBe(false);
 });
});
it('handles an invalid editable timezone without throwing during render',()=>{expect(deadlineCandidates('2026-10-14T16:00','Invalid/Zone')).toEqual([])});
