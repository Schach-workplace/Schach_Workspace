import { useState } from "react";
import { statementLabels } from "../../shared/finance/labels";
import { FlatList, Text, TextInput, View } from "react-native";
import { useWorkspace, styles } from "./Workspace";
import { Sheet, Action } from "./ConnectUI";
import { useRamInput } from "./ramInput";
import { useExecutionRead, useExecutionMutation } from "./execution";
import {
  blankStatementMapping,
  statementMapping,
  type StatementPreview,
  type FinanceIntake,
} from "../../shared/finance/assistanceIntent";
import { formatExactMoney } from "../../shared/finance/money";
export default function FinanceStatementReview({
  intakeId,
  onClose,
  onImported,
}: {
  intakeId: string;
  onClose: () => void;
  onImported: (id: string) => void;
}) {
  const w = useWorkspace();
  const q = useExecutionRead<FinanceIntake>("/finance/intakes/" + intakeId);
  const [choices, setChoices] = useRamInput(
    "$statement-map:" + intakeId,
    "mapping",
    blankStatementMapping,
  );
  const [preview, setPreview] = useRamInput(
    "$statement-map:" + intakeId,
    "preview",
    "",
  );
  const [pageCursor, setPageCursor] = useState("");
  const [confirmed, setConfirmed] = useRamInput(
    "$statement-map:" + intakeId,
    "confirmed",
    false,
  );
  const [reason, setReason] = useRamInput(
    "$statement-map:" + intakeId,
    "reason",
    "",
  );
  const [error, setError] = useState("");
  const m = useExecutionMutation("$statement-preview:" + intakeId, [
    "/finance/intakes/" + intakeId,
  ]);
  const imported = useExecutionMutation("$statement-import:" + preview, [
    "/finance/statement-previews/" + preview,
  ]);
  const p = useExecutionRead<StatementPreview>(
    "/finance/statement-previews/" +
      preview +
      "?cursor=" +
      encodeURIComponent(pageCursor),
    !!preview,
  );
  const frozen = !!m.attempt || m.busy || !!imported.attempt || imported.busy;
  const set = (key: keyof typeof choices, value: string) => {
    if (frozen) return;
    setChoices((v) => ({ ...v, [key]: value }));
    setPreview("");
    setConfirmed(false);
    setPageCursor("");
  };
  const header = (
    <View>
      <Text>
        Explicit CSV mapping. Debits/outflows are negative; this records
        evidence without paying expenses.
      </Text>
      {Object.entries({
        headerRow: ["yes", "no"],
        delimiter: ["comma", "semicolon", "tab"],
        dateFormat: ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"],
        amountMode: ["signed", "debit_credit"],
        decimalSeparator: ["dot", "comma"],
        groupingSeparator: ["none", "comma", "dot", "space"],
      }).map(([key, values]) => (
        <View key={key}>
          <Text>{statementLabels[key]}</Text>
          {values.map((v) => (
            <Action
              key={v}
              title={statementLabels[key] + ": " + v}
              selected={choices[key as keyof typeof choices] === v}
              disabled={frozen}
              onPress={() => set(key as keyof typeof choices, v)}
            />
          ))}
        </View>
      ))}
      {(
        [
          "dateColumn",
          ...(choices.amountMode === "debit_credit"
            ? ["debitColumn", "creditColumn"]
            : ["signedAmountColumn"]),
          "referenceColumn",
          "descriptionColumn",
          "currencyColumn",
        ] as (keyof typeof choices)[]
      ).map((key) => (
        <TextInput
          key={key}
          style={styles.input}
          keyboardType="number-pad"
          accessibilityLabel={statementLabels[key] + " (file column 1–32)"}
          placeholder={statementLabels[key] + " (column 1–32)"}
          value={choices[key]}
          editable={!frozen}
          onChangeText={(v) => set(key, v)}
        />
      ))}
      <Action
        title={
          m.attempt
            ? "Retry same mapping preview"
            : "Preview exact statement rows"
        }
        disabled={
          !q.ready ||
          q.data?.state !== "clean" ||
          m.busy ||
          !!imported.attempt ||
          imported.busy
        }
        onPress={() => {
          if (imported.attempt || imported.busy) return;
          try {
            void m
              .execute<{ preview: { id: string } }>(
                "/finance/statement-previews",
                m.attempt?.payload ?? {
                  intakeId,
                  expectedIntakeVersion: q.data!.version,
                  mapping: statementMapping(choices),
                },
                "POST",
                (r) => {
                  setPageCursor("");
                  setConfirmed(false);
                  setPreview(r.preview.id);
                },
              )
              .catch((e) => setError(e.message));
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
      {p.data && (
        <>
          <Text>
            Debit{" "}
            {formatExactMoney(
              p.data.preview.totals.debit,
              w.work!.company.currency,
            )}{" "}
            · Credit{" "}
            {formatExactMoney(
              p.data.preview.totals.credit,
              w.work!.company.currency,
            )}{" "}
            · Net{" "}
            {formatExactMoney(
              p.data.preview.totals.net,
              w.work!.company.currency,
            )}
            . {p.data.rowCount} distinct records.
          </Text>
          {p.data.preview.errors.slice(0, 100).map((e) => (
            <Text key={e.row}>
              Record {e.row}: {e.message}
            </Text>
          ))}
        </>
      )}
      <Text accessibilityRole="alert">
        {error || m.error || imported.error || q.error || p.error}
      </Text>
    </View>
  );
  return (
    <Sheet
      title="Map and review bank CSV"
      onClose={onClose}
      busy={m.busy || imported.busy}
      scroll={false}
    >
      <FlatList
        data={p.data?.rows ?? []}
        ListHeaderComponent={header}
        keyExtractor={(r) => String(r.recordOrdinal)}
        renderItem={({ item: r }) => (
          <Text>
            Record {r.recordOrdinal} · {r.bookedDate} ·{" "}
            {formatExactMoney(r.signedAmountMinor, r.currency)} · {r.reference}
          </Text>
        )}
        ListFooterComponent={
          <View>
            {p.data && (
              <>
                {p.data.hasMore && (
                  <Action
                    title="Review next rows"
                    onPress={() => setPageCursor(p.data!.nextPageCursor)}
                  />
                )}
                <Action title="First rows" onPress={() => setPageCursor("")} />
                <Action
                  title="I reviewed the full mapping and all normalized rows"
                  selected={confirmed}
                  disabled={!!imported.attempt || imported.busy}
                  onPress={() => setConfirmed(!confirmed)}
                />
                <TextInput
                  style={styles.input}
                  accessibilityLabel="Reason for deliberate repeated import"
                  placeholder="Reason for deliberate repeated import, if applicable"
                  value={reason}
                  editable={!imported.attempt && !imported.busy}
                  onChangeText={setReason}
                />
                <Action
                  primary
                  title={
                    imported.attempt
                      ? "Retry same statement import"
                      : "Import reviewed statement"
                  }
                  disabled={
                    !p.ready ||
                    !q.ready ||
                    (!confirmed && !imported.attempt) ||
                    p.data.preview.errors.length > 0 ||
                    imported.busy
                  }
                  onPress={() =>
                    void imported
                      .execute<{ id: string }>(
                        "/finance/statement-previews/" + preview + "/import",
                        imported.attempt?.payload ?? {
                          expectedPreviewRevision: p.data!.preview.revision,
                          ...(reason ? { duplicateReason: reason } : {}),
                        },
                        "POST",
                        (r) => onImported(r.id),
                      )
                      .catch((e) => setError(e.message))
                  }
                />
              </>
            )}
          </View>
        }
      />
    </Sheet>
  );
}
