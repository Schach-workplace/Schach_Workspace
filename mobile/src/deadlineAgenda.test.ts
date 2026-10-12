import { expect, it } from "vitest";
import { agendaPath, groupAgenda, type AgendaTask } from "./deadlineAgenda";
const task = (over: Partial<AgendaTask>): AgendaTask => ({
  id: "t",
  title: "Task",
  status: "todo",
  ownerId: "o",
  dueDate: "",
  deadlineMode: "all_day",
  dueAt: "",
  ...over,
});
it("requests the same bounded open-work calendar as the web", () => {
  expect(agendaPath("2026-10-11", "2026-11-07")).toBe(
    "/planning/calendar?from=2026-10-11&to=2026-11-07&departmentId=&ownerId=&openOnly=true",
  );
});
it("groups deadlines by company-local day with timed work in company time", () => {
  const groups = groupAgenda(
    [
      task({ id: "b", title: "Later all-day", dueDate: "2026-10-13" }),
      // 20:00Z on the 11th is already the 12th in Asia/Kolkata.
      task({
        id: "late",
        title: "Timed",
        deadlineMode: "timed",
        dueAt: "2026-10-11T20:00:00Z",
        dueDate: "2026-10-12",
      }),
      task({ id: "a", title: "All-day", dueDate: "2026-10-12" }),
      task({ id: "bad", deadlineMode: "timed", dueAt: "not a date" }),
    ],
    "Asia/Kolkata",
  );
  expect(groups.map((g) => g.date)).toEqual(["2026-10-12", "2026-10-13"]);
  expect(groups[0].rows.map((r) => [r.task.id, r.time])).toEqual([
    ["a", ""],
    ["late", "01:30"],
  ]);
});
