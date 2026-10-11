import { useEffect, useState } from "react";
import { Text, View, FlatList } from "react-native";
import { Action, ui } from "./ConnectUI";
import { useExecutionRead } from "./execution";
import type { GoalEvidenceInput } from "../../shared/goals/types";
type Option = { sourceId: string; label: string };
type Preview = GoalEvidenceInput & {
  label: string;
  excerpt: string;
  audienceNotice: string;
};
export default function GoalEvidencePicker({
  goalId,
  ready,
  value,
  onChange,
}: {
  goalId: string;
  ready: boolean;
  value: GoalEvidenceInput[];
  onChange: (v: GoalEvidenceInput[]) => void;
}) {
  const [kind, setKind] =
    useState<GoalEvidenceInput["kind"]>("report_snapshot");
  const [parent, setParent] = useState("");
  const [chosen, setChosen] = useState("");
  const root = "/goals/" + goalId;
  const parents = useExecutionRead<{
    options: Option[];
    conversations?: { id: string; title: string }[];
  }>(
    kind === "message"
      ? "/conversations"
      : root + "/evidence-options?kind=task",
    ready && ["message", "task_comment"].includes(kind),
  );
  const opts = useExecutionRead<{ options: Option[] }>(
    root +
      "/evidence-options?" +
      new URLSearchParams({ kind, parentId: parent }),
    ready && (!["message", "task_comment"].includes(kind) || !!parent),
  );
  const preview = useExecutionRead<Preview>(
    root +
      "/evidence-preview?" +
      new URLSearchParams({ kind, sourceId: chosen, parentId: parent }),
    ready && !!chosen,
  );
  useEffect(() => {
    if (opts.denied || preview.denied) {
      void Promise.resolve().then(() => {
        onChange([]);
        setChosen("");
      });
    }
  }, [opts.denied, preview.denied]);
  return (
    <View style={{ gap: 10 }}>
      <Text style={ui.title}>Optional evidence</Text>
      <Text>
        Choose a currently authorized source by its human label. Measurement
        reason is visible to the goal audience.
      </Text>
      <View style={ui.row}>
        {(["report_snapshot", "task", "task_comment", "message"] as const).map(
          (k) => (
            <Action
              key={k}
              title={
                k === "report_snapshot"
                  ? "My historical reports"
                  : k.replace("_", " ")
              }
              selected={kind === k}
              onPress={() => {
                setKind(k);
                setChosen("");
                setParent("");
              }}
            />
          ),
        )}
      </View>
      {["message", "task_comment"].includes(kind) &&
        parents.ready &&
        (
          parents.data?.options ??
          parents.data?.conversations?.map((c) => ({
            sourceId: c.id,
            label: c.title,
          })) ??
          []
        ).map((p) => (
          <Action
            key={p.sourceId}
            title={p.label}
            selected={parent === p.sourceId}
            onPress={() => {
              setParent(p.sourceId);
              setChosen("");
            }}
          />
        ))}
      <View style={{ height: 180 }}>
        <FlatList
          data={opts.ready ? (opts.data?.options ?? []) : []}
          keyExtractor={(o) => o.sourceId}
          ListEmptyComponent={
            <Text>{opts.error ?? "Checking current evidence options…"}</Text>
          }
          renderItem={({ item }) => (
            <Action
              title={item.label}
              selected={chosen === item.sourceId}
              onPress={() => setChosen(item.sourceId)}
            />
          )}
        />
      </View>
      {chosen && (
        <View style={{ minHeight: 80 }}>
          {preview.ready && preview.data ? (
            <>
              <Text>{preview.data.label}</Text>
              <Text>{preview.data.excerpt}</Text>
              <Text>{preview.data.audienceNotice}</Text>
              <Action
                title="Use selected evidence"
                disabled={value.length >= 50}
                onPress={() => {
                  if (
                    preview.data &&
                    !value.some(
                      (v) =>
                        v.kind === kind &&
                        v.parentId === parent &&
                        v.sourceId === chosen,
                    )
                  )
                    onChange([
                      ...value,
                      {
                        kind: preview.data.kind,
                        sourceId: preview.data.sourceId,
                        parentId: preview.data.parentId,
                        revision: preview.data.revision,
                        contentHash: preview.data.contentHash,
                      },
                    ]);
                  setChosen("");
                }}
              />
            </>
          ) : (
            <Text>{preview.error ?? "Authorizing this exact source…"}</Text>
          )}
        </View>
      )}
      <Text>{value.length} evidence selections</Text>
      {value.map((binding, i) => (
        <Bound
          key={binding.kind + binding.parentId + binding.sourceId}
          root={root}
          binding={binding}
          ready={ready}
          onDenied={() => onChange([])}
          onRemove={() => onChange(value.filter((_, n) => n !== i))}
        />
      ))}
      {value.length > 0 && (
        <Action
          title="Clear evidence selections"
          onPress={() => onChange([])}
        />
      )}
    </View>
  );
}
function Bound({
  root,
  binding,
  ready,
  onDenied,
  onRemove,
}: {
  root: string;
  binding: GoalEvidenceInput;
  ready: boolean;
  onDenied: () => void;
  onRemove: () => void;
}) {
  const q = useExecutionRead<Preview>(
    root +
      "/evidence-preview?" +
      new URLSearchParams({
        kind: binding.kind,
        sourceId: binding.sourceId,
        parentId: binding.parentId,
      }),
    ready,
  );
  useEffect(() => {
    if (q.denied) onDenied();
  }, [q.denied]);
  return (
    <View style={{ minHeight: 44 }}>
      <Text>{q.ready ? q.data?.label : "Checking selected evidence…"}</Text>
      <Action title="Remove evidence" onPress={onRemove} />
    </View>
  );
}
