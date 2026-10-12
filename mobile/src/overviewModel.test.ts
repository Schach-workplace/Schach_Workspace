import { describe, expect, it } from "vitest";
import { overview, overviewAvailable, type OverviewTask } from "./overviewModel";
const now = new Date("2026-10-12T06:00:00Z"); // 11:30 in Asia/Kolkata
const task = (p: Partial<OverviewTask>): OverviewTask => ({
  id: "t",
  title: "T",
  status: "todo",
  ownerId: "u",
  deadlineMode: "all_day",
  dueDate: "",
  dueAt: "",
  ...p,
});
const source = (tasks: OverviewTask[]) => ({
  tasks,
  departments: [{ id: "d", name: "Design" }],
  people: [{ id: "u", name: "Una" }],
  projects: [
    { id: "p", name: "Tower", status: "active" },
    { id: "q", name: "Old", status: "completed" },
  ],
  activities: [
    { id: "a1", userId: "u", action: "created", detail: "", createdAt: "2026-10-10T00:00:00Z" },
    { id: "a2", userId: "u", action: "accepted", detail: "", createdAt: "2026-10-11T00:00:00Z" },
  ],
  me: { role: "admin" },
  company: { timezone: "Asia/Kolkata" },
});
describe("native Overview projection", () => {
  it("counts open, overdue (date and timed), review and on-time acceptance like the browser", () => {
    const v = overview(
      source([
        task({ id: "1", dueDate: "2026-10-11", departmentId: "d", projectId: "p" }),
        task({ id: "2", deadlineMode: "timed", dueAt: "2026-10-12T05:00:00Z", ownerId: "v" }),
        task({ id: "3", deadlineMode: "timed", dueAt: "2026-10-12T07:00:00Z" }),
        task({ id: "4", status: "in_review", dueDate: "2026-10-15" }),
        task({ id: "5", status: "done", completedAt: "2026-10-11T20:00:00Z", originalDueDate: "2026-10-12", departmentId: "d", projectId: "p" }),
        task({ id: "6", status: "done", completedAt: "2026-10-10T20:00:00Z", originalDueDate: "2026-10-10" }),
        task({ id: "7", status: "cancelled", dueDate: "2026-10-01" }),
      ]),
      now,
    );
    expect(v.date).toBe("2026-10-12");
    expect(v.cards.map((c) => c.value)).toEqual(["4", "2", "1", "50%"]);
    expect(v.cards[1].detail).toBe("2 owners need attention");
    expect(v.focus.soon.map((t) => t.id)).toEqual(["4"]);
    expect(v.attention.map((t) => t.id)).toEqual(["1", "2", "4"]);
    // 5 was accepted 2026-10-12 01:30 local; 6 on 2026-10-11 01:30 local.
    expect(v.pulse.at(-1)).toEqual({ day: "2026-10-12", accepted: 1 });
    expect(v.pulse.at(-2)).toEqual({ day: "2026-10-11", accepted: 1 });
    expect(v.departments).toEqual([
      { id: "d", name: "Design", open: 1, overdue: 1, accepted: 1, total: 2 },
    ]);
    expect(v.projects).toEqual([
      { id: "p", name: "Tower", risk: 1, accepted: 1, total: 2 },
    ]);
    expect(v.activities.map((a) => a.id)).toEqual(["a2", "a1"]);
  });
  it("shows an empty, non-invented state when the API returns nothing", () => {
    const v = overview({ ...source([]), projects: undefined, activities: undefined }, now);
    expect(v.cards.map((c) => c.value)).toEqual(["0", "0", "0", "—"]);
    expect(v.projects).toEqual([]);
    expect(v.activities).toEqual([]);
  });
  it("mirrors the browser: members do not get the leadership overview", () => {
    expect(overviewAvailable("member")).toBe(false);
    for (const role of ["founder", "ceo", "admin", "head", "viewer", "finance"])
      expect(overviewAvailable(role)).toBe(true);
  });
});
