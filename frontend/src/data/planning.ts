import { useExecutionRead } from './execution';
export * from '../../../shared/planning/types';
export const usePlanningRead = useExecutionRead;

import type { Task } from '../types';
export type CalendarTask = Pick<
  Task,
  | 'id'
  | 'code'
  | 'title'
  | 'version'
  | 'ownerId'
  | 'departmentId'
  | 'projectId'
  | 'parentId'
  | 'dependencies'
  | 'status'
  | 'priority'
  | 'progress'
  | 'dueDate'
  | 'deadlineMode'
  | 'dueAt'
  | 'dueTimezone'
>;
export type CalendarView = {
  tasks: CalendarTask[];
  complete: true;
  timezone: string;
  readBasis: string;
};
