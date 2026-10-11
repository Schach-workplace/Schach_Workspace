import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useWorkspace } from "./Workspace";
import { Action, Sheet, ui } from "./ConnectUI";
import { useRamInput } from "./ramInput";
import { useExecutionMutation, useExecutionRead } from "./execution";
import PersonPicker from "./PersonPicker";
import DeadlinePicker from "./DeadlinePicker";
import {
  companyDate,
  deadlineLocalTime,
  workDeadline,
  DeadlineChoiceError,
} from "./workDates";
import type { MeasuredGoal, GoalDetail } from "../../shared/goals/types";
export default function GoalMetadataForm({
  item,
  ready,
  onClose,
}: {
  item?: MeasuredGoal;
  ready: boolean;
  onClose: () => void;
}) {
  const w = useWorkspace();
  const zone = w.work?.company.timezone ?? "UTC";
  const [draft, setDraft, retire] = useRamInput(
    "$goal-metadata:" + (item?.id ?? "new"),
    "draft",
    () => ({
      version: item?.version ?? 1,
      name: item?.name ?? "",
      description: item?.description ?? "",
      ownerId: item?.ownerId ?? w.session?.user.id ?? "",
      departmentId: item?.departmentId ?? "",
      inspectedUnit: item?.unit ?? "%",
      unit: item?.unit ?? "%",
      baseline: String(item?.baseline ?? 0),
      target: String(item?.target ?? 100),
      taskIds: item?.taskIds ?? [],
      dueDate: item?.dueDate ?? "",
      value: String(item?.current ?? 0),
      date: companyDate(new Date(), zone),
      time: deadlineLocalTime(new Date().toISOString(), zone),
      instant: "",
      reason: "",
      measurementReason: "",
      withMeasurement: !item,
      authored: false,
    }),
  );
  const action = useExecutionMutation(
    "$goal-metadata:" + (item?.id ?? "new"),
    item ? ["/goals/" + item.id] : [],
  );
  const latest = useExecutionRead<GoalDetail>(
    "/goals/" + (item?.id ?? ""),
    !!item && ready,
  );
  const loadLatest = () => {
    if (!latest.ready || !latest.data?.canEdit) return;
    const g = latest.data.goal;
    action.abandon();
    setDraft({
      ...draft,
      version: g.version,
      name: g.name,
      description: g.description,
      ownerId: g.ownerId,
      departmentId: g.departmentId,
      unit: g.unit,
      inspectedUnit: g.unit,
      baseline: String(g.baseline),
      target: String(g.target),
      taskIds: g.taskIds,
      dueDate: g.dueDate,
      value: String(g.current),
      withMeasurement: false,
      authored: true,
    });
    setError("");
  };
  const [error, setError] = useState("");
  const set = (k: string, v: unknown) =>
    setDraft((d) => ({ ...d, [k]: v, authored: true }));
  const need =
    !item || draft.withMeasurement || draft.unit !== draft.inspectedUnit;
  let candidates: string[] = [];
  try {
    candidates = [
      workDeadline(draft.date, draft.time, zone, draft.instant).dueAt,
    ].filter(Boolean);
  } catch (e) {
    if (e instanceof DeadlineChoiceError) candidates = e.candidates;
  }
  async function save() {
    try {
      if (
        !action.attempt &&
        (!draft.baseline.trim() ||
          !draft.target.trim() ||
          !Number.isFinite(Number(draft.baseline)) ||
          !Number.isFinite(Number(draft.target)) ||
          (need &&
            (!draft.value.trim() || !Number.isFinite(Number(draft.value)))))
      )
        throw Error("Enter explicit finite numeric values.");
      const metadata = {
        name: draft.name,
        description: draft.description,
        ownerId: draft.ownerId,
        departmentId: draft.departmentId,
        unit: draft.unit,
        baseline: Number(draft.baseline),
        target: Number(draft.target),
        taskIds: draft.taskIds,
        dueDate: draft.dueDate,
      };
      const effectiveAt = need
        ? workDeadline(draft.date, draft.time, zone, draft.instant).dueAt
        : "";
      if (!action.attempt && need && !effectiveAt)
        throw Error("Enter an explicit observation time.");
      const measurement = {
        value: Number(draft.value),
        effectiveAt,
        reason: draft.measurementReason,
        evidence: [],
      };
      const payload =
        action.attempt?.payload ??
        (item
          ? {
              ...metadata,
              version: draft.version,
              reason: draft.reason,
              ...(need
                ? {
                    current: measurement.value,
                    effectiveAt,
                    measurementReason: measurement.reason,
                    evidence: [],
                  }
                : {}),
            }
          : { ...metadata, initialMeasurement: measurement });
      const captured = draft;
      await action.execute(
        item ? "/goals/" + item.id : "/goals",
        payload,
        item ? "PATCH" : "POST",
        () => {
          retire(captured);
          onClose();
        },
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Sheet
      title={item ? "Edit goal metadata" : "Create measured goal"}
      onClose={onClose}
      busy={action.busy}
    >
      <Text>
        Current result changes only through an explicit, reasoned measurement.
        Unit changes require a new measurement in the same transaction.
      </Text>
      {(["name", "description", "unit", "baseline", "target"] as const).map(
        (k) => (
          <View key={k}>
            <Text>{k}</Text>
            <TextInput
              accessibilityLabel={"Goal " + k}
              style={ui.input}
              value={ready || draft.authored ? draft[k] : ""}
              onChangeText={(v) => set(k, v)}
              editable={!action.busy && !action.attempt}
            />
          </View>
        ),
      )}
      <PersonPicker
        label="Goal owner"
        people={w.work?.people ?? []}
        value={ready || draft.authored ? draft.ownerId : ""}
        authorized={ready}
        onChange={(id) => set("ownerId", id)}
      />
      <Text>Department</Text>
      <View style={ui.row}>
        <Action
          title="Company"
          selected={(ready || draft.authored) && !draft.departmentId}
          onPress={() => set("departmentId", "")}
        />
        {(ready ? w.work?.departments : [])?.map((d) => (
          <Action
            key={d.id}
            title={d.name}
            selected={(ready || draft.authored) && draft.departmentId === d.id}
            onPress={() => set("departmentId", d.id)}
          />
        ))}
      </View>
      <DeadlinePicker
        date={ready || draft.authored ? draft.dueDate : ""}
        time=""
        timezone={zone}
        calendarOnly
        label="Goal target date"
        onChange={(v) => set("dueDate", v.date)}
      />
      <Text>Contributing tasks</Text>
      {(ready ? w.work?.tasks : [])?.map((t) => (
        <Action
          key={t.id}
          title={t.title}
          selected={draft.taskIds.includes(t.id)}
          onPress={() =>
            set(
              "taskIds",
              draft.taskIds.includes(t.id)
                ? draft.taskIds.filter((id) => id !== t.id)
                : [...draft.taskIds, t.id],
            )
          }
        />
      ))}
      {item && (
        <>
          <Text>Metadata reason</Text>
          <TextInput
            style={ui.input}
            accessibilityLabel="Goal metadata reason"
            value={draft.reason}
            onChangeText={(v) => set("reason", v)}
          />
          <Action
            title="Record a measurement with metadata"
            selected={draft.withMeasurement}
            onPress={() => set("withMeasurement", !draft.withMeasurement)}
          />
        </>
      )}
      {need && (
        <>
          <Text>Initial or new measured value</Text>
          <TextInput
            accessibilityLabel="Initial measured value"
            style={ui.input}
            keyboardType="decimal-pad"
            value={ready || draft.authored ? draft.value : ""}
            onChangeText={(v) => set("value", v)}
          />
          <DeadlinePicker
            date={draft.date}
            time={draft.time}
            timezone={zone}
            label="Observation time"
            dateLabel="Observation date"
            timeLabel="Observation time"
            requireTime
            retainWhilePending
            onChange={(v) => setDraft((d) => ({ ...d, ...v, instant: "" }))}
          />
          {candidates.length > 1 &&
            candidates.map((at) => (
              <Action
                key={at}
                title={"Choose observation " + at}
                onPress={() => set("instant", at)}
                selected={draft.instant === at}
              />
            ))}
          <Text>Measurement reason shared with goal audience</Text>
          <TextInput
            style={ui.input}
            accessibilityLabel="Initial measurement reason"
            value={draft.measurementReason}
            onChangeText={(v) => set("measurementReason", v)}
          />
        </>
      )}
      <Text>{error || action.error}</Text>
      {action.attempt && (
        <Action
          title="Discard submitted intent and edit"
          disabled={action.busy}
          onPress={() => {
            action.abandon();
            setError("");
          }}
        />
      )}
      {!!item && (
        <Action
          title="Load latest goal and version"
          disabled={
            action.busy || !ready || !latest.ready || !latest.data?.canEdit
          }
          onPress={loadLatest}
        />
      )}
      <Action
        title={action.attempt ? "Retry same goal intent" : "Save reviewed goal"}
        primary
        disabled={
          !ready ||
          action.busy ||
          !draft.name.trim() ||
          (item && !draft.reason.trim()) ||
          !draft.baseline.trim() ||
          !draft.target.trim() ||
          !Number.isFinite(Number(draft.baseline)) ||
          !Number.isFinite(Number(draft.target)) ||
          (need &&
            (!candidates.length ||
              !draft.measurementReason.trim() ||
              !draft.value.trim() ||
              !Number.isFinite(Number(draft.value))))
        }
        onPress={() => void save()}
      />
    </Sheet>
  );
}
