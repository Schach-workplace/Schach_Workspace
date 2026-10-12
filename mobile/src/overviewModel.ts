import { companyDate, shiftDate } from "./workDates";
// Read-only projection of the same bootstrap + scoped /tasks data the browser
// Overview uses. Nothing here grants access: it only summarizes what the
// server already returned for the current role.
export interface OverviewTask {
  id: string;
  title: string;
  status: string;
  ownerId: string;
  departmentId?: string;
  projectId?: string;
  deadlineMode: string;
  dueDate: string;
  dueAt: string;
  originalDueDate?: string;
  completedAt?: string;
}
export interface OverviewSource {
  tasks: OverviewTask[];
  departments: { id: string; name: string }[];
  people: { id: string; name: string; active?: boolean; departmentId?: string }[];
  projects?: {
    id: string;
    name: string;
    status: string;
    departmentId?: string;
    ownerId?: string;
  }[];
  activities?: {
    id: string;
    userId: string;
    taskId?: string;
    action: string;
    detail: string;
    createdAt: string;
  }[];
  me: { role: string };
  company: { timezone: string };
}
export const isOpen = (t: Pick<OverviewTask, "status">) =>
  !["done", "cancelled"].includes(t.status);
export function isOverdue(t: OverviewTask, date: string, now: number) {
  return (
    isOpen(t) &&
    (t.deadlineMode === "timed"
      ? !!t.dueAt && now > Date.parse(t.dueAt)
      : !!t.dueDate && t.dueDate < date)
  );
}
export const percent = (done: number, total: number) =>
  total ? Math.round((done / total) * 100) : 0;
// Members are routed to their own work in the browser; Overview is a
// leadership/viewer surface. The API still decides what each role sees.
export const overviewAvailable = (role: string) => role !== "member";
export function overview(data: OverviewSource, now = new Date()) {
  const zone = data.company.timezone;
  const date = companyDate(now, zone);
  const at = now.getTime();
  const tasks = data.tasks;
  const overdue = tasks.filter((t) => isOverdue(t, date, at));
  const blocked = tasks.filter((t) => t.status === "blocked");
  const review = tasks.filter((t) => t.status === "in_review");
  const soon = tasks.filter(
    (t) =>
      isOpen(t) &&
      !!t.dueDate &&
      t.dueDate >= date &&
      t.dueDate <= shiftDate(date, 7),
  );
  const completed = tasks.filter(
    (t) => t.status === "done" && t.completedAt && t.originalDueDate,
  );
  const ontime = completed.filter(
    (t) => companyDate(new Date(t.completedAt!), zone) <= t.originalDueDate!,
  );
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(date, i - 6));
  const pulse = days.map((day) => ({
    day,
    accepted: tasks.filter(
      (t) =>
        t.status === "done" &&
        !!t.completedAt &&
        companyDate(new Date(t.completedAt), zone) === day,
    ).length,
  }));
  const activeProjects = (data.projects ?? []).filter(
    (p) => p.status === "active",
  );
  const attention = tasks.filter(
    (t) => isOverdue(t, date, at) || ["blocked", "in_review"].includes(t.status),
  );
  return {
    date,
    cards: [
      {
        title: "Open commitments",
        value: String(tasks.filter(isOpen).length),
        detail: `Across ${activeProjects.length} active projects`,
      },
      {
        title: "Overdue tasks",
        value: String(overdue.length),
        detail: overdue.length
          ? `${new Set(overdue.map((t) => t.ownerId)).size} owners need attention`
          : "All current deadlines are clear",
      },
      {
        title: "Awaiting review",
        value: String(review.length),
        detail: review.length ? "Ready for a decision" : "No pending decisions",
      },
      {
        title: "On-time acceptance",
        value: completed.length
          ? `${percent(ontime.length, completed.length)}%`
          : "—",
        detail: `${ontime.length} of ${completed.length} accepted · original deadline`,
      },
    ],
    focus: { overdue, blocked, review, soon },
    attention,
    pulse,
    departments: data.departments.map((d) => {
      const own = tasks.filter(
        (t) => t.departmentId === d.id && t.status !== "cancelled",
      );
      return {
        id: d.id,
        name: d.name,
        open: own.filter(isOpen).length,
        overdue: own.filter((t) => isOverdue(t, date, at)).length,
        accepted: own.filter((t) => t.status === "done").length,
        total: own.length,
      };
    }),
    projects: activeProjects.map((p) => {
      const own = tasks.filter(
        (t) => t.projectId === p.id && t.status !== "cancelled",
      );
      return {
        id: p.id,
        name: p.name,
        risk: own.filter(
          (t) => t.status === "blocked" || isOverdue(t, date, at),
        ).length,
        accepted: own.filter((t) => t.status === "done").length,
        total: own.length,
      };
    }),
    activities: (data.activities ?? [])
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8),
  };
}
