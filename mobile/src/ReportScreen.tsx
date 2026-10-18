import IntelligenceLauncher from "./IntelligenceLauncher";
import { useExecutionRead } from "./execution";
import { companyDate } from "./workDates";
import { useState } from "react";
import { FlatList, Text, View } from "react-native";
import { router } from "expo-router";
import { Page, useWorkspace } from "./Workspace";
import {
  ScreenHeading,
  FilterBar,
  Surface,
  RecordCard,
  EmptyState,
  mobileUI,
} from "./MobileUI";
import { Action } from "./ConnectUI";
import HistoricalReports from "./HistoricalReports";
import SavedReports from "./SavedReports";
export default function ReportScreen({
  id = "",
  kind = "snapshot",
}: {
  id?: string;
  kind?: string;
}) {
  const w = useWorkspace();
  const [basis, setBasis] = useState(id ? "history" : "current");
  const [snapshot, setSnapshot] = useState(id && kind !== "job" ? id : "");
  return (
    <Page scroll={false} safeBottom>
      <Action title="‹ Back" onPress={() => router.back()} />
      <ScreenHeading title="Reports" />
      <FilterBar
        label="Report basis"
        value={basis}
        options={[
          { value: "current", label: "Current state" },
          { value: "history", label: "Historical reports" },
          { value: "saved", label: "Saved reports" },
        ]}
        onChange={setBasis}
      />
      {basis === "history" ? (
        <HistoricalReports
          key={snapshot || id || "new"}
          initialId={snapshot}
          initialJob={kind === "job" ? id : ""}
        />
      ) : basis === "saved" ? (
        <SavedReports
          onOpen={(sid) => {
            setSnapshot(sid);
            setBasis("history");
          }}
        />
      ) : (
        <FlatList
          data={w.foreground ? (w.work?.tasks ?? []) : []}
          keyExtractor={(t) => t.id}
          contentContainerStyle={mobileUI.listContent}
          ListEmptyComponent={
            <EmptyState
              title="No currently visible tasks"
              description="Current access and task changes determine this view."
            />
          }
          ListHeaderComponent={
            <View>
              <Surface>
                <Text style={mobileUI.sectionTitle}>Current visibility</Text>
                <Text style={mobileUI.secondary}>
                  Current-state report · {w.work?.company.timezone} · later task
                  changes can change these values. {w.work?.tasks.length ?? 0}{" "}
                  currently authorized tasks.
                </Text>
              </Surface>
              <CurrentReportAssistance />
            </View>
          }
          renderItem={({ item: t }) => (
            <RecordCard
              title={t.title}
              status={t.status}
              label={t.title + " · " + t.status}
              onPress={() =>
                router.push({
                  pathname: "/task/[id]",
                  params: { id: t.id, company: w.company },
                })
              }
            />
          )}
        />
      )}
    </Page>
  );
}

function CurrentReportAssistance() {
  const w = useWorkspace();
  const date = companyDate(new Date(), w.work?.company.timezone ?? "UTC");
  const q = useExecutionRead<{ snapshot: string }>(
    "/reports/tasks/summary?from=" + date.slice(0, 7) + "-01&to=" + date,
  );
  return (
    <IntelligenceLauncher
      operation="report_explanation"
      sourceRead={{ ready: q.ready, denied: !!q.denied }}
      choices={
        q.ready && q.data
          ? [
              {
                label: "Current month report facts",
                source: {
                  kind: "report_current",
                  id: q.data.snapshot,
                  selectedFieldSet: "metrics",
                },
              },
            ]
          : []
      }
    />
  );
}
