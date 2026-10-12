// Task CSV import/export for the native Work screen. This is a faithful port
// of the browser's frontend/src/data/imports.ts (parseTaskCSV,
// createTaskCSVTemplate, exportTasksCSV) so a CSV behaves the same on both
// clients: the same columns, validation messages, row numbers, formula-safe
// quoting and the same `/tasks/import` row bodies. Keep them in sync.
import { NativeApiError } from "./client";
import type { WorkTask } from "./Workspace";

export interface TaskCsvPerson {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  departmentId: string;
}
export interface TaskCsvDirectory {
  me: TaskCsvPerson;
  company: { timezone: string };
  people: TaskCsvPerson[];
  // `headId` is part of the bootstrap department payload.
  departments: { id: string; name: string; headId?: string }[];
  projects: { id: string; name: string; departmentId?: string }[];
}
// The bootstrap/tasks payload carries the full task; the native WorkTask type
// declares only the fields other screens read.
export type TaskCsvTask = WorkTask &
  Partial<{
    priority: string;
    progress: number;
    estimatedHours: number;
    actualHours: number;
    completedAt: string;
    blockerReason: string;
    deadlineChangeReason: string;
  }>;
export interface TaskImportRow {
  title: string;
  description: string;
  ownerId: string;
  reviewerId: string;
  departmentId: string;
  projectId: string;
  parentId: string;
  priority: "critical" | "high" | "medium" | "low";
  status: "todo";
  dueDate: string;
  deadlineMode: "all_day" | "timed";
  dueAt: string;
  dueTimezone: string;
  startDate: string;
  estimatedHours: number;
  tags: string[];
  checklist: never[];
  dependencies: string[];
  collaborators: string[];
  recurrence: "none";
  requiresApproval: boolean;
}

function csvRows(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else field += c;
      continue;
    }
    if (c === '"') {
      if (field || closed)
        throw new Error(
          "CSV has a misplaced quote. Use the downloadable template.",
        );
      quoted = true;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      closed = false;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      field = "";
      closed = false;
      continue;
    }
    if (closed && !/\s/.test(c))
      throw new Error("CSV contains text after a closing quote.");
    if (!closed) field += c;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
function normalise(s: string) {
  return s.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function localDeadline(instant: string, zone: string): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (kind: string) => p.find((v) => v.type === kind)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
// Browser frontend/src/data/deadlines.ts validateDeadline (recurrence "none").
function validateDeadline(task: {
  deadlineMode: string;
  dueAt: string;
  dueTimezone: string;
  dueDate: string;
}) {
  if ((task.deadlineMode ?? "all_day") === "all_day") {
    if (task.dueAt || task.dueTimezone)
      throw new Error("All-day commitments cannot include a time.");
    return;
  }
  if (
    !task.dueAt ||
    !task.dueTimezone ||
    !Number.isFinite(Date.parse(task.dueAt)) ||
    localDeadline(task.dueAt, task.dueTimezone).slice(0, 10) !== task.dueDate
  )
    throw new Error("Choose a valid time, date and commitment timezone.");
}
export const maxTaskCsvBytes = 2_000_000;
export function parseTaskCSV(
  text: string,
  data: TaskCsvDirectory,
): TaskImportRow[] {
  if (text.length > maxTaskCsvBytes)
    throw new Error("CSV is too large. Import up to 200 tasks at a time.");
  const rows = csvRows(text);
  if (rows.length < 2)
    throw new Error("Add at least one task below the CSV header.");
  if (rows.length > 201)
    throw new Error("Import a maximum of 200 tasks at a time.");
  const header = rows[0].map(normalise);
  if (new Set(header).size !== header.length)
    throw new Error("Duplicate column names are not allowed.");
  if (!header.includes("title") || !header.includes("due date"))
    throw new Error("The CSV must include Title and Due date columns.");
  return rows.slice(1).map((r, i) => {
    const line = i + 2;
    const fail = (msg: string): never => {
      throw new Error(`Row ${line}: ${msg}`);
    };
    if (r.length !== header.length)
      fail(
        `expected ${header.length} columns, found ${r.length}. Quote commas inside text.`,
      );
    const get = (key: string) => r[header.indexOf(key)]?.trim() ?? "";
    const title = get("title");
    if (!title || title.length > 240)
      fail("Title must contain 1–240 characters.");
    const email = get("owner email").toLowerCase();
    const owner = email
      ? data.people.find((p) => p.email.toLowerCase() === email && p.active)
      : data.me;
    if (!owner)
      fail(`Owner email "${email}" is not an active person in this company.`);
    const ownerPerson = owner!;
    const name = get("department");
    const department = name
      ? data.departments.find((d) => normalise(d.name) === normalise(name))
      : data.departments.find((d) => d.id === ownerPerson.departmentId);
    if (!department)
      fail("Department is required and must match a department in this company.");
    const projectName = get("project");
    const project = projectName
      ? data.projects.find((p) => normalise(p.name) === normalise(projectName))
      : undefined;
    if (projectName && !project)
      fail(`Project "${projectName}" does not exist in this company.`);
    const dueDate = get("due date");
    if (!validDate(dueDate))
      fail("Due date must be a real date in YYYY-MM-DD format.");
    const deadlineMode = (get("deadline mode") || "all_day") as
      | "all_day"
      | "timed";
    const dueAt = get("due at");
    const dueTimezone = get("due timezone");
    try {
      validateDeadline({ deadlineMode, dueAt, dueTimezone, dueDate });
    } catch (error) {
      fail(error instanceof Error ? error.message : "Invalid deadline.");
    }
    const priority = (get("priority") || "medium").toLowerCase();
    if (!["critical", "high", "medium", "low"].includes(priority))
      fail("Priority must be critical, high, medium or low.");
    const hours = get("estimated hours");
    const estimatedHours = hours ? Number(hours) : 1;
    if (
      !Number.isFinite(estimatedHours) ||
      estimatedHours < 0 ||
      estimatedHours > 10000
    )
      fail("Estimated hours must be a number between 0 and 10,000.");
    let reviewerId = department!.headId;
    if (!reviewerId || reviewerId === ownerPerson.id)
      reviewerId =
        data.people.find(
          (p) =>
            ["ceo", "founder"].includes(p.role) &&
            p.id !== ownerPerson.id &&
            p.active,
        )?.id ?? "";
    return {
      title,
      description: get("description"),
      ownerId: ownerPerson.id,
      reviewerId,
      departmentId: department!.id,
      projectId: project?.id ?? "",
      parentId: "",
      priority: priority as TaskImportRow["priority"],
      status: "todo",
      dueDate,
      deadlineMode,
      dueAt,
      dueTimezone,
      startDate: "",
      estimatedHours,
      tags: [],
      checklist: [],
      dependencies: [],
      collaborators: [],
      recurrence: "none",
      requiresApproval: !!reviewerId,
    };
  });
}
function safeCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s﻿]*[=+\-@]/.test(text) || /^[\t\r]/.test(text))
    text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
