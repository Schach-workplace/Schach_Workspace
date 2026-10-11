import { useState } from "react";
import { FlatList, Text, TextInput, View } from "react-native";
import { styles, useWorkspace } from "./Workspace";
import { Sheet, Action } from "./ConnectUI";
import { useRamInput } from "./ramInput";
import { useExecutionRead, useExecutionMutation } from "./execution";
import type { FinanceDuplicate } from "../../shared/finance/assistanceIntent";
function Dismiss({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const path = "/finance/duplicate-candidates/" + id;
  const q = useExecutionRead<FinanceDuplicate>(path);
  const [reason, setReason] = useRamInput("$duplicate:" + id, "reason", "");
  const m = useExecutionMutation("$duplicate-dismiss:" + id, [path]);
  return (
    <Sheet title="Review possible duplicate" onClose={onClose} busy={m.busy}>
      {q.data && (
        <>
          <Text>
            {q.data.reason.replaceAll("_", " ")}. This is a review suggestion;
            dismissal does not merge or delete expenses.
          </Text>
          <TextInput
            accessibilityLabel="Duplicate dismissal reason"
            style={styles.input}
            placeholder="Explain the false positive (12 characters minimum)"
            value={reason}
            editable={!m.attempt && !m.busy}
            onChangeText={setReason}
          />
          <Action
            title={
              m.attempt
                ? "Retry same dismissal"
                : "Dismiss reviewed false positive"
            }
            disabled={!q.ready || m.busy || reason.trim().length < 12}
            onPress={() =>
              void m
                .execute(
                  path + "/dismiss",
                  m.attempt?.payload ?? {
                    expectedVersion: q.data!.version,
                    reason,
                  },
                )
                .then(onChanged)
                .catch(() => {})
            }
          />
        </>
      )}
      <Text accessibilityRole="alert">{m.error || q.error}</Text>
    </Sheet>
  );
}
export default function FinanceDuplicateReview({
  onClose,
  initialCandidate = "",
}: {
  onClose: () => void;
  initialCandidate?: string;
}) {
  const w = useWorkspace();
  const [selected, setSelected] = useState(initialCandidate);
  const source = useExecutionMutation("$duplicates-review");
  const q = useExecutionRead<{ items: FinanceDuplicate[] }>(
    "/finance/duplicate-candidates",
  );
  return (
    <Sheet title="Duplicate review" onClose={onClose} scroll={false}>
      <FlatList
        data={q.data?.items ?? []}
        keyExtractor={(i) => i.id}
        ListHeaderComponent={
          <View>
            <Text>
              Generate suggestions only from expenses you can currently read.
            </Text>
            {w.foreground &&
              w.work?.expenses.map((e) => (
                <Action
                  key={e.id}
                  title={"Review " + e.title}
                  disabled={
                    source.busy ||
                    (!!source.attempt &&
                      source.attempt.payload.sourceId !== e.id)
                  }
                  onPress={() =>
                    void source
                      .execute(
                        "/finance/duplicate-candidates/review",
                        source.attempt?.payload ?? {
                          sourceKind: "expense",
                          sourceId: e.id,
                          expectedVersion: e.version ?? 1,
                        },
                      )
                      .then(() => q.retry())
                      .catch(() => {})
                  }
                />
              ))}
            <Text accessibilityRole="alert">{source.error || q.error}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.message}>
            <Text>
              {w.work?.expenses.find((e) => e.id === item.sourceId)?.title ??
                "Reviewed extraction"}{" "}
              /{" "}
              {w.work?.expenses.find((e) => e.id === item.comparedExpenseId)
                ?.title ?? "Current authorized expense"}{" "}
              · {item.reason.replaceAll("_", " ")}
            </Text>
            <Action
              title="Inspect suggestion"
              onPress={() => setSelected(item.id)}
            />
          </View>
        )}
      />
      {selected && (
        <Dismiss
          id={selected}
          onClose={() => setSelected("")}
          onChanged={() => {
            setSelected("");
            void q.retry();
          }}
        />
      )}
    </Sheet>
  );
}
