import ExpenseReceiptAssistance from "./ExpenseReceiptAssistance";
import { formatExactMoney } from "../../shared/finance/money";
import CaptureControl from "./CaptureControl";
import { useRamInput } from "./ramInput";
import { useEffect, useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { client } from "./client";
import { readNativeDetail } from "./readScopes";
import NativeMedia from "./Media";
import { useWorkspace, styles, type NativeExpense } from "./Workspace";
export default function ExpenseDecision(props: {
  expense: NativeExpense;
  onClose: () => void;
}) {
  const w = useWorkspace();
  const [evidenceEpoch, setEvidenceEpoch] = useState(0);
  const scope = [
    evidenceEpoch,
    w.company,
    w.recordEpoch,
    w.attentionEpoch,
    w.foreground,
    client.generation,
    w.work?.readBasis,
    w.work?.me.role,
    props.expense.id,
    props.expense.version,
  ].join(":");
  const [loaded, setLoaded] = useState<{
    scope: string;
    expense: NativeExpense;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const generation = client.generation;
    void Promise.resolve().then(() => {
      if (active) {
        setLoaded(null);
        setError("");
      }
    });
    readNativeDetail<{ expense: NativeExpense }>(
      (path) => client.request(path),
      `/companies/${w.company}/expenses/${props.expense.id}`,
      "expense",
    )
      .then((v) => {
        if (active && generation === client.generation)
          setLoaded({ scope, expense: v.expense });
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [w.company, scope, props.expense.id]);
  const detail = loaded?.scope === scope ? loaded.expense : null;
  if (!detail)
    return (
      <View>
        <Text>{error || "Loading current finance record…"}</Text>
        <Button title="Close" onPress={props.onClose} />
      </View>
    );
  return (
    <ExpenseDecisionBody
      key={scope}
      expense={detail}
      onClose={props.onClose}
      onEvidenceAdded={() => setEvidenceEpoch((e) => e + 1)}
    />
  );
}
function ExpenseDecisionBody({
  expense,
  onClose,
  onEvidenceAdded,
}: {
  expense: NativeExpense;
  onClose: () => void;
  onEvidenceAdded: () => void;
}) {
  const w = useWorkspace();
  const [note, setNote] = useRamInput("$expense:" + expense.id, "note", "");
  const [overrideReason, setOverride] = useRamInput(
    "$expense:" + expense.id,
    "overrideReason",
    "",
  );
  const [paidDate, setDate] = useRamInput(
    "$expense:" + expense.id,
    "paidDate",
    "",
  );
  const [method, setMethod] = useRamInput(
    "$expense:" + expense.id,
    "method",
    "bank_transfer",
  );
  const [reference, setReference] = useRamInput(
    "$expense:" + expense.id,
    "reference",
    "",
  );
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const me = w.work?.me;
  const authority = ["founder", "ceo", "admin", "finance"].includes(
    me?.role ?? "",
  );
  const mine = expense.createdBy === me?.id;
  const reviewer =
    !mine &&
    (authority ||
      (me?.role === "head" && me.departmentId === expense.departmentId));
  const writable = me?.role !== "viewer";
  async function decide(action: string) {
    setBusy(true);
    try {
      await client.request(
        `/companies/${w.company}/expenses/${expense.id}/transition`,
        "POST",
        {
          version: expense.version,
          action,
          note,
          overrideReason: action === "approve" ? overrideReason : "",
          ...(action === "pay"
            ? { paidDate, paymentMethod: method, paymentReference: reference }
            : {}),
        },
      );
      onClose();
      await w.refresh("finance");
    } catch (e) {
      w.setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={styles.message}>
      <Text>
        {expense.title} · {expense.status} · reviewed version {expense.version}
      </Text>
      <Text>
        {formatExactMoney(expense.amountMinor, expense.currency)} ·{" "}
        {expense.vendor} · {expense.expenseDate}
      </Text>
      <Text>Invoice: {expense.invoiceNumber || "None"}</Text>
      <Text>{expense.description}</Text>
      <Text>Receipt exception: {expense.receiptExceptionReason || "None"}</Text>
      {expense.receipts.map((r) => (
        <View key={r.id}>
          <Button
            title={`Inspect receipt: ${r.fileName}`}
            onPress={() =>
              void NativeMedia.downloadPath(
                `/companies/${w.company}/expense-receipts/${r.id}`,
                r.id,
              ).catch((e) => w.setError(e.message))
            }
          />
          <ExpenseReceiptAssistance expenseId={expense.id} receiptId={r.id} />
        </View>
      ))}
      {writable && (mine || authority) && (
        <CaptureControl
          scope={{
            serverOrigin: client.endpoint,
            companyId: w.company,
            userId: w.session?.user.id ?? "",
            targetKind: "expense",
            targetId: expense.id,
          }}
          label={"Receipt: " + expense.title}
          onUploaded={async () => {
            setConfirm(false);
            await w.refresh("finance");
            onEvidenceAdded();
          }}
        />
      )}
      <TextInput
        accessibilityLabel="Financial decision note"
        style={styles.input}
        placeholder="Decision note / rejection reason"
        value={note}
        onChangeText={setNote}
      />
      {authority && (
        <TextInput
          accessibilityLabel="Explicit budget override reason"
          style={styles.input}
          placeholder="Optional explicit budget override reason"
          value={overrideReason}
          onChangeText={setOverride}
        />
      )}
      <Button
        title={
          confirm
            ? "Reviewed snapshot ✓"
            : "I reviewed this amount, date and evidence"
        }
        onPress={() => setConfirm((v) => !v)}
      />
      {writable && mine && ["draft", "rejected"].includes(expense.status) && (
        <Button
          disabled={busy || !confirm}
          title="Submit this draft"
          onPress={() => void decide("submit")}
        />
      )}
      {writable && mine && expense.status === "submitted" && (
        <Button
          disabled={busy}
          title="Withdraw to draft"
          onPress={() => void decide("withdraw")}
        />
      )}
      {writable && reviewer && expense.status === "submitted" && (
        <>
          <Button
            disabled={busy || !confirm}
            title="Independently approve this version"
            onPress={() => void decide("approve")}
          />
          <Button
            disabled={busy || !confirm || note.trim().length < 12}
            title="Reject with correction reason"
            onPress={() => void decide("reject")}
          />
        </>
      )}
      {writable && authority && !mine && expense.status === "approved" && (
        <View>
          <Text>
            Record a completed external payment. Schach does not send money.
          </Text>
          <TextInput
            accessibilityLabel="Paid date"
            style={styles.input}
            placeholder="Paid date YYYY-MM-DD"
            value={paidDate}
            onChangeText={setDate}
          />
          <TextInput
            accessibilityLabel="Payment method"
            style={styles.input}
            value={method}
            onChangeText={setMethod}
          />
          <TextInput
            accessibilityLabel="Payment reference"
            style={styles.input}
            value={reference}
            onChangeText={setReference}
          />
          <Button
            disabled={busy || !confirm || !paidDate || !reference}
            title="Record external payment"
            onPress={() => void decide("pay")}
          />
        </View>
      )}
      <Button disabled={busy} title="Close finance review" onPress={onClose} />
    </View>
  );
}
