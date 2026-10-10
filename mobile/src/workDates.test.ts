import { expect, it } from "vitest";
import { companyDate, shiftDate, workDeadline } from "./workDates";
it("uses company date and safe date shortcuts across UTC midnight/month end", () => {
  expect(companyDate(new Date("2026-10-10T20:00:00Z"), "Asia/Kolkata")).toBe(
    "2026-10-11",
  );
  expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
  expect(workDeadline("2026-10-11", "", "Asia/Kolkata")).toEqual({
    dueDate: "2026-10-11",
    deadlineMode: "all_day",
    dueAt: "",
    dueTimezone: "",
  });
});
it("converts a local company time without requiring an RFC3339 entry", () => {
  expect(workDeadline("2026-10-11", "16:00", "Asia/Kolkata")).toEqual({
    dueDate: "2026-10-11",
    deadlineMode: "timed",
    dueAt: "2026-10-11T10:30:00.000Z",
    dueTimezone: "Asia/Kolkata",
  });
  for (const [date, time] of [
    ["2026-02-30", "16:00"],
    ["2026-10-11", "25:01"],
    ["invalid", ""],
  ])
    expect(() => workDeadline(date, time, "Asia/Kolkata")).toThrow();
});
it("rejects a daylight-saving gap and requires explicit selection in a fold", () => {
  expect(() => workDeadline("2026-03-08", "02:30", "America/New_York")).toThrow(
    /does not exist/,
  );
  expect(() => workDeadline("2026-11-01", "01:30", "America/New_York")).toThrow(
    /twice/,
  );
  expect(
    workDeadline(
      "2026-11-01",
      "01:30",
      "America/New_York",
      "2026-11-01T06:30:00.000Z",
    ).dueAt,
  ).toBe("2026-11-01T06:30:00.000Z");
  expect(() =>
    workDeadline(
      "2026-11-01",
      "01:30",
      "America/New_York",
      "2026-11-01T07:30:00.000Z",
    ),
  ).toThrow();
});
