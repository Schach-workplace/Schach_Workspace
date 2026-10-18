import { expect, it } from "vitest";
import {
  expenseCsv,
  type ExpenseExportRow,
} from "../../shared/integrations/expenseCsv";
const row: ExpenseExportRow = {
  id: "x",
  version: 1,
  code: "EXP-1",
  title: "Materials",
  expenseDate: "2026-10-18",
  currency: "INR",
  amountMinor: "900719925474099312345",
  status: "draft",
};
it("retains exact money, zero and currencies with stable CRLF columns", () => {
  const csv = expenseCsv([row, { ...row, currency: "USD", amountMinor: "0" }]);
  expect(csv).toContain('"900719925474099312345"');
  expect(csv).toContain('"USD","0"');
  expect(csv.split("\r\n")).toHaveLength(4);
  expect(csv.split("\r\n")[0]).toBe(
    '"Expense code","Title","Expense date","Currency","Amount (minor units)","Status"',
  );
});
it("quotes multiline and embedded quotes and neutralizes formulas after controls", () => {
  expect(expenseCsv([{ ...row, title: 'A "quoted"\nline' }])).toContain(
    '"A ""quoted""\nline"',
  );
  for (const title of [
    "=SUM(A1)",
    "  +1",
    "\u0001-2",
    " @x",
    "\tthing",
    "\rthing",
  ]) {
    expect(expenseCsv([{ ...row, title }])).toContain("\"'" + title + '"');
  }
});
it("rejects numeric amounts, exponent notation, signs, decimals and excessive rows", () => {
  for (const amountMinor of ["1e3", "1.2", "-1", "+1", "01", 123 as any])
    expect(() => expenseCsv([{ ...row, amountMinor }])).toThrow();
  expect(() => expenseCsv(Array(10001).fill(row))).toThrow();
});
