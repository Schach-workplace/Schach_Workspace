import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { Page, useWorkspace } from "./Workspace";
import { Action, ui } from "./ConnectUI";
import { useExecutionRead } from "./execution";
import { companyDate, shiftDate } from "./workDates";
import type { PlanningView } from "../../shared/planning/types";
// Read-only Workload: the same /planning/summary read the browser Workload
// (PlanningView) uses. It shows exactly what the server returns for the
// current role; a denial is surfaced, never worked around.
export function weekOf(date: string) {
  return shiftDate(date, -((new Date(date + "T12:00Z").getUTCDay() + 6) % 7));
}
const hours = (n: number) => (Math.round(n * 10) / 10).toString() + "h";
const utilization = (u: number | null) =>
  u === null ? "utilization unavailable" : u + "% utilization";
export default function WorkloadScreen() {
  const w = useWorkspace();
  const zone = w.work?.company.timezone ?? "UTC";
  const [from, setFrom] = useState(() =>
    weekOf(companyDate(new Date(), zone)),
  );
  const [weeks, setWeeks] = useState(2);
  const [pulled, setPulled] = useState(false);
  const to = shiftDate(from, weeks * 7 - 1);
  const summary = useExecutionRead<PlanningView>(
    "/planning/summary?" + new URLSearchParams({ from, to }),
  );
  const view = summary.ready ? summary.data : undefined;
  const people = view?.weeks.flatMap((x) => x.people) ?? [];
  const content = () => {
    if (summary.denied)
      return (
        <View style={ui.section}>
          <Text style={ui.error} accessibilityRole="alert">
            {"Access denied: your current role cannot view workload for this scope. " +
              (summary.error ?? "")}
          </Text>
        </View>
      );
    if (summary.error)
      return (
        <View style={ui.section}>
          <Text style={ui.error} accessibilityRole="alert">
            {summary.error}
          </Text>
          <Action title="Retry workload" onPress={summary.retry} />
        </View>
      );
    if (!view)
      return (
        <Text style={ui.subtitle} accessibilityRole="progressbar">
          Loading currently authorized workload…
        </Text>
      );
    if (!view.coverage.visibleTasks && !people.length)
      return (
        <Text style={ui.subtitle}>
          No visible work or recorded capacity in this period.
        </Text>
      );
    return (
      <>
        <Text style={ui.metadata}>{view.methodDescription}</Text>
        <Text style={ui.metadata}>
          {`${view.coverage.visibleTasks} visible tasks · ${hours(view.coverage.uniqueSelectedRemainingHours)} remaining · ${view.coverage.undated} undated · ${view.coverage.recordedZeroEstimate} without estimate · ${view.coverage.missingOwner} without owner`}
        </Text>
        {view.weeks.map((week) => (
          <View key={week.from} style={ui.section}>
            <Text style={ui.name}>
              {`Week ${week.selectedFrom} – ${week.selectedTo}${week.partial ? " (partial)" : ""}`}
            </Text>
            <Text style={ui.subtitle}>
              {`${hours(week.remainingHours)} remaining · ${hours(week.positiveCapacityHours)} capacity · ${utilization(week.utilization)}`}
            </Text>
            {week.people.map((p) => (
              <View
                key={p.id}
                style={ui.conversation}
                accessible
                accessibilityLabel={`${p.name}: ${hours(p.remainingHours)} remaining, ${utilization(p.utilization)}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={ui.body}>{p.name}</Text>
                  <Text style={ui.metadata}>
                    {`${hours(p.remainingHours)} remaining · ${
                      p.capacityState === "recorded_positive"
                        ? hours(p.recordedCapacity) + " capacity"
                        : p.capacityState === "recorded_zero"
                          ? "zero recorded capacity"
                          : "capacity not recorded"
                    } · ${utilization(p.utilization)}`}
                  </Text>
                </View>
              </View>
            ))}
            {week.people.length === 0 && (
              <Text style={ui.subtitle}>No people with visible work.</Text>
            )}
          </View>
        ))}
        <Text style={ui.metadata}>
          {`Times in ${view.timezone} · generated ${view.generatedAt}`}
        </Text>
      </>
    );
  };
  return (
    <Page scroll={false}>
      <View style={ui.header}>
        <View style={{ flexShrink: 1 }}>
          <Text style={ui.title}>Workload</Text>
          <Text style={ui.subtitle}>
            {`Read-only · ${from} – ${to}`}
          </Text>
        </View>
      </View>
      <View style={ui.row}>
        <Action title="Previous" onPress={() => setFrom(shiftDate(from, -7))} />
        <Action
          title="This week"
          onPress={() => setFrom(weekOf(companyDate(new Date(), zone)))}
        />
        <Action title="Next" onPress={() => setFrom(shiftDate(from, 7))} />
        <Action
          title={weeks === 2 ? "4 weeks" : "2 weeks"}
          onPress={() => setWeeks(weeks === 2 ? 4 : 2)}
        />
      </View>
      <ScrollView
        contentContainerStyle={{ paddingVertical: 12, gap: 8 }}
        refreshControl={
          <RefreshControl
            refreshing={pulled && summary.loading}
            onRefresh={() => {
              setPulled(true);
              summary.retry();
            }}
          />
        }
      >
        {content()}
      </ScrollView>
    </Page>
  );
}
