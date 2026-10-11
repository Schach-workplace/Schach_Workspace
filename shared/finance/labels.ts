/** Presentation only: mapping keys and submitted values remain the API contract. */
export const statementLabels: Record<string, string> = {
  headerRow: "Header row",
  delimiter: "Delimiter",
  dateFormat: "Date format",
  amountMode: "Amount format",
  decimalSeparator: "Decimal separator",
  groupingSeparator: "Grouping separator",
  dateColumn: "Date column",
  signedAmountColumn: "Amount column",
  debitColumn: "Debit column",
  creditColumn: "Credit column",
  referenceColumn: "Reference column",
  descriptionColumn: "Description column",
  currencyColumn: "Currency column",
};
export const expenseLabels = {
  vendor: "Vendor",
  amount: "Amount",
  currency: "Currency",
  expenseDate: "Expense date",
} as const;
