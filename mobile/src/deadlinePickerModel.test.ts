import { expect, it } from "vitest";
import { pickerFields, pickerInstant } from "./deadlinePickerModel";
it("extracts company calendar fields across device midnight", () => {
  expect(
    pickerFields(new Date("2026-10-11T20:00:00Z"), "Asia/Kolkata"),
  ).toEqual({ date: "2026-10-12", time: "01:30" });
  expect(
    pickerFields(new Date("2026-10-12T02:00:00Z"), "America/Los_Angeles"),
  ).toEqual({ date: "2026-10-11", time: "19:00" });
});
it("initializes the system date in company time rather than UTC or device fields", () => {
  expect(
    pickerInstant("2026-10-12", "16:00", "Asia/Kolkata").toISOString(),
  ).toBe("2026-10-12T10:30:00.000Z");
  expect(() => pickerFields(new Date(), "invalid/zone")).toThrow();
});
