import { describe, expect, it, vi } from "vitest";
import {
  createTaskCSVTemplate,
  exportTasksCSV,
  importRowErrors,
  parseTaskCSV,
  type TaskCsvDirectory,
} from "./taskCsvModel";
import { NativeApiError } from "./client";
vi.mock("expo-secure-store", () => ({}));

const data: TaskCsvDirectory = {
  me: { id: "me", email: "me@x.co", departmentId: "d1", role: "member", active: true, name: "Me" },
  company: { timezone: "UTC" },
  people: [
    { id: "me", email: "me@x.co", departmentId: "d1", role: "member", active: true, name: "Me" },
    { id: "head", email: "head@x.co", departmentId: "d1", role: "head", active: true, name: "Head" },
    { id: "ceo", email: "ceo@x.co", departmentId: "", role: "ceo", active: true, name: "Chief" },
    { id: "old", email: "old@x.co", departmentId: "d1", role: "member", active: false, name: "Old" },
  ],
  departments: [{ id: "d1", name: "Design Ops", headId: "head" }],
  projects: [{ id: "p1", name: "Launch" }],
};

const header = "Title,Owner email,Department,Project,Due date,Priority,Estimated hours";

describe("parseTaskCSV mirrors the browser import", () => {
  it("builds the same create-task rows the browser sends", () => {
    const rows = parseTaskCSV(
      `﻿${header}\r\n"Ship, carefully",head@x.co,design_ops,launch,2026-10-20,HIGH,4\n` +
        `Quick fix,,,,2026-10-21,,\n`,
      data,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      title: "Ship, carefully",
      description: "",
      ownerId: "head",
      reviewerId: "ceo",
      departmentId: "d1",
      projectId: "p1",
      parentId: "",
      priority: "high",
      status: "todo",
      dueDate: "2026-10-20",
      deadlineMode: "all_day",
      dueAt: "",
      dueTimezone: "",
      startDate: "",
      estimatedHours: 4,
      tags: [],
      checklist: [],
      dependencies: [],
      collaborators: [],
      recurrence: "none",
      requiresApproval: true,
    });
    // Blank owner defaults to the current person; their department head reviews.
    expect(rows[1]).toMatchObject({
      ownerId: "me",
      reviewerId: "head",
      departmentId: "d1",
      priority: "medium",
      estimatedHours: 1,
    });
  });
  it.each([
    [`${header}\n`, "Add at least one task below the CSV header."],
    ["Title,Description\nA,B", "The CSV must include Title and Due date columns."],
    ["Title,Title,Due date\nA,A,2026-10-20", "Duplicate column names are not allowed."],
    [`${header}\nA,old@x.co,,,2026-10-20,,`, 'Row 2: Owner email "old@x.co" is not an active person in this company.'],
    [`${header}\nA,,,Nope,2026-10-20,,`, 'Row 2: Project "Nope" does not exist in this company.'],
    [`${header}\nA,,,,2026-02-30,,`, "Row 2: Due date must be a real date in YYYY-MM-DD format."],
    [`${header}\nA,,,,2026-10-20,urgent,`, "Row 2: Priority must be critical, high, medium or low."],
    [`${header}\nA,,,,2026-10-20,,lots`, "Row 2: Estimated hours must be a number between 0 and 10,000."],
    [`${header}\nA,,,,2026-10-20`, "Row 2: expected 7 columns, found 5. Quote commas inside text."],
    [`${header}\nA",,,,2026-10-20,,`, "CSV has a misplaced quote. Use the downloadable template."],
    [`${header}\n"A,,,,2026-10-20,,`, "CSV has an unclosed quoted field."],
  ])("rejects invalid CSV %#", (text, message) => {
    expect(() => parseTaskCSV(text, data)).toThrow(message);
  });
  it("limits an import to 200 tasks", () => {
    const body = Array.from({ length: 201 }, (_, i) => `T${i},,,,2026-10-20,,`).join("\n");
    expect(() => parseTaskCSV(`${header}\n${body}`, data)).toThrow(
      "Import a maximum of 200 tasks at a time.",
    );
  });
  it("validates timed deadlines against the due date like the browser", () => {
    const timed = "Title,Due date,Deadline mode,Due at,Due timezone";
    expect(
      parseTaskCSV(`${timed}\nA,2026-10-20,timed,2026-10-20T09:00:00Z,UTC`, data)[0],
    ).toMatchObject({ deadlineMode: "timed", dueAt: "2026-10-20T09:00:00Z", dueTimezone: "UTC" });
    expect(() =>
      parseTaskCSV(`${timed}\nA,2026-10-21,timed,2026-10-20T09:00:00Z,UTC`, data),
    ).toThrow("Row 2: Choose a valid time, date and commitment timezone.");
    expect(() => parseTaskCSV(`${timed}\nA,2026-10-21,,2026-10-20T09:00:00Z,UTC`, data)).toThrow(
      "Row 2: All-day commitments cannot include a time.",
    );
  });
});

describe("exportTasksCSV mirrors the browser export", () => {
  it("uses the browser columns, BOM, CRLF and formula-safe quoting", () => {
    const csv = exportTasksCSV(
      [
        {
          id: "t1",
          code: "T-1",
          title: "=HYPERLINK(1)",
          departmentId: "d1",
          projectId: "p1",
          ownerId: "me",
          reviewerId: "head",
          status: "todo",
          priority: "high",
          originalDueDate: "2026-10-19",
          dueDate: "2026-10-20",
          deadlineMode: "all_day",
          dueAt: "",
          dueTimezone: "",
          originalDueAt: "",
          description: 'Say "hi"',
          version: 1,
          requiresApproval: true,
          attachments: [],
          progress: 50,
          estimatedHours: 3,
          actualHours: 1,
        },
      ],
      data,
    );
    const [head, row, ...rest] = csv.split("\r\n");
    expect(rest).toEqual([]);
    expect(head.startsWith('﻿"ID","Title","Department","Project","Owner","Reviewer"')).toBe(true);
    expect(head.endsWith('"Description","Blocker"')).toBe(true);
    expect(head.split(",")).toHaveLength(25);
    expect(row).toBe(
      '"T-1","\'=HYPERLINK(1)","Design Ops","Launch","Me","Head","todo","high","2026-10-19","2026-10-20","2026-10-20","all_day","","","all_day","","","me@x.co","","50","3","1","","Say ""hi""",""',
    );
  });
  it("offers the browser template with the documented columns", () => {
    const [head, row] = createTaskCSVTemplate(data, new Date("2026-10-10T12:00:00Z")).split("\r\n");
    expect(head).toBe(
      '﻿"Title","Description","Owner email","Department","Project","Due date","Priority","Estimated hours"',
    );
    expect(row).toContain('"me@x.co","Design Ops",""');
    expect(row).toContain('"2026-10-13"');
  });
});

describe("importRowErrors", () => {
  it("maps server row errors (1-based data rows) to CSV line numbers", () => {
    const error = new NativeApiError(422, "invalid_import", "No rows were imported.", [
      { row: 1, message: "Owner is outside your scope." },
      { row: 3, message: "Reviewer must differ from owner." },
    ]);
    expect(importRowErrors(error)).toEqual([
      "Row 2: Owner is outside your scope.",
      "Row 4: Reviewer must differ from owner.",
    ]);
    expect(importRowErrors(Error("offline"))).toEqual([]);
  });
});
