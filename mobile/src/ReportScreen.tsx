import IntelligenceLauncher from "./IntelligenceLauncher";
import { useExecutionRead } from "./execution";
import { companyDate } from "./workDates";
import { useState } from "react";
import { FlatList, Text, View } from "react-native";
import { router } from "expo-router";
import { Page, useWorkspace } from "./Workspace";
import { Action, ui } from "./ConnectUI";
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
      <View style={ui.row}>
        <Action title="‹ Back" onPress={() => router.back()} />
        <Action
          title="Current state"
          selected={basis === "current"}
          onPress={() => setBasis("current")}
        />
        <Action
          title="Historical reports"
          selected={basis === "history"}
          onPress={() => setBasis("history")}
        />
        <Action
          title="Saved reports"
          selected={basis === "saved"}
          onPress={() => setBasis("saved")}
        />
      </View>
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
          ListHeaderComponent={
            <View>
              <CurrentReportAssistance />
              <Text>
                Current-state report · {w.work?.company.timezone} · later task
                changes can change these values. {w.work?.tasks.length ?? 0}{" "}
                currently authorized tasks.
              </Text>
            </View>
          }
          renderItem={({ item: t }) => (
            <Action
              title={t.title + " · " + t.status}
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
