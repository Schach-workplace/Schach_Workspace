import { frozenGoalDraft } from "../../shared/goals/recovery";
import { useWorkspace } from "./Workspace";
import { useEffect, useEffectEvent, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Action, ui } from "./ConnectUI";
import { useRamInput } from "./ramInput";
import { useExecutionRead, useExecutionMutation } from "./execution";
import DeadlinePicker from "./DeadlinePicker";
import type {
  GoalReminderPreference,
  GoalReminderInput,
} from "../../shared/goals/types";
export default function GoalReminderPreferences({
  goalId,
  ready,
}: {
  goalId: string;
  ready: boolean;
}) {
  const w = useWorkspace();
  const path = "/goals/" + goalId + "/reminder-preference";
  const q = useExecutionRead<{
    preference: GoalReminderPreference;
  }>(path, ready);
  const [storedDraft, setDraft, retire, , prefill] = useRamInput(
    "$goal-reminder:" + goalId,
    "draft",
    () => ({
      expectedVersion: 0,
      enabled: false,
      cadence: "weekly",
      weekday: 1,
      monthDay: 1,
      localTime: "09:00",
      reason: "",
      authored: false,
    }),
  );
  const action = useExecutionMutation("$goal-reminder:" + goalId, [
    "/goals/" + goalId,
  ]);
  const draft = frozenGoalDraft(
    storedDraft,
    action.attempt,
    "reminder",
    () => ({}),
  );
  const inspect = useEffectEvent(() => {
    if (q.ready && q.data && !draft.authored)
      prefill(preferenceDraft(q.data.preference));
  });
  function preferenceDraft(p: GoalReminderPreference) {
    return {
      expectedVersion: p.version,
      enabled: p.enabled,
      cadence: p.cadence,
      weekday: p.weekday,
      monthDay: p.monthDay,
      localTime: p.localTime,
      reason: "",
      authored: false,
    };
  }
  useEffect(() => {
    inspect();
  }, [q.ready, q.data?.preference.version]);

  const [error, setError] = useState("");
  const set = (k: string, v: unknown) =>
    setDraft((d) => ({ ...d, [k]: v, authored: true }));
  async function save() {
    const captured = draft;
    try {
      const payload: GoalReminderInput = {
        expectedVersion: draft.expectedVersion,
        enabled: draft.enabled,
        cadence: draft.cadence,
        weekday: draft.weekday,
        monthDay: draft.monthDay,
        localTime: draft.localTime,
        reason: draft.reason,
      };
      await action.execute(
        path,
        action.attempt?.payload ?? { ...payload },
        "PATCH",
        () => {
          retire(captured);
          q.retry();
        },
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <Text style={ui.title}>My goal update reminder</Text>
      <Text>
        Opt-in, current owner only. Resolving the reminder does not record a
        measurement.
      </Text>
      <Action
        title={
          (draft.authored || q.ready) && draft.enabled
            ? "Reminder enabled · disable"
            : "Reminder disabled · enable"
        }
        selected={(draft.authored || q.ready) && draft.enabled}
        onPress={() => set("enabled", !draft.enabled)}
      />
      <View style={ui.row}>
        {["weekly", "monthly"].map((c) => (
          <Action
            key={c}
            title={c}
            selected={(draft.authored || q.ready) && draft.cadence === c}
            onPress={() => set("cadence", c)}
          />
        ))}
      </View>
      <Text>Weekday Monday 1–Sunday 7</Text>
      <TextInput
        style={ui.input}
        accessibilityLabel="Reminder weekday"
        keyboardType="number-pad"
        value={draft.authored || q.ready ? String(draft.weekday) : ""}
        onChangeText={(v) => set("weekday", Number(v))}
      />
      <Text>Month day 1–28</Text>
      <TextInput
        style={ui.input}
        accessibilityLabel="Reminder month day"
        keyboardType="number-pad"
        value={draft.authored || q.ready ? String(draft.monthDay) : ""}
        onChangeText={(v) => set("monthDay", Number(v))}
      />
      <DeadlinePicker
        date=""
        time={draft.authored || q.ready ? draft.localTime : ""}
        timezone={w.work?.company.timezone ?? "UTC"}
        timeOnly
        label="Company local reminder time"
        timeLabel="Reminder time"
        retainWhilePending
        onChange={(v) => set("localTime", v.time)}
      />
      <Text>Preference reason</Text>
      <TextInput
        style={ui.input}
        accessibilityLabel="Reminder preference reason"
        value={draft.reason}
        onChangeText={(v) => set("reason", v)}
      />
      <Text>
        {error ||
          action.error ||
          (!q.ready ? "Checking current preference…" : "")}
      </Text>
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
      <Action
        title="Load latest preference and version"
        disabled={action.busy || !ready || !q.ready || !q.data}
        onPress={() => {
          if (q.ready && q.data) {
            action.abandon();
            setDraft({ ...preferenceDraft(q.data.preference), authored: true });
            setError("");
          }
        }}
      />
      <Action
        title={
          action.attempt
            ? "Retry same reminder preference"
            : "Save my reminder preference"
        }
        disabled={!ready || !q.ready || action.busy || !draft.reason.trim()}
        onPress={() => void save()}
      />
    </View>
  );
}
