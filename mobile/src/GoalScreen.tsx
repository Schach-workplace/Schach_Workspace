import { useState } from "react";
import { Text, View, FlatList } from "react-native";
import { router } from "expo-router";
import { Page, useWorkspace } from "./Workspace";
import { Action, Sheet, ui } from "./ConnectUI";
import { useExecutionRead } from "./execution";
import GoalMeasurementForm from "./GoalMeasurementForm";
import GoalReminderPreferences from "./GoalReminderPreferences";
import GoalMetadataForm from "./GoalMetadataForm";
import type {
  GoalDetail,
  GoalMeasurement,
  MeasuredGoal,
} from "../../shared/goals/types";
export default function GoalScreen({ id }: { id: string }) {
  const w = useWorkspace();
  const q = useExecutionRead<GoalDetail>("/goals/" + id);
  const history = useExecutionRead<{ measurements: GoalMeasurement[] }>(
    "/goals/" + id + "/measurements",
  );
  const [measure, setMeasure] = useState(false);
  const [correction, setCorrection] = useState<GoalMeasurement>();
  const [reminder, setReminder] = useState(false);
  const [metadata, setMetadata] = useState<MeasuredGoal>();
  const goal = q.ready ? q.data?.goal : undefined;
  const neutral: MeasuredGoal = {
    id,
    companyId: w.company,
    version: 0,
    name: "",
    description: "",
    ownerId: "",
    departmentId: "",
    unit: "",
    baseline: 0,
    target: 1,
    current: 0,
    dueDate: "",
    taskIds: [],
    currentMeasurementId: "",
    measurementCoverageFrom: null,
    legacyObservedCurrent: null,
    legacyObservedUnit: "",
  };
  const permitted = q.ready && !!q.data?.canMeasure;
  const corrected = new Set(
    history.ready ? history.data?.measurements.map((m) => m.correctsId) : [],
  );
  return (
    <Page scroll={false} safeBottom>
      <FlatList
        data={history.ready ? (history.data?.measurements ?? []) : []}
        keyExtractor={(m) => m.id}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <Action title="‹ Back" onPress={() => router.back()} />
            <Text style={ui.title}>
              {goal?.name ?? "Checking current goal…"}
            </Text>
            {goal ? (
              <>
                <Text>
                  Current result: {goal.current} {goal.unit} · Baseline:{" "}
                  {goal.baseline} · Target: {goal.target} · Attainment:{" "}
                  {q.data?.attainment === null
                    ? "Unavailable"
                    : q.data?.attainment.toFixed(1) + "%"}
                </Text>
                {!goal.currentMeasurementId && (
                  <Text>
                    Current recorded before measurement history; earlier history
                    unknown.
                  </Text>
                )}
                {goal.taskIds.map((t) => (
                  <Action
                    key={t}
                    title="Open contributing task"
                    onPress={() =>
                      router.push({
                        pathname: "/task/[id]",
                        params: { company: w.company, id: t },
                      })
                    }
                  />
                ))}
                {permitted && (
                  <Action
                    title="Update measured result"
                    primary
                    onPress={() => {
                      setCorrection(undefined);
                      setMeasure(true);
                    }}
                  />
                )}
                {q.data?.canEdit && (
                  <Action
                    title="Edit goal metadata"
                    onPress={() => setMetadata(goal)}
                  />
                )}
                {goal.ownerId === w.session?.user.id && permitted && (
                  <Action
                    title="My reminder preference"
                    onPress={() => setReminder(true)}
                  />
                )}
              </>
            ) : (
              <Text>{q.error ?? "Checking current goal access…"}</Text>
            )}
            <Text style={ui.title}>Immutable measurement history</Text>
            <Text>
              Observed time and recorded time are separate. Corrections retain
              the original metric definition.
            </Text>
          </View>
        }
        ListEmptyComponent={
          <Text>
            {history.error ??
              (history.ready
                ? "No measurements recorded; earlier history unknown."
                : "Checking current history…")}
          </Text>
        }
        renderItem={({ item: m }) => (
          <View style={{ gap: 8, paddingVertical: 16 }}>
            <Text>
              {m.value} {m.unit} · Baseline then {m.baseline} · Target then{" "}
              {m.target}
            </Text>
            <Text>Observed: {m.effectiveAt}</Text>
            <Text>
              Recorded: {m.createdAt} by {m.actorName}
            </Text>
            <Text>{m.reason}</Text>
            {m.correctsId && (
              <Text>Immutable correction of an earlier measurement.</Text>
            )}
            {m.evidence.map((e, i) => (
              <View key={i}>
                {e.status === "evidence_unavailable" ? (
                  <Text>Evidence unavailable</Text>
                ) : (
                  <>
                    <Text>{e.label}</Text>
                    <Text>
                      {e.status === "changed_since_measurement"
                        ? "Source changed since measurement"
                        : e.excerpt}
                    </Text>
                    {e.kind === "task" || e.kind === "task_comment" ? (
                      <Action
                        title="Open evidence task"
                        onPress={() =>
                          router.push({
                            pathname: "/task/[id]",
                            params: {
                              company: w.company,
                              id: e.kind === "task" ? e.sourceId : e.parentId,
                            },
                          })
                        }
                      />
                    ) : e.kind === "report_snapshot" ? (
                      <Action
                        title="Open evidence report"
                        onPress={() =>
                          router.push({
                            pathname: "/report/[id]",
                            params: { company: w.company, id: e.sourceId },
                          })
                        }
                      />
                    ) : e.kind === "message" ? (
                      <Action
                        title="Open evidence conversation"
                        onPress={() =>
                          router.push({
                            pathname: "/chat/[id]",
                            params: { company: w.company, id: e.parentId },
                          })
                        }
                      />
                    ) : null}
                  </>
                )}
              </View>
            ))}
            {permitted && !corrected.has(m.id) && (
              <Action
                title={
                  goal?.currentMeasurementId === m.id
                    ? "Correct current measurement"
                    : "Correct older measurement"
                }
                onPress={() => {
                  setCorrection(m);
                  setMeasure(false);
                }}
              />
            )}
          </View>
        )}
      />
      {(measure || correction) && (
        <Sheet
          scroll={false}
          title={correction ? "Correct measurement" : "Measured result"}
          onClose={() => {
            setMeasure(false);
            setCorrection(undefined);
          }}
        >
          <GoalMeasurementForm
            goal={goal ?? neutral}
            correction={correction}
            ready={permitted}
            onSaved={() => {
              q.retry();
              history.retry();
            }}
          />
        </Sheet>
      )}
      {reminder && (
        <Sheet title="My goal reminder" onClose={() => setReminder(false)}>
          <GoalReminderPreferences goalId={id} ready={permitted} />
        </Sheet>
      )}
      {metadata && (
        <GoalMetadataForm
          item={metadata}
          ready={q.ready && !!q.data?.canEdit}
          onClose={() => {
            setMetadata(undefined);
            q.retry();
          }}
        />
      )}
    </Page>
  );
}
