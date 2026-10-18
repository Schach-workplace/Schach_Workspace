import { expect, it } from "vitest";
import { workFocusReasons } from "./workFocus";
const now = new Date("2026-10-18T19:00:00Z"); //19 October in India.
it("explains only current authorized task facts without changing priority, outcome or reviewer authority", () => {
  expect(
    workFocusReasons(
      { status: "todo", ownerId: "me", dueDate: "2026-10-19" },
      "me",
      "Asia/Kolkata",
      now,
    ),
  ).toEqual(["Your open work", "Due today"]);
  expect(
    workFocusReasons(
      { status: "blocked", ownerId: "other", dueDate: "" },
      "me",
      "Asia/Kolkata",
      now,
    ),
  ).toEqual(["Blocked"]);
  expect(
    workFocusReasons(
      { status: "in_review", ownerId: "other", dueDate: "" },
      "me",
      "Asia/Kolkata",
      now,
    ),
  ).toEqual(["Awaiting review"]);
  expect(
    workFocusReasons(
      { status: "done", ownerId: "me", dueDate: "2026-10-17" },
      "me",
      "Asia/Kolkata",
      now,
    ),
  ).toEqual([]);
});
it("compares timed deadlines at the original absolute instant, with company-local today only for upcoming dates", () => {
  const t = {
    status: "todo",
    ownerId: "other",
    deadlineMode: "timed",
    dueAt: now.toISOString(),
    dueDate: "2026-10-18",
  };
  expect(workFocusReasons(t, "me", "Asia/Kolkata", now)).toEqual(["Due today"]);
  expect(
    workFocusReasons(t, "me", "Asia/Kolkata", new Date(now.getTime() + 1)),
  ).toEqual(["Deadline passed"]);
  expect(
    workFocusReasons({ ...t, dueAt: "invalid" }, "me", "Asia/Kolkata", now),
  ).toEqual([]);
});
