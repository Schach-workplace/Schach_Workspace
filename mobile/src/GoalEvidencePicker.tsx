import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
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
  editable = ready,
  value,
  onChange,
  onDenied = () => onChange([]),
  header,
  footer,
}: {
  goalId: string;
  ready: boolean;
  editable?: boolean;
  value: GoalEvidenceInput[];
  onChange: (v: GoalEvidenceInput[]) => void;
  onDenied?: () => void;
  header?: ReactNode;
  footer?: (authorized: boolean) => ReactNode;
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
    editable && ["message", "task_comment"].includes(kind),
  );
  const opts = useExecutionRead<{ options: Option[] }>(
    root +
      "/evidence-options?" +
      new URLSearchParams({ kind, parentId: parent }),
    editable && (!["message", "task_comment"].includes(kind) || !!parent),
  );
  const preview = useExecutionRead<Preview>(
    root +
      "/evidence-preview?" +
      new URLSearchParams({ kind, sourceId: chosen, parentId: parent }),
    editable && !!chosen,
  );
  const scrub = useEffectEvent(() => {
    onChange([]);
    setChosen("");
  });
  useEffect(() => {
    if (opts.denied || preview.denied)
      void Promise.resolve().then(() => scrub());
  }, [opts.denied, preview.denied]);
  const choosingParent = ["message", "task_comment"].includes(kind) && !parent;
  const rows = choosingParent
    ? parents.ready
      ? (parents.data?.options ??
        parents.data?.conversations?.map((c) => ({
          sourceId: c.id,
          label: c.title,
        })) ??
        [])
      : []
    : opts.ready
      ? (opts.data?.options ?? [])
      : [];
  // Each bound read contributes its live result directly; no authorization cache.
  let selected: (authorized: boolean) => ReactNode = (authorized) => (
    <>
      {value.length > 0 && (
        <Action
          title="Clear evidence selections"
          disabled={!editable}
          onPress={() => onChange([])}
        />
      )}
      {footer?.(authorized)}
    </>
  );
  for (let i = value.length - 1; i >= 0; i--) {
    const next = selected;
    const binding = value[i];
    selected = (authorized) => (
      <Bound
        root={root}
        binding={binding}
        ready={ready}
        editable={editable}
        onDenied={() => {
          setParent("");
          setChosen("");
          onDenied();
        }}
        onRemove={() => onChange(value.filter((_, n) => n !== i))}
      >
        {(current) => next(authorized && current)}
      </Bound>
    );
  }
  return (
    <FlatList
      style={{ flex: 1 }}
      keyboardShouldPersistTaps="handled"
      data={rows}
      keyExtractor={(o) => kind + ":" + o.sourceId}
      renderItem={({ item }) => (
        <Action
          title={item.label}
          selected={chosen === item.sourceId}
          disabled={!editable}
          onPress={() => {
            if (choosingParent) {
              setParent(item.sourceId);
              setChosen("");
            } else setChosen(item.sourceId);
          }}
        />
      )}
      ListEmptyComponent={
        <Text>
          {(choosingParent ? parents.error : opts.error) ??
            "Checking current evidence options…"}
        </Text>
      }
      ListHeaderComponent={
        <View style={{ gap: 10 }}>
          {header}
          <Text style={ui.title}>Optional evidence</Text>
          <Text>
            Choose a currently authorized source by its human label. Measurement
            reason is visible to the goal audience.
          </Text>
          <View style={ui.row}>
            {(
              ["report_snapshot", "task", "task_comment", "message"] as const
            ).map((k) => (
              <Action
                key={k}
                title={
                  k === "report_snapshot"
                    ? "My historical reports"
                    : k.replace("_", " ")
                }
                disabled={!editable}
                selected={kind === k}
                onPress={() => {
                  setKind(k);
                  setChosen("");
                  setParent("");
                }}
              />
            ))}
          </View>
          {!!parent && (
            <Action
              title="Choose another parent source"
              disabled={!editable}
              onPress={() => {
                setParent("");
                setChosen("");
              }}
            />
          )}
        </View>
      }
      ListFooterComponent={
        <View style={{ gap: 10 }}>
          {chosen && (
            <View style={{ minHeight: 80 }}>
              {preview.ready && preview.data ? (
                <>
                  <Text>{preview.data.label}</Text>
                  <Text>{preview.data.excerpt}</Text>
                  <Text>{preview.data.audienceNotice}</Text>
                  <Action
                    title="Use selected evidence"
                    disabled={!editable || value.length >= 50}
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
          {selected(ready)}
        </View>
      }
    />
  );
}
function Bound({
  root,
  binding,
  ready,
  editable,
  children,
  onDenied,
  onRemove,
}: {
  root: string;
  binding: GoalEvidenceInput;
  ready: boolean;
  editable: boolean;
  children: (authorized: boolean) => ReactNode;
  onDenied: () => void;
  onRemove: () => void;
}) {
  const q = useExecutionRead<Preview>(
    `${root}/evidence-preview?kind=${binding.kind}&sourceId=${encodeURIComponent(binding.sourceId)}&parentId=${encodeURIComponent(binding.parentId)}`,
    ready,
  );
  const scrub = useEffectEvent(() => onDenied());
  useEffect(() => {
    if (q.denied) scrub();
  }, [q.denied]);
  return (
    <>
      <View style={{ minHeight: 44 }}>
        <Text>{q.ready ? q.data?.label : "Checking selected evidence…"}</Text>
        <Action
          title="Remove evidence"
          disabled={!editable}
          onPress={onRemove}
        />
      </View>
      {children(q.ready)}
    </>
  );
}
