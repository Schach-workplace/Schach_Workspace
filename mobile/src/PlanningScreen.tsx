import { ScreenHeading, mobileUI } from "./MobileUI";
import IntelligenceLauncher from "./IntelligenceLauncher";
import { useState } from "react";
import { FlatList, Text, View } from "react-native";
import { router } from "expo-router";
import { Page, useWorkspace, type WorkTask } from "./Workspace";
import { Action, Sheet, ui } from "./ConnectUI";
import { useRamInput } from "./ramInput";
import { useExecutionRead } from "./execution";
import { NativeSchedule } from "./Execution";
import DeadlinePicker from "./DeadlinePicker";
import PersonPicker from "./PersonPicker";
import { companyDate, shiftDate } from "./workDates";
import type {
  PlanningView,
  PlanningDrill,
  PlanningTask,
  PlanningWarning,
} from "../../shared/planning/types";
import type { ScheduleContext } from "../../shared/business/types";
export default function PlanningScreen() {
  const w = useWorkspace();
  const zone = w.work?.company.timezone ?? "UTC";
  const date = companyDate(new Date(), zone);
  const start = shiftDate(
    date,
    -((new Date(date + "T12:00Z").getUTCDay() + 6) % 7),
  );
  const [period, setPeriod] = useRamInput("$planning", "period", () => ({
    from: start,
    to: shiftDate(start, 6),
    ownerId: "",
    departmentId: "",
  }));
  const [drill, setDrill] = useRamInput<PlanningDrill | undefined>(
    "$planning",
    "drill",
    undefined,
  );
  const [selected, setSelected] = useRamInput<string[]>(
    "$planning",
    "selected",
    [],
  );
  const [review, setReview] = useRamInput("$planning", "review", false);
  const qs = new URLSearchParams(period).toString();
  const summary = useExecutionRead<PlanningView>("/planning/summary?" + qs);
  const view = summary.ready ? summary.data : undefined;
  const basis = view?.projectionBasis ?? "";
  const warnings = useExecutionRead<{ warnings: PlanningWarning[] }>(
    "/planning/warnings?" + qs + "&projectionBasis=" + basis,
    !!view,
  );
  const tasks = useExecutionRead<{ tasks: PlanningTask[] }>(
    "/planning/tasks?" +
      qs +
      "&projectionBasis=" +
      basis +
      "&" +
      new URLSearchParams(drill ?? {}),
    !!view && !!drill,
  );
  const seed = useExecutionRead<{
    tasks: WorkTask[];
    context: ScheduleContext;
  }>(
    "/planning/schedule-seed?" +
      qs +
      "&projectionBasis=" +
      basis +
      "&taskIds=" +
      selected.join(","),
    review && !!view && !!selected.length,
  );
  // Keep only nonprivate measured geometry, qualified by principal and authored
  // filters. Current DTOs are still withheld during every execution refresh.
  const geometryScope = [
    w.company,
    w.session?.user.id,
    qs,
    JSON.stringify(drill),
  ].join(":");
  const [geometry, setGeometry] = useState({
    scope: geometryScope,
    header: 0,
    content: 0,
  });
  const currentGeometry =
    geometry.scope === geometryScope
      ? geometry
      : { scope: geometryScope, header: 0, content: 0 };
  const sourcePending = !view || !warnings.ready || (!!drill && !tasks.ready);
  const change = (k: string, v: string) => {
    setPeriod((p) => ({ ...p, [k]: v }));
    setDrill(undefined);
    setSelected([]);
    setReview(false);
  };
  return (
    <Page scroll={false} safeBottom>
      <FlatList
        contentContainerStyle={{
          minHeight: sourcePending ? currentGeometry.content : 0,
        }}
        onContentSizeChange={(_width, height) => {
          if (!sourcePending)
            setGeometry((g) => ({
              scope: geometryScope,
              header: g.scope === geometryScope ? g.header : 0,
              content: height,
            }));
        }}
        data={tasks.ready ? (tasks.data?.tasks ?? []) : []}
        keyExtractor={(t) => t.id}
        ListHeaderComponent={
          <View
            style={{
              gap: 12,
              minHeight: sourcePending ? currentGeometry.header : 0,
            }}
            onLayout={(e) => {
              if (!sourcePending) {
                const height = e.nativeEvent.layout.height;
                setGeometry((g) => ({
                  scope: geometryScope,
                  header: height,
                  content: g.scope === geometryScope ? g.content : 0,
                }));
              }
            }}
          >
            <Action title="‹ Back" onPress={() => router.back()} />
            <ScreenHeading
              title="Planning authorized work"
              description="Inspect capacity, then review a selected schedule."
            />
            <IntelligenceLauncher
              label="Explain selected planning facts"
              operation="report_explanation"
              choices={
                view
                  ? [
                      {
                        label: "Current capacity projection",
                        source: {
                          kind: "planning_projection",
                          id: view.projectionBasis,
                          selectedFieldSet: "capacity",
                          filters: { ...period, projectId: "" },
                        },
                      },
                    ]
                  : []
              }
            />
            <DeadlinePicker
              date={period.from}
              time=""
              timezone={zone}
              calendarOnly
              label="Planning from"
              dateLabel="Planning from"
              onChange={(v) => change("from", v.date)}
            />
            <DeadlinePicker
              date={period.to}
              time=""
              timezone={zone}
              calendarOnly
              label="Planning to"
              dateLabel="Planning to"
              onChange={(v) => change("to", v.date)}
            />
            <PersonPicker
              label="Planning owner"
              people={w.work?.people ?? []}
              value={period.ownerId}
              authorized={!!view}
              allowNone
              onChange={(id) => change("ownerId", id)}
            />
            <Action
              title="All authorized owners"
              onPress={() => change("ownerId", "")}
            />
            <Text>Planning department</Text>
            <View style={ui.row}>
              <Action
                title="All authorized departments"
                onPress={() => change("departmentId", "")}
              />
              {w.work?.departments.map((d) => (
                <Action
                  key={d.id}
                  title={d.name}
                  selected={period.departmentId === d.id}
                  onPress={() => change("departmentId", d.id)}
                />
              ))}
            </View>
            {view ? (
              <>
                <Text>{view.methodDescription}</Text>
                <Text>
                  Unique selected effort:{" "}
                  {view.coverage.uniqueSelectedRemainingHours} h
                </Text>
                <Text>
                  Weekly exposure: {view.coverage.weeklyExposureHours} h
                </Text>
                <Text>
                  Visible coverage: {view.coverage.undated} undated ·{" "}
                  {view.coverage.invalidInterval} invalid intervals ·{" "}
                  {view.coverage.recordedZeroEstimate} recorded zero ·{" "}
                  {view.coverage.missingOwner} missing owners ·{" "}
                  {view.coverage.invalidNumeric} invalid effort inputs.
                </Text>
                <View style={ui.row}>
                  {(["undated", "invalid", "zero_estimate"] as const).map(
                    (category) => (
                      <Action
                        key={category}
                        title={"Inspect " + category.replace("_", " ")}
                        onPress={() => {
                          setDrill({ category });
                          setReview(false);
                        }}
                      />
                    ),
                  )}
                </View>
                {view.weeks.map((week) => (
                  <View key={week.from} style={mobileUI.surface}>
                    <Text style={ui.title}>
                      {week.from} – {week.to}
                    </Text>
                    <Text>
                      {week.partial
                        ? "Partial selected week; whole recorded weekly capacity."
                        : "Whole recorded weekly capacity."}{" "}
                      Visible effort: {week.remainingHours} h
                    </Text>
                    {week.people.map((p) => (
                      <View key={p.id} style={mobileUI.recordBody}>
                        <Text>
                          {p.name} · Recorded capacity {p.recordedCapacity} h ·
                          Remaining {p.remainingHours} h ·{" "}
                          {p.utilization === null
                            ? p.capacityState === "recorded_zero"
                              ? "Recorded zero / utilization unavailable"
                              : "Invalid capacity / utilization unavailable"
                            : p.utilization + "% utilization"}
                        </Text>
                        <Action
                          title={"Inspect work for " + p.name}
                          onPress={() => {
                            setDrill(p.drill);
                            setReview(false);
                          }}
                        />
                      </View>
                    ))}
                    <Action
                      title="Inspect week"
                      onPress={() => {
                        setDrill(week.drill);
                        setReview(false);
                      }}
                    />
                  </View>
                ))}
                {warnings.ready &&
                  warnings.data?.warnings.map((warning, i) => (
                    <View key={i} style={mobileUI.surface}>
                      <Text>{warning.description}</Text>
                      <Action
                        title="Inspect warning work"
                        onPress={() => {
                          setDrill(warning.drill);
                          setReview(false);
                        }}
                      />
                    </View>
                  ))}
              </>
            ) : (
              <Text>
                {summary.error ?? "Checking current planning sources…"}
              </Text>
            )}
            {drill && (
              <Text accessibilityRole="header" style={mobileUI.sectionTitle}>
                Authorized task drill
              </Text>
            )}
          </View>
        }
        renderItem={({ item: t }) => (
          <View style={mobileUI.surface}>
            <Action
              title={t.title}
              onPress={() =>
                router.push({
                  pathname: "/task/[id]",
                  params: { company: w.company, id: t.id },
                })
              }
            />
            <Text>
              {t.remainingHours} h · {t.dueDate || t.state}
            </Text>
            <Action
              title="Select for schedule review"
              selected={selected.includes(t.id)}
              onPress={() => {
                setSelected((ids) =>
                  ids.includes(t.id)
                    ? ids.filter((id) => id !== t.id)
                    : [...ids, t.id],
                );
                setReview(false);
              }}
            />
          </View>
        )}
        ListFooterComponent={
          drill ? (
            <Action
              title="Review selected schedule"
              disabled={!tasks.ready || !selected.length}
              onPress={() => setReview(true)}
            />
          ) : null
        }
      />
      {review && (
        <Sheet
          title="Reviewed planning suggestion"
          onClose={() => setReview(false)}
        >
          <StableSchedule
            seed={seed.ready ? seed.data : undefined}
            ready={!!view && seed.ready}
            onDone={() => {
              setReview(false);
              setSelected([]);
              summary.retry();
            }}
          />
        </Sheet>
      )}
    </Page>
  );
}
function StableSchedule({
  seed,
  ready,
  onDone,
}: {
  seed?: { tasks: WorkTask[]; context: ScheduleContext };
  ready: boolean;
  onDone: () => void;
}) {
  const [base, setBase] = useState(seed);
  if (seed && !base) setBase(seed);
  return base ? (
    <NativeSchedule
      tasks={
        ready && seed
          ? seed.tasks
          : base.tasks.map((t) => ({ ...t, title: "" }))
      }
      context={base.context}
      ready={ready}
      onDone={onDone}
    />
  ) : (
    <Text>Checking current selected tasks and prerequisites…</Text>
  );
}
