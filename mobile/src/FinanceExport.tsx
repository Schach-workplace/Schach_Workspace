import { useState } from "react";
import { FlatList, Text } from "react-native";
import { Action, Sheet, ui } from "./ConnectUI";
import ReviewedFileExport from "./ReviewedFileExport";
import {
  expenseCsv,
  type ExpenseExportRow,
} from "../../shared/integrations/expenseCsv";
export default function FinanceExport({
  expenses,
  onClose,
}: {
  expenses: { id: string; version: number; title: string }[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(() =>
      expenses.slice(0, 100).map((e) => e.id),
    ),
    [review, setReview] = useState(false);
  if (review)
    return (
      <ReviewedFileExport<{ rows: ExpenseExportRow[] }>
        title="Reviewed expense CSV"
        path="/finance/expense-export"
        input={{
          expenses: expenses
            .filter((e) => selected.includes(e.id))
            .map((e) => ({ id: e.id, expectedVersion: e.version })),
        }}
        fileName="workspace-expenses.csv"
        description="Export expense code, title, date, currency, exact amount in minor units and current status. This does not approve, pay or synchronize an accounting system."
        signature={(d) => d.rows.map((r) => r.id + ":" + r.version).join("|")}
        summarize={(d) =>
          d.rows.map(
            (r) =>
              r.title +
              " · " +
              r.currency +
              " " +
              r.amountMinor +
              " minor units · " +
              r.status,
          )
        }
        serialize={(d) => expenseCsv(d.rows)}
        options={{
          mimeType: "text/csv",
          UTI: "public.comma-separated-values-text",
          dialogTitle: "Share reviewed expense CSV",
        }}
        onClose={onClose}
      />
    );
  return (
    <Sheet title="Choose expenses to export" onClose={onClose} scroll={false}>
      <Text style={ui.body}>
        Choose up to 100 expenses from the current Finance view.{" "}
        {expenses.length > 100
          ? "The first 100 are initially selected. Narrow the status filter or choose a smaller batch."
          : "All shown expenses are initially selected."}
      </Text>
      <Text style={ui.name}>{selected.length} selected</Text>
      <Action title="Clear expense selection" onPress={() => setSelected([])} />
      <FlatList
        data={expenses}
        keyExtractor={(e) => e.id}
        style={{ flex: 1 }}
        renderItem={({ item: e }) => (
          <Action
            title={(selected.includes(e.id) ? "✓ " : "") + e.title}
            selected={selected.includes(e.id)}
            disabled={!selected.includes(e.id) && selected.length >= 100}
            onPress={() =>
              setSelected((s) =>
                s.includes(e.id) ? s.filter((id) => id !== e.id) : [...s, e.id],
              )
            }
          />
        )}
      />
      <Action
        title="Review expense export"
        primary
        disabled={!selected.length}
        onPress={() => setReview(true)}
      />
    </Sheet>
  );
}
