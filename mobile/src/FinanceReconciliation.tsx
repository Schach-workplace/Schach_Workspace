import { useState } from "react";
import { FlatList, Text, TextInput, View } from "react-native";
import { styles, useWorkspace } from "./Workspace";
import { Sheet, Action } from "./ConnectUI";
import { useRamInput } from "./ramInput";
import { useExecutionRead, useExecutionMutation } from "./execution";
import type {
  ReconciliationRead,
  StatementImport,
} from "../../shared/finance/assistanceIntent";
import { formatExactMoney } from "../../shared/finance/money";
function RowDecision({
  item,
  expenses,
  onClose,
  onChanged,
}: {
  item: ReconciliationRead["items"][number];
  expenses: ReconciliationRead["unallocatedExpenses"];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [reason, setReason] = useRamInput(
    "$bank-row:" + item.row.id,
    "reason",
    "",
  );
  const [selected, setSelected] = useRamInput(
    "$bank-row:" + item.row.id,
    "selected",
    "",
  );
  const m = useExecutionMutation("$bank-row:" + item.row.id, [
    "/finance/statement-imports/" + item.row.importId,
  ]);
  const expense = expenses.find((e) => e.id === selected);
  return (
    <Sheet
      title="Review full recorded-payment association"
      onClose={onClose}
      busy={m.busy}
    >
      <Text>
        Record {item.row.recordOrdinal} · {item.row.bookedDate} ·{" "}
        {formatExactMoney(item.row.signedAmountMinor, item.row.currency)} ·{" "}
        {item.row.reference}
      </Text>
      <Text>
        Choose one already paid expense deliberately. This records an
        association without paying or editing expenses.
      </Text>
      {expenses.map((e) => (
        <Action
          key={e.id}
          title={e.title + " · " + formatExactMoney(e.amountMinor, e.currency)}
          selected={selected === e.id}
          disabled={!!m.attempt || m.busy}
          onPress={() => setSelected(e.id)}
        />
      ))}
      {item.suggestions.map((s) => (
        <Text key={s.expenseId}>
          {expenses.find((e) => e.id === s.expenseId)?.title ??
            "Recorded paid expense"}{" "}
          · {s.reason.replaceAll("_", " ")}
        </Text>
      ))}
      <TextInput
        style={styles.input}
        accessibilityLabel="Accounting review reason"
        placeholder="Accounting review reason (12 characters minimum)"
        editable={!m.attempt && !m.busy}
        value={reason}
        onChangeText={setReason}
      />
      <Action
        title="Match full recorded payment"
        disabled={
          (!expense && !m.attempt) ||
          m.busy ||
          reason.trim().length < 12 ||
          (!!m.attempt &&
            m.attempt.target?.path !== "/finance/reconciliation/matches")
        }
        onPress={() =>
          void m
            .execute(
              "/finance/reconciliation/matches",
              m.attempt?.payload ?? {
                rowId: item.row.id,
                expectedRowVersion: item.row.version,
                expenseId: expense!.id,
                expectedExpenseVersion: expense!.version,
                reason,
              },
            )
            .then(onChanged)
            .catch(() => {})
        }
      />
      <Action
        title="Record discrepancy / dismiss suggestion"
        disabled={
          m.busy ||
          reason.trim().length < 12 ||
          (!!m.attempt &&
            m.attempt.target?.path !==
              "/finance/reconciliation/rows/" + item.row.id + "/dismiss")
        }
        onPress={() =>
          void m
            .execute(
              "/finance/reconciliation/rows/" + item.row.id + "/dismiss",
              m.attempt?.payload ?? {
                expectedRowVersion: item.row.version,
                suggestionBasis: item.suggestionBasis,
                reason,
              },
            )
            .then(onChanged)
            .catch(() => {})
        }
      />
      {item.history.map((h, i) => (
        <Text key={i}>
          {h.action}: {h.reason}
        </Text>
      ))}
      <Text accessibilityRole="alert">{m.error}</Text>
      {m.attempt && (
        <Text>Confirmation unavailable. Retry the same frozen decision.</Text>
      )}
    </Sheet>
  );
}
function Reverse({
  allocation,
  onClose,
  onChanged,
}: {
  allocation: ReconciliationRead["allocations"][number];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [reason, setReason] = useRamInput(
    "$allocation:" + allocation.id,
    "reason",
    "",
  );
  const m = useExecutionMutation("$unmatch:" + allocation.id);
  return (
    <Sheet title="Review association reversal" onClose={onClose} busy={m.busy}>
      <Text>{allocation.reason}</Text>
      <TextInput
        accessibilityLabel="Reversal reason"
        style={styles.input}
        value={reason}
        editable={!m.attempt && !m.busy}
        onChangeText={setReason}
      />
      <Action
        title="Unmatch reviewed association"
        disabled={m.busy || reason.trim().length < 12}
        onPress={() =>
          void m
            .execute(
              "/finance/reconciliation/matches/" + allocation.id + "/unmatch",
              m.attempt?.payload ?? {
                expectedVersion: allocation.version,
                reason,
              },
            )
            .then(onChanged)
            .catch(() => {})
        }
      />
      <Text accessibilityRole="alert">{m.error}</Text>
    </Sheet>
  );
}
export default function FinanceReconciliation({
  onClose,
  initialImport = "",
  initialRow = "",
}: {
  onClose: () => void;
  initialImport?: string;
  initialRow?: string;
}) {
  const w = useWorkspace();
  const [importId, setImport] = useState(initialImport);
  const [state, setState] = useState("all");
  const [selected, setSelected] = useState(initialRow);
  const [allocation, setAllocation] = useState("");
  const list = useExecutionRead<{ items: StatementImport[] }>(
    "/finance/statement-imports",
  );
  const q = useExecutionRead<ReconciliationRead>(
    "/finance/reconciliation?state=" +
      state +
      "&importId=" +
      encodeURIComponent(importId),
  );
  const chosen = q.data?.items.find((i) => i.row.id === selected);
  const active = q.data?.allocations.find((a) => a.id === allocation);
  return (
    <Sheet title="Statement reconciliation" onClose={onClose} scroll={false}>
      <FlatList
        data={q.data?.items ?? []}
        keyExtractor={(i) => i.row.id}
        ListHeaderComponent={
          <View>
            <Text>
              Review full matches and discrepancies. Debits are negative;
              statement imports remain separate from expense payments.
            </Text>
            <Action
              title="All authorized imports"
              selected={!importId}
              onPress={() => setImport("")}
            />
            {list.data?.items.map((i) => (
              <Action
                key={i.id}
                title={
                  i.createdAt +
                  " · " +
                  i.rowCount +
                  " records · Debit " +
                  formatExactMoney(i.totals.debit, w.work!.company.currency) +
                  " · Net " +
                  formatExactMoney(i.totals.net, w.work!.company.currency)
                }
                selected={i.id === importId}
                onPress={() => setImport(i.id)}
              />
            ))}
            {["all", "unmatched", "matched", "dismissed"].map((s) => (
              <Action
                key={s}
                title={"Queue: " + s}
                selected={s === state}
                onPress={() => setState(s)}
              />
            ))}
            {q.loading && <Text>Checking current bank access…</Text>}
            <Text accessibilityRole="alert">{q.error}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.message}>
            <Text>
              Record {item.row.recordOrdinal} · {item.row.bookedDate} ·{" "}
              {formatExactMoney(item.row.signedAmountMinor, item.row.currency)}
            </Text>
            <Action
              title="Review record"
              onPress={() => setSelected(item.row.id)}
            />
            {q.data?.allocations
              .filter((a) => a.rowId === item.row.id)
              .map((a) => (
                <View key={a.id}>
                  <Text>
                    {a.active
                      ? "Active full association"
                      : "Reversed association"}{" "}
                    · {a.reason}
                  </Text>
                  {a.active && (
                    <Action
                      title="Review unmatch"
                      onPress={() => setAllocation(a.id)}
                    />
                  )}
                </View>
              ))}
          </View>
        )}
      />
      {chosen && (
        <RowDecision
          key={chosen.row.id}
          item={chosen}
          expenses={q.data!.unallocatedExpenses}
          onClose={() => setSelected("")}
          onChanged={() => {
            setSelected("");
            void q.retry();
          }}
        />
      )}
      {active && (
        <Reverse
          key={active.id}
          allocation={active}
          onClose={() => setAllocation("")}
          onChanged={() => {
            setAllocation("");
            void q.retry();
          }}
        />
      )}
    </Sheet>
  );
}
