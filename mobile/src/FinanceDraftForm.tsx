import { Text, TextInput, View } from "react-native";
import { useState } from "react";
import { NativeProjectChoice } from "./Execution";
import { Sheet, Action } from "./ConnectUI";
import { useRamInput } from "./ramInput";
import { useExecutionMutation } from "./execution";
import { useWorkspace, styles } from "./Workspace";
import { parseExactMoney } from "../../shared/finance/money";
export default function FinanceDraftForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const w = useWorkspace();
  const form = "$finance-draft:new";
  const [draft, setDraft, retire] = useRamInput(form, "draft", {
    title: "",
    vendor: "",
    invoiceNumber: "",
    expenseDate: "",
    amount: "",
    departmentId: w.work?.me.departmentId ?? "",
    categoryId: "",
    description: "",
    receiptExceptionReason: "",
    projectId: "",
    taskId: "",
  });
  const m = useExecutionMutation(form);
  const [error, setError] = useState("");
  const ready = w.foreground && !!w.work;
  const frozen = !!m.attempt || m.busy;
  const authority = ["founder", "ceo", "admin", "finance"].includes(
    w.work?.me.role ?? "",
  );
  const departments = (w.work?.departments ?? []).filter(
    (d) => authority || d.id === w.work?.me.departmentId,
  );
  async function submit() {
    if (!ready) return;
    try {
      const authored = draft;
      const { amount, ...fields } = draft;
      const payload = m.attempt?.payload ?? {
        ...fields,
        amountMinor: parseExactMoney(amount),
      };
      await m.execute<{ id: string }>("/expenses", payload, "POST", (r) => {
        retire(authored);
        onCreated(r.id);
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const set = (key: keyof typeof draft, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  return (
    <Sheet
      title="Create incurred-expense draft"
      onClose={onClose}
      busy={m.busy}
    >
      <Text>
        Exact company currency:{" "}
        {ready ? w.work?.company.currency : "Checking access…"}. Saving a draft
        does not submit, approve or pay it.
      </Text>
      {(
        [
          "title",
          "vendor",
          "invoiceNumber",
          "expenseDate",
          "amount",
          "description",
          "receiptExceptionReason",
        ] as const
      ).map((key) => (
        <TextInput
          key={key}
          style={styles.input}
          accessibilityLabel={
            key === "title"
              ? "Expense title"
              : key === "vendor"
                ? "Vendor"
                : key === "expenseDate"
                  ? "Expense date"
                  : key === "amount"
                    ? `Amount (${ready ? w.work?.company.currency : ""})`
                    : key === "invoiceNumber"
                      ? "Invoice number"
                      : key === "receiptExceptionReason"
                        ? "Receipt exception reason"
                        : "Business purpose"
          }
          placeholder={
            key === "amount"
              ? "1300.50"
              : key === "expenseDate"
                ? "YYYY-MM-DD"
                : key
          }
          keyboardType={key === "amount" ? "decimal-pad" : "default"}
          value={draft[key]}
          editable={!frozen}
          onChangeText={(value) => set(key, value)}
        />
      ))}
      {ready && (
        <View>
          <Text>Expense department</Text>
          {departments.map((d) => (
            <Action
              key={d.id}
              title={d.name}
              selected={draft.departmentId === d.id}
              disabled={frozen}
              onPress={() => set("departmentId", d.id)}
            />
          ))}
          <Text>Expense category</Text>
          {w.work?.expenseCategories
            .filter((c) => c.active)
            .map((c) => (
              <Action
                key={c.id}
                title={c.name}
                selected={draft.categoryId === c.id}
                disabled={frozen}
                onPress={() => set("categoryId", c.id)}
              />
            ))}
          <Text>Linked project (optional)</Text>
          <NativeProjectChoice
            value={draft.projectId}
            disabled={frozen || !ready}
            onSelect={(p) => {
              if (!p || p.departmentId === draft.departmentId)
                set("projectId", p?.id ?? "");
            }}
          />
          <Text>Linked task (optional)</Text>
          <Action
            title="No task"
            disabled={frozen}
            onPress={() => set("taskId", "")}
          />
          {w.work?.tasks
            ?.filter(
              (t) =>
                t.departmentId === draft.departmentId &&
                (!draft.projectId || t.projectId === draft.projectId),
            )
            .map((t) => (
              <Action
                key={t.id}
                title={t.title}
                selected={t.id === draft.taskId}
                disabled={frozen}
                onPress={() => set("taskId", t.id)}
              />
            ))}
        </View>
      )}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
      {m.attempt && (
        <Text>
          Result unknown. Retry the same frozen draft. Before abandoning,
          inspect the ledger: prior work may already exist.
        </Text>
      )}
      <Action
        primary
        title={m.attempt ? "Retry same draft" : "Create reviewed draft"}
        disabled={
          !ready ||
          m.busy ||
          !draft.title ||
          !draft.vendor ||
          !draft.expenseDate ||
          !draft.categoryId ||
          !draft.departmentId
        }
        onPress={() => void submit()}
      />
    </Sheet>
  );
}
