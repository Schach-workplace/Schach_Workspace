/** Standards-file adapter only. Amounts remain exact integer strings; currencies stay separate. */
export interface ExpenseExportRow {
  id: string;
  version: number;
  code: string;
  title: string;
  expenseDate: string;
  currency: string;
  amountMinor: string;
  status: string;
}
const quote = (value: string) => {
  // Spreadsheet formula evaluation can skip leading whitespace and controls.
  const dangerous =
    /^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(value) ||
    /^[\s\u0000-\u001f\u007f]*[\t\r]/u.test(value);
  return '"' + (dangerous ? "'" + value : value).replaceAll('"', '""') + '"';
};
export function expenseCsv(rows: readonly ExpenseExportRow[]): string {
  if (rows.length > 10000) throw Error("Export allows at most 10,000 rows.");
  const lines = [
    [
      "Expense code",
      "Title",
      "Expense date",
      "Currency",
      "Amount (minor units)",
      "Status",
    ]
      .map(quote)
      .join(","),
  ];
  for (const row of rows) {
    if (
      typeof row.amountMinor !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(row.amountMinor)
    )
      throw Error("Amount must be a base10 nonnegative integer string.");
    lines.push(
      [
        row.code,
        row.title,
        row.expenseDate,
        row.currency,
        row.amountMinor,
        row.status,
      ]
        .map(quote)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
