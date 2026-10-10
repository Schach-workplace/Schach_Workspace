import { describe, it, expect } from 'vitest';
import { parseTaskCSV, createTaskCSVTemplate, exportTasksCSV } from './imports';
import sample from './sample.json';
import type { WorkspaceData } from '../types';
const data = sample.workspaces[0] as WorkspaceData;
describe('safe task CSV import/export', () => {
  it('imports quoted multiline fields and maps actual company people', () => {
    const rows = parseTaskCSV(
      'Title,Description,Owner email,Department,Due date,Priority,Estimated hours\r\n"Review, final","Line one\nLine two",member@schach.demo,Engineering,2026-10-15,high,3.5',
      data,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Review, final');
    expect(rows[0].description).toBe('Line one\nLine two');
    expect(rows[0].ownerId).toBe('u-member');
    expect(rows[0].reviewerId).toBe('u-head');
    expect(rows[0].estimatedHours).toBe(3.5);
  });
  it('rejects an impossible date and unknown owner with row context', () => {
    expect(() =>
      parseTaskCSV('Title,Owner email,Due date\nTest,member@schach.demo,2026-02-30', data),
    ).toThrow(/row 2.*date/i);
    expect(() =>
      parseTaskCSV('Title,Owner email,Due date\nTest,stranger@example.com,2026-10-15', data),
    ).toThrow(/row 2.*owner/i);
  });
  it('rejects ambiguous duplicate columns and over-large imports', () => {
    expect(() => parseTaskCSV('Title,Title,Due date\nA,B,2026-10-15', data)).toThrow(/duplicate/i);
    expect(() =>
      parseTaskCSV('Title,Due date\n' + Array(201).fill('A,2026-10-15').join('\n'), data),
    ).toThrow(/200/);
  });
  it('exports text that cannot become a spreadsheet formula', () => {
    const text = exportTasksCSV(
      [{ ...data.tasks[0], title: '=HYPERLINK("https://example.com")' }],
      data,
    );
    expect(text).toContain("'=HYPERLINK");
    expect(text).toContain('Original deadline');
    expect(text).toContain('Current deadline');
  });
  it('creates a valid import template for this company', () => {
    const rows = parseTaskCSV(createTaskCSVTemplate(data), data);
    expect(rows).toHaveLength(1);
    expect(rows[0].departmentId).toBeTruthy();
  });
});

it('round-trips a timed commitment with its absolute instant and timezone',()=>{
 const task={...data.tasks[0],deadlineMode:'timed' as const,dueDate:'2026-10-14',dueAt:'2026-10-14T10:30:00Z',dueTimezone:'Asia/Kolkata',originalDeadlineMode:'timed' as const,originalDueAt:'2026-10-14T10:30:00Z',originalDueTimezone:'Asia/Kolkata'};
 const imported=parseTaskCSV(exportTasksCSV([task],data),data)[0];
 expect(imported.deadlineMode).toBe('timed');expect(imported.dueAt).toBe(task.dueAt);expect(imported.dueTimezone).toBe(task.dueTimezone);expect(imported.dueDate).toBe(task.dueDate);
});