function encode(rows: unknown[][]) {
  return (
    "﻿" + rows.map((row) => row.map(safeCell).join(",")).join("\r\n")
  );
}
function companyToday(timezone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
function addDays(value: string, days: number): string {
  const d = new Date(`${value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function createTaskCSVTemplate(
  data: TaskCsvDirectory,
  now = new Date(),
): string {
  const owner =
    data.people.find((p) => p.active && p.role === "member" && p.departmentId) ||
    data.people.find((p) => p.active && p.departmentId) ||
    data.me;
  const department =
    data.departments.find((d) => d.id === owner.departmentId) ||
    data.departments[0];
  const project = data.projects.find(
    (p) => p.departmentId === department?.id,
  );
  return encode([
    [
      "Title",
      "Description",
      "Owner email",
      "Department",
      "Project",
      "Due date",
      "Priority",
      "Estimated hours",
    ],
    [
      "Review the delivery checklist",
      "Define the expected outcome and acceptance evidence.",
      owner.email,
      department?.name ?? "",
      project?.name ?? "",
      addDays(companyToday(data.company.timezone, now), 3),
      "high",
      4,
    ],
  ]);
}
export function exportTasksCSV(
  tasks: TaskCsvTask[],
  data: TaskCsvDirectory,
): string {
  const person = (id: string) => data.people.find((p) => p.id === id)?.name ?? "";
  return encode([
    [
      "ID",
      "Title",
      "Department",
      "Project",
      "Owner",
      "Reviewer",
      "Status",
      "Priority",
      "Original deadline",
      "Current deadline",
      "Due date",
      "Deadline mode",
      "Due at",
      "Due timezone",
      "Original deadline mode",
      "Original due at",
      "Original due timezone",
      "Owner email",
      "Deadline change reason",
      "Progress %",
      "Estimated hours",
      "Actual hours",
      "Accepted at",
      "Description",
      "Blocker",
    ],
    ...tasks.map((t) => [
      t.code,
      t.title,
      data.departments.find((d) => d.id === t.departmentId)?.name ?? "",
      data.projects.find((p) => p.id === t.projectId)?.name ?? "",
      person(t.ownerId),
      person(t.reviewerId),
      t.status,
      t.priority,
      t.originalDueDate,
      t.dueDate,
      t.dueDate,
      t.deadlineMode ?? "all_day",
      t.dueAt ?? "",
      t.dueTimezone ?? "",
      t.originalDeadlineMode ?? "all_day",
      t.originalDueAt ?? "",
      t.originalDueTimezone ?? "",
      data.people.find((p) => p.id === t.ownerId)?.email ?? "",
      t.deadlineChangeReason,
      t.progress,
      t.estimatedHours,
      t.actualHours,
      t.completedAt,
      t.description,
      t.blockerReason,
    ]),
  ]);
}
// The server validates the whole import atomically and reports failing rows
// as 1-based positions in `rows`; show them as CSV lines (header is line 1),
// matching the numbering of the local preview errors above.
export function importRowErrors(error: unknown): string[] {
  return error instanceof NativeApiError
    ? error.rows.map((r) => `Row ${r.row + 1}: ${r.message}`)
    : [];
}
