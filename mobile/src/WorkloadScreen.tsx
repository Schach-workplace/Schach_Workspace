import { ScreenHeading, mobileUI } from "./MobileUI";
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
// Same params, order and allowed values as the browser PlanningView
// (`new URLSearchParams(period)`); empty means "all authorized".
export function workloadQuery(period: {
  from: string;
  to: string;
  ownerId: string;
  departmentId: string;
}) {
  return new URLSearchParams({
    from: period.from,
    to: period.to,
    ownerId: period.ownerId,
    departmentId: period.departmentId,
  }).toString();
}
const noFilters = { ownerId: "", departmentId: "" };
const hours = (n: number) => (Math.round(n * 10) / 10).toString() + "h";
const utilization = (u: number | null) =>
  u === null ? "utilization unavailable" : u + "% utilization";
export default function WorkloadScreen() {
  const w = useWorkspace();
  const zone = w.work?.company.timezone ?? "UTC";
  const [from, setFrom] = useState(() => weekOf(companyDate(new Date(), zone)));
  const [weeks, setWeeks] = useState(2);
  const [pulled, setPulled] = useState(false);
  // Filters belong to one company/user/policy scope; any change resets them.
  const scope = `${w.company}:${w.session?.user.id}:${w.policyEpoch}`;
  const [filters, setFilters] = useState({ ...noFilters, scope });
  if (filters.scope !== scope) setFilters({ ...noFilters, scope });
  const [choosing, setChoosing] = useState<"" | "owner" | "department">("");
  // Choices come only from the directory the server returned for this role.
  const owners = (w.work?.people ?? []).filter((p) => p.active);
  const departments = w.work?.departments ?? [];
  const owner = owners.find((p) => p.id === filters.ownerId);
  const department = departments.find((d) => d.id === filters.departmentId);
  const choose = (next: Partial<typeof noFilters>) => {
    setFilters((f) => ({ ...f, ...next }));
    setChoosing("");
  };
  const to = shiftDate(from, weeks * 7 - 1);
  const summary = useExecutionRead<PlanningView>(
    "/planning/summary?" +
      workloadQuery({
        from,
        to,
        ownerId: owner?.id ?? "",
        departmentId: department?.id ?? "",
      }),
  );
  const view = summary.ready ? summary.data : undefined;
  const people = view?.weeks.flatMap((x) => x.people) ?? [];
  const content = () => {
    if (summary.denied)
      return (
        <View style={mobileUI.surface}>
          <Text style={ui.error} accessibilityRole="alert">
            {"Access denied: your current role cannot view workload for this scope. " +
              (summary.error ?? "")}
          </Text>
        </View>
      );
    if (summary.error)
      return (
        <View style={mobileUI.surface}>
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
          <View key={week.from} style={mobileUI.surface}>
            <Text accessibilityRole="header" style={mobileUI.sectionTitle}>
              {`Week ${week.selectedFrom} – ${week.selectedTo}${week.partial ? " (partial)" : ""}`}
            </Text>
            <Text style={ui.subtitle}>
              {`${hours(week.remainingHours)} remaining · ${hours(week.positiveCapacityHours)} capacity · ${utilization(week.utilization)}`}
            </Text>
            {week.people.map((p) => (
              <View
                key={p.id}
                style={mobileUI.record}
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
      <ScreenHeading
        title="Workload"
        description={`Read-only · ${from} – ${to}`}
      />
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
      <View style={ui.row}>
        <Action
          title={"Owner: " + (owner?.name ?? "All authorized owners")}
          selected={choosing === "owner"}
          onPress={() => setChoosing(choosing === "owner" ? "" : "owner")}
        />
        <Action
          title={
            "Department: " + (department?.name ?? "All authorized departments")
          }
          selected={choosing === "department"}
          onPress={() =>
            setChoosing(choosing === "department" ? "" : "department")
          }
        />
      </View>
      {choosing === "owner" && (
        <View style={[ui.row, { flexWrap: "wrap" }]}>
          <Action
            title="All authorized owners"
            selected={!owner}
            onPress={() => choose({ ownerId: "" })}
          />
          {owners.map((p) => (
            <Action
              key={p.id}
              title={p.name}
              selected={owner?.id === p.id}
              onPress={() => choose({ ownerId: p.id })}
            />
          ))}
        </View>
      )}
      {choosing === "department" && (
        <View style={[ui.row, { flexWrap: "wrap" }]}>
          <Action
            title="All authorized departments"
            selected={!department}
            onPress={() => choose({ departmentId: "" })}
          />
          {departments.map((d) => (
            <Action
              key={d.id}
              title={d.name}
              selected={department?.id === d.id}
              onPress={() => choose({ departmentId: d.id })}
            />
          ))}
        </View>
      )}
      {(owner || department) && (
        <View style={ui.row}>
          <Text style={ui.metadata}>
            {"Filtered: " +
              [
                owner && "owner " + owner.name,
                department && "department " + department.name,
              ]
                .filter(Boolean)
                .join(" · ")}
          </Text>
          <Action title="Clear filters" onPress={() => choose(noFilters)} />
        </View>
      )}
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
