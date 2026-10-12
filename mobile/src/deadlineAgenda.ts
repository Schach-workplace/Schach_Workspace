import { companyDate, deadlineLocalTime } from "./workDates";
// Subset of frontend/src/data/planning.ts CalendarTask used by the agenda.
export interface AgendaTask {
  id: string;
  title: string;
  status: string;
  ownerId: string;
  dueDate: string;
  deadlineMode: string;
  dueAt: string;
  dueTimezone?: string;
}
export interface AgendaView {
  tasks: AgendaTask[];
  complete: boolean;
  timezone: string;
}
export const AGENDA_DAYS = 28;
/** Same query the web CalendarWorkload page sends (server caps at 84 days). */
export function agendaPath(from: string, to: string) {
  const query = new URLSearchParams({
    from,
    to,
    departmentId: "",
    ownerId: "",
    openOnly: "true",
  });
  return "/planning/calendar?" + query;
}
/** Company-local civil date of a deadline, mirroring web calendarTaskDate. */
export function agendaDate(t: AgendaTask, zone: string) {
  if (t.deadlineMode === "timed") {
    if (!t.dueAt || !Number.isFinite(Date.parse(t.dueAt))) return "";
    return companyDate(new Date(t.dueAt), zone);
  }
  return t.dueDate;
}
export function groupAgenda(tasks: AgendaTask[], zone: string) {
  const days = new Map<string, { task: AgendaTask; time: string }[]>();
  for (const task of tasks) {
    const date = agendaDate(task, zone);
    if (!date) continue;
    const time =
      task.deadlineMode === "timed" ? deadlineLocalTime(task.dueAt, zone) : "";
    days.set(date, [...(days.get(date) ?? []), { task, time }]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => ({
      date,
      // All-day commitments first, then by company-local time, then title.
      rows: rows.sort(
        (a, b) =>
          a.time.localeCompare(b.time) ||
          a.task.title.localeCompare(b.task.title),
      ),
    }));
}
