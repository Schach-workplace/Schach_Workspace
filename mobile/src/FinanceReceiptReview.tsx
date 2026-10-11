import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useWorkspace, styles } from "./Workspace";
import { Sheet, Action } from "./ConnectUI";
import { NativeProjectChoice } from "./Execution";
import { useRamInput } from "./ramInput";
import { useExecutionRead, useExecutionMutation } from "./execution";
import {
  blankFinanceDraft,
  reviewedReceiptIntent,
  type ReceiptExtraction,
} from "../../shared/finance/assistanceIntent";
export default function FinanceReceiptReview({
  jobId,
  onClose,
  onCreated,
}: {
  jobId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const w = useWorkspace();
  const path = "/finance/receipt-extractions/" + jobId;
  const q = useExecutionRead<ReceiptExtraction>(path);
  const [draft, setDraft] = useRamInput(
    "$receipt-review:" + jobId,
    "fields",
    blankFinanceDraft,
  );
  const [confirmed, setConfirmed] = useRamInput<string[]>(
    "$receipt-review:" + jobId,
    "uncertainties",
    [],
  );
  const [copy, setCopy] = useRamInput(
    "$receipt-review:" + jobId,
    "copy",
    false,
  );
  const [audience, setAudience] = useRamInput(
    "$receipt-review:" + jobId,
    "audience",
    false,
  );
  const [review, setReview] = useState<Record<string, unknown>>();
  const [error, setError] = useState("");
  const m = useExecutionMutation("$receipt-accept:" + jobId, [path]);
  const p = useExecutionRead<{
    audienceUserIds: string[];
    evidenceNotice: string;
  }>(
    path + "/accept-preview",
    !!review || !!m.attempt,
    m.attempt?.payload ?? review,
  );
  const ready = q.ready && !!q.data?.result;
  const locked = !!m.attempt || m.busy;
  const change = (key: keyof typeof draft, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setReview(undefined);
    setAudience(false);
  };
  const inspect = () => {
    try {
      if (q.data)
        setReview(reviewedReceiptIntent(q.data, draft, copy, confirmed));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Sheet title="Review extracted receipt" onClose={onClose} busy={m.busy}>
      <Text>
        Review fields, evidence and its current finance audience. Saving this
        draft does not submit, approve or pay it.
      </Text>
      {q.loading && <Text>Checking current source access…</Text>}
      {q.data && !q.data.result && (
        <>
          <Text>{q.data.job.status}. Manual entry remains available.</Text>
          <Action
            title="Check extraction progress"
            onPress={() => void q.retry()}
          />
        </>
      )}
      {ready && (
        <>
          <Text>
            {q.data!.result!.engine} · {q.data!.result!.engineVersion} ·{" "}
            {q.data!.result!.language}
          </Text>
          {Object.entries(q.data!.result!.candidates.fields).map(
            ([field, values]) => (
              <View key={field}>
                <Text>{field} candidates</Text>
                {values.map((value) => (
                  <Action
                    key={value}
                    title={"Use " + field + ": " + value}
                    disabled={locked}
                    onPress={() => {
                      const key = field === "amountText" ? "amount" : field;
                      if (key in draft)
                        change(key as keyof typeof draft, value);
                    }}
                  />
                ))}
              </View>
            ),
          )}
        </>
      )}
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
          accessibilityLabel={"Reviewed " + key}
          placeholder={
            key === "amount"
              ? "Exact amount, e.g. 1300.50"
              : key === "expenseDate"
                ? "YYYY-MM-DD"
                : key
          }
          keyboardType={key === "amount" ? "decimal-pad" : "default"}
          editable={!locked}
          style={styles.input}
          value={draft[key]}
          onChangeText={(v) => change(key, v)}
        />
      ))}
      {ready && (
        <>
          <Text>Choose reviewed destination</Text>
          {w.work?.departments
            .filter((d) => d.id === q.data!.job.destinationDepartmentId)
            .map((d) => (
              <Action
                key={d.id}
                title={d.name}
                selected={draft.departmentId === d.id}
                disabled={locked}
                onPress={() => change("departmentId", d.id)}
              />
            ))}
          <Text>Choose reviewed category</Text>
          {w.work?.expenseCategories
            .filter((c) => c.active)
            .map((c) => (
              <Action
                key={c.id}
                title={c.name}
                selected={draft.categoryId === c.id}
                disabled={locked}
                onPress={() => change("categoryId", c.id)}
              />
            ))}
          <Text>Optional linked work</Text>
          <NativeProjectChoice
            value={draft.projectId}
            disabled={locked}
            onSelect={(p) => {
              if (!p || p.departmentId === draft.departmentId)
                change("projectId", p?.id ?? "");
            }}
          />
          <Action
            title="No task"
            disabled={locked}
            onPress={() => change("taskId", "")}
          />
          {w.work?.tasks
            .filter(
              (t) =>
                t.departmentId === draft.departmentId &&
                (!draft.projectId || t.projectId === draft.projectId),
            )
            .map((t) => (
              <Action
                key={t.id}
                title={t.title}
                selected={draft.taskId === t.id}
                disabled={locked}
                onPress={() => change("taskId", t.id)}
              />
            ))}
          {q.data!.result!.candidates.unresolved.map((token) => (
            <Action
              key={token}
              title={"I resolved " + token}
              selected={confirmed.includes(token)}
              disabled={locked}
              onPress={() => {
                setConfirmed((v) =>
                  v.includes(token)
                    ? v.filter((t) => t !== token)
                    : [...v, token],
                );
                setReview(undefined);
              }}
            />
          ))}
          <Action
            title="Publish separately retained receipt evidence"
            selected={copy}
            disabled={locked}
            onPress={() => {
              setCopy(!copy);
              setReview(undefined);
            }}
          />
        </>
      )}
      <Action
        title="Review exact draft and evidence audience"
        disabled={!ready || locked}
        onPress={inspect}
      />
      {p.data && (
        <>
          <Text>{p.data.evidenceNotice}</Text>
          <Text>
            Current finance audience:{" "}
            {p.data.audienceUserIds
              .map(
                (id) =>
                  w.work?.people.find((person) => person.id === id)?.name ??
                  "Current authorized member",
              )
              .join(", ")}
          </Text>
          <Action
            title="I confirm this reviewed draft and audience"
            selected={audience}
            onPress={() => setAudience(!audience)}
          />
        </>
      )}
      {m.attempt && (
        <Text>Result unknown. Retry this same frozen reviewed draft.</Text>
      )}
      <Action
        primary
        title={
          m.attempt
            ? "Retry same reviewed draft"
            : q.data?.job.targetExpenseId
              ? "Update reviewed draft"
              : "Create reviewed draft"
        }
        disabled={!ready || m.busy || (!m.attempt && (!p.ready || !audience))}
        onPress={() =>
          void m
            .execute<{ id: string }>(
              path + "/accept",
              (m.attempt?.payload ?? review)!,
              "POST",
              (r) => onCreated(r.id),
            )
            .catch((e) => setError(e.message))
        }
      />
      <Text accessibilityRole="alert">
        {error || m.error || q.error || p.error}
      </Text>
    </Sheet>
  );
}
