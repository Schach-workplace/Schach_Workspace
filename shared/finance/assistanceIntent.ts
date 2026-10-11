import { parseExactMoney } from "./money";
export interface FinanceIntake {
  id: string;
  purpose: "receipt" | "statement";
  state: string;
  version: number;
  fileName: string;
  size: number;
  expiresAt: string;
  destinationDepartmentId?: string;
}
export interface ReceiptJob {
  id: string;
  status: string;
  version: number;
  sourceKind: "intake" | "expense_receipt";
  sourceId: string;
  sourceVersion: number;
  destinationDepartmentId: string;
  targetExpenseId?: string;
  targetVersion?: number;
  errorCode?: string;
}
export interface ReceiptResult {
  id: string;
  revision: number;
  engine: string;
  engineVersion: string;
  language: string;
  candidates: { fields: Record<string, string[]>; unresolved: string[] };
  acceptanceId?: string;
}
export interface ReceiptExtraction {
  job: ReceiptJob;
  result: ReceiptResult | null;
}
export interface ReviewedFinanceDraft {
  title: string;
  vendor: string;
  invoiceNumber: string;
  expenseDate: string;
  amount: string;
  departmentId: string;
  categoryId: string;
  description: string;
  projectId: string;
  taskId: string;
  receiptExceptionReason: string;
}
export const blankFinanceDraft = (): ReviewedFinanceDraft => ({
  title: "",
  vendor: "",
  invoiceNumber: "",
  expenseDate: "",
  amount: "",
  departmentId: "",
  categoryId: "",
  description: "",
  projectId: "",
  taskId: "",
  receiptExceptionReason: "",
});
export function reviewedReceiptIntent(
  source: ReceiptExtraction,
  draft: ReviewedFinanceDraft,
  copyEvidence: boolean,
  confirmed: string[],
) {
  if (
    !source.result ||
    !draft.title.trim() ||
    !draft.vendor.trim() ||
    !draft.expenseDate ||
    !draft.categoryId ||
    draft.departmentId !== source.job.destinationDepartmentId
  )
    throw Error(
      "Explicitly review title, vendor, date, department, category and exact amount.",
    );
  if (
    source.result.candidates.unresolved.some(
      (token) => !confirmed.includes(token),
    )
  )
    throw Error("Confirm every displayed uncertainty.");
  const { amount, ...fields } = draft;
  return {
    expectedResultRevision: source.result.revision,
    sourceKind: source.job.sourceKind,
    sourceId: source.job.sourceId,
    destinationDepartmentId: draft.departmentId,
    ...(source.job.targetExpenseId
      ? {
          targetExpenseId: source.job.targetExpenseId,
          expectedTargetVersion: source.job.targetVersion,
        }
      : {}),
    copyEvidence,
    fields: { ...fields, amountMinor: parseExactMoney(amount) },
    confirmedUncertainties: confirmed,
  };
}
export interface FinanceDuplicate {
  id: string;
  sourceKind: "expense" | "extraction";
  sourceId: string;
  sourceVersion: number;
  comparedExpenseId: string;
  comparedVersion: number;
  reason: string;
  state: string;
  version: number;
}
export interface StatementMapping {
  headerRow: boolean;
  delimiter: "comma" | "semicolon" | "tab";
  dateColumn: number;
  dateFormat: "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY";
  referenceColumn?: number;
  descriptionColumn?: number;
  currencyColumn?: number;
  amountMode: "signed" | "debit_credit";
  signedAmountColumn?: number;
  debitColumn?: number;
  creditColumn?: number;
  debitSign: "negative";
  decimalSeparator: "dot" | "comma";
  groupingSeparator: "none" | "comma" | "dot" | "space";
}
export interface StatementTotals {
  debit: string;
  credit: string;
  net: string;
}
export interface StatementRow {
  id: string;
  importId: string;
  recordOrdinal: number;
  bookedDate: string;
  currency: string;
  signedAmountMinor: number;
  reference: string;
  description: string;
  version: number;
  reviewedCells: string[];
}
export interface StatementImport {
  id: string;
  rowCount: number;
  version: number;
  totals: StatementTotals;
  createdAt: string;
}
export interface StatementPreview {
  preview: {
    id: string;
    revision: number;
    mapping: StatementMapping;
    totals: StatementTotals;
    errors: { row: number; message: string }[];
    importId?: string;
  };
  rows: StatementRow[];
  rowCount: number;
  hasMore: boolean;
  nextOffset: number;
}
export interface ReconciliationAllocation {
  id: string;
  rowId: string;
  expenseId: string;
  active: boolean;
  version: number;
  reason: string;
  amountMinor: number;
}
export interface ReconciliationRead {
  items: {
    row: StatementRow;
    suggestions: {
      expenseId: string;
      expenseVersion: number;
      reason: string;
    }[];
    suggestionBasis: string;
    history: { action: string; reason: string }[];
  }[];
  unallocatedExpenses: {
    id: string;
    title: string;
    version: number;
    amountMinor: number;
    currency: string;
  }[];
  allocations: ReconciliationAllocation[];
  cursor: string;
  hasMore: boolean;
  method: string;
}
export interface StatementMappingChoices {
  headerRow: string;
  delimiter: string;
  dateColumn: string;
  dateFormat: string;
  referenceColumn: string;
  descriptionColumn: string;
  currencyColumn: string;
  amountMode: string;
  signedAmountColumn: string;
  debitColumn: string;
  creditColumn: string;
  decimalSeparator: string;
  groupingSeparator: string;
}
export const blankStatementMapping = (): StatementMappingChoices => ({
  headerRow: "",
  delimiter: "",
  dateColumn: "",
  dateFormat: "",
  referenceColumn: "",
  descriptionColumn: "",
  currencyColumn: "",
  amountMode: "",
  signedAmountColumn: "",
  debitColumn: "",
  creditColumn: "",
  decimalSeparator: "",
  groupingSeparator: "",
});
export function statementMapping(v: StatementMappingChoices): StatementMapping {
  const column = (s: string) => {
    if (!/^(?:[1-9]|[12]\d|3[0-2])$/.test(s))
      throw Error("Choose existing columns numbered 1–32.");
    return Number(s) - 1;
  };
  if (
    !["yes", "no"].includes(v.headerRow) ||
    !["comma", "semicolon", "tab"].includes(v.delimiter) ||
    !["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"].includes(v.dateFormat) ||
    !["signed", "debit_credit"].includes(v.amountMode) ||
    !["dot", "comma"].includes(v.decimalSeparator) ||
    !["none", "comma", "dot", "space"].includes(v.groupingSeparator)
  )
    throw Error(
      "Explicitly choose the file header, delimiter, date, amount and separator mapping.",
    );
  return {
    headerRow: v.headerRow === "yes",
    delimiter: v.delimiter as StatementMapping["delimiter"],
    dateColumn: column(v.dateColumn),
    dateFormat: v.dateFormat as StatementMapping["dateFormat"],
    amountMode: v.amountMode as StatementMapping["amountMode"],
    ...(v.amountMode === "signed"
      ? { signedAmountColumn: column(v.signedAmountColumn) }
      : {
          debitColumn: column(v.debitColumn),
          creditColumn: column(v.creditColumn),
        }),
    ...(v.referenceColumn
      ? { referenceColumn: column(v.referenceColumn) }
      : {}),
    ...(v.descriptionColumn
      ? { descriptionColumn: column(v.descriptionColumn) }
      : {}),
    ...(v.currencyColumn ? { currencyColumn: column(v.currencyColumn) } : {}),
    decimalSeparator:
      v.decimalSeparator as StatementMapping["decimalSeparator"],
    groupingSeparator:
      v.groupingSeparator as StatementMapping["groupingSeparator"],
    debitSign: "negative",
  };
}
