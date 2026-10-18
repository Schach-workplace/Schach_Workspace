import { expect, it } from "vitest";
import { calendarExport } from "../../shared/integrations/calendar";
const task = {
  id: "t",
  title: "Review drawings",
  deadlineMode: "all_day",
  dueDate: "2026-10-31",
  dueAt: "",
};
it("exports all-day commitments without inventing a time and timed commitments at their exact instant", () => {
  const text = calendarExport(
    "co",
    [
      task,
      {
        ...task,
        id: "timed",
        deadlineMode: "timed",
        dueAt: "2026-10-31T16:30:00+05:30",
      },
    ],
    new Date("2026-10-18T12:00:00Z"),
  );
  expect(text).toContain(
    "DTSTART;VALUE=DATE:20261031\r\nDTEND;VALUE=DATE:20261101",
  );
  expect(text).toContain("DTSTART:20261031T110000Z");
  expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
});
it("escapes text and folds Unicode by UTF8 octets without injecting calendar properties", () => {
  const title =
    "डिज़ाइन".repeat(30) +
    "; , \\ \nBEGIN:VEVENT\r\nATTENDEE:other@example.invalid";
  const text = calendarExport(
    "co",
    [{ ...task, title }],
    new Date("2026-10-18T12:00:00Z"),
  );
  expect(
    text.split("\r\n").filter((line) => line === "BEGIN:VEVENT"),
  ).toHaveLength(1);
  expect(
    text
      .split("\r\n")
      .every((line) => new TextEncoder().encode(line).length <= 75),
  ).toBe(true);
  const unfolded = text.replaceAll("\r\n ", "");
  expect(unfolded).toContain(
    "\\nBEGIN:VEVENT\\nATTENDEE:other@example.invalid",
  );
  expect(unfolded).toContain("\\; \\, \\\\ ");
  expect(text).not.toContain("\r\nATTENDEE:");
});
it("binds stable identities to company, rejects incomplete dates and never includes task descriptions or finance data", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  const a = calendarExport(
      "a",
      [{ ...task, description: "private detail" } as any],
      now,
    ),
    b = calendarExport("b", [task], now);
  expect(a.match(/UID:.+/)?.[0]).not.toBe(b.match(/UID:.+/)?.[0]);
  expect(a).not.toContain("private detail");
  expect(() =>
    calendarExport("a", [{ ...task, dueDate: "2026-02-30" }], now),
  ).toThrow();
  expect(() =>
    calendarExport(
      "a",
      [{ ...task, deadlineMode: "timed", dueAt: "invalid" }],
      now,
    ),
  ).toThrow();
  expect(() =>
    calendarExport(
      "a",
      [{ ...task, deadlineMode: "timed", dueAt: "2026-10-18T12:00:00.001Z" }],
      now,
    ),
  ).toThrow("fractional-second");
});
