import { useEffect, useEffectEvent, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useWorkspace } from "./Workspace";
import { Action, ui } from "./ConnectUI";
import { useRamInput } from "./ramInput";
import { useExecutionMutation } from "./execution";
import DeadlinePicker from "./DeadlinePicker";
import {
  companyDate,
  workDeadline,
  DeadlineChoiceError,
  deadlineLocalTime,
} from "./workDates";
import GoalEvidencePicker from "./GoalEvidencePicker";
import type {
  MeasuredGoal,
  GoalMeasurement,
  GoalEvidenceInput,
} from "../../shared/goals/types";
export default function GoalMeasurementForm({
  goal,
  correction,
  ready,
  onSaved,
}: {
  goal: MeasuredGoal;
  correction?: GoalMeasurement;
  ready: boolean;
  onSaved?: () => void;
}) {
  const w = useWorkspace();
  const zone = w.work?.company.timezone ?? "UTC";
  const form = "$goal-measure:" + goal.id + ":" + (correction?.id ?? "new");
  const [draft, setDraft, retire, , prefill] = useRamInput(
    form,
    "draft",
    () => ({
      expectedVersion: goal.version,
      value: String(correction?.value ?? goal.current),
      date: companyDate(new Date(), zone),
      time: deadlineLocalTime(new Date().toISOString(), zone),
      instant: "",
      reason: "",
      evidence: [] as GoalEvidenceInput[],
      authored: false,
    }),
  );
  const inspect = useEffectEvent(() => {
    if (ready && !draft.authored)
      prefill({
        ...draft,
        expectedVersion: goal.version,
        value: String(correction?.value ?? goal.current),
      });
  });
  useEffect(() => {
    inspect();
  }, [ready, goal.version, correction?.id, correction?.value]);
  const action = useExecutionMutation(form, ["/goals/" + goal.id]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  // Retain only the measured extent, never the fetched correction text.
  const [correctionGeometry, setCorrectionGeometry] = useState({
    scope: form,
    height: 0,
  });
  const set = (k: string, v: unknown) =>
    setDraft((d) => ({ ...d, [k]: v, authored: true }));
  let candidates: string[] = [];
  if (!correction) {
    try {
      candidates = [
        workDeadline(draft.date, draft.time, zone, draft.instant).dueAt,
      ].filter(Boolean);
    } catch (e) {
      if (e instanceof DeadlineChoiceError) candidates = e.candidates;
    }
  }
  async function submit() {
    setError("");
    const captured = draft;
    try {
      if (
        !action.attempt &&
        (!draft.value.trim() || !Number.isFinite(Number(draft.value)))
      )
        throw Error("Enter an explicit measured value.");
      const effectiveAt =
        correction?.effectiveAt ??
        workDeadline(draft.date, draft.time, zone, draft.instant).dueAt;
      if (!action.attempt && !effectiveAt)
        throw Error("Enter an explicit observation time.");
      const payload = action.attempt?.payload ?? {
        expectedVersion: draft.expectedVersion,
        value: Number(draft.value),
        effectiveAt,
        reason: draft.reason,
        evidence: draft.evidence,
        ...(correction ? { correctsId: correction.id } : {}),
      };
      await action.execute(
        "/goals/" + goal.id + "/measurements",
        payload,
        "POST",
        () => {
          retire(captured);
          setSaved(true);
          onSaved?.();
        },
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const header = (
    <View style={{ gap: 12 }}>
      <Text style={ui.title}>
        {correction ? "Correct measured result" : "Update measured result"}
      </Text>
      <Text>
        Task completion never records an outcome. Reason is shared with the goal
        audience; evidence retains its source access.
      </Text>
      <Text>
        Your authored input remains while current goal and sources are checked.
      </Text>
      <Text numberOfLines={1}>
        Measured value {ready ? (correction?.unit ?? goal.unit) : ""}
      </Text>
      <TextInput
        accessibilityLabel="Measured value"
        keyboardType="decimal-pad"
        style={ui.input}
        value={draft.authored || ready ? draft.value : ""}
        onChangeText={(v) => set("value", v)}
        editable={!action.busy && !action.attempt}
      />
      {correction ? (
        <Text
          accessibilityLabel="Correction source"
          style={{
            minHeight:
              !ready && correctionGeometry.scope === form
                ? correctionGeometry.height
                : undefined,
          }}
          onLayout={(event) => {
            if (ready) {
              const height = event.nativeEvent.layout.height;
              setCorrectionGeometry((previous) =>
                previous.scope === form && previous.height === height
                  ? previous
                  : { scope: form, height },
              );
            }
          }}
        >
          {ready
            ? "Inherited observation: " +
              correction.effectiveAt +
              " · " +
              (goal.currentMeasurementId === correction.id
                ? "Changes the current measurement"
                : "Corrects older history; current result remains")
            : "Checking correction source…"}
        </Text>
      ) : (
        <>
          <DeadlinePicker
            date={draft.date}
            time={draft.time}
            timezone={zone}
            label="Observation in company timezone"
            dateLabel="Observation date"
            timeLabel="Observation time"
            retainWhilePending
            requireTime
            onChange={(v) => {
              setDraft((d) => ({ ...d, ...v, instant: "", authored: true }));
            }}
            disabled={action.busy || !!action.attempt}
          />
          {candidates.length > 1 &&
            candidates.map((at) => (
              <Action
                key={at}
                title={"Choose observation " + at}
                selected={draft.instant === at}
                onPress={() => set("instant", at)}
              />
            ))}
          {!candidates.length && (
            <Text>
              Choose an existing local time. Observation must be in the past.
            </Text>
          )}
        </>
      )}
      <Text>Measurement reason</Text>
      <TextInput
        accessibilityLabel="Measurement reason"
        multiline
        style={[ui.input, { minHeight: 90 }]}
        value={draft.reason}
        onChangeText={(v) => set("reason", v)}
        editable={!action.busy && !action.attempt}
      />
    </View>
  );
  const footer = (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="alert">{error || action.error}</Text>
      {saved && <Text>Measurement saved.</Text>}
      <Action
        title={
          action.attempt ? "Retry same measurement" : "Save measured result"
        }
        primary
        disabled={
          !ready ||
          action.busy ||
          !draft.reason.trim() ||
          !draft.value.trim() ||
          !Number.isFinite(Number(draft.value)) ||
          (!correction && !candidates.length)
        }
        onPress={() => void submit()}
      />
      {!action.busy && ready && (
        <Action
          title="Load latest value and version"
          onPress={() => {
            action.abandon();
            setDraft({
              ...draft,
              expectedVersion: goal.version,
              value: String(correction?.value ?? goal.current),
              evidence: [],
              authored: true,
            });
            setError("");
          }}
        />
      )}
      {action.attempt && (
        <Action
          title="Abandon uncertain intent and inspect current goal"
          onPress={() => {
            action.abandon();
            onSaved?.();
          }}
        />
      )}
    </View>
  );
  return (
    <GoalEvidencePicker
      goalId={goal.id}
      ready={ready && !action.busy && !action.attempt}
      value={draft.evidence}
      onChange={(v) => {
        if (!action.busy) action.abandon();
        set("evidence", v);
      }}
      header={header}
      footer={footer}
    />
  );
}
