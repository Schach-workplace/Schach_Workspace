import CalendarExport from "./CalendarExport";
import { ScreenHeading, mobileUI } from "./MobileUI";
import { useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import { router } from "expo-router";
import { Page, useWorkspace } from "./Workspace";
import { Action, ui } from "./ConnectUI";
import { useExecutionRead } from "./execution";
import { companyDate, shiftDate } from "./workDates";
import {
  AGENDA_DAYS,
  agendaPath,
  groupAgenda,
  type AgendaView,
} from "./deadlineAgenda";
/** Read-only, day-grouped view of open deadlines from /planning/calendar. */
export default function DeadlineAgenda() {
  const w = useWorkspace();
  const zone = w.work?.company.timezone || "Asia/Kolkata";
  const [exporting, setExporting] = useState(false);
  const [from, setFrom] = useState(() => companyDate(new Date(), zone));
  const to = shiftDate(from, AGENDA_DAYS - 1);
  const agenda = useExecutionRead<AgendaView>(agendaPath(from, to));
  const complete = agenda.ready && agenda.data?.complete === true;
  const groups = complete ? groupAgenda(agenda.data!.tasks, zone) : [];
  const person = (id: string) =>
    w.work?.people.find((p) => p.id === id)?.name || "Unassigned";
  const day = (date: string) =>
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(new Date(date + "T12:00:00Z"));
  return (
    <Page scroll={false}>
      <View style={ui.row}>
        <Action title="‹ Back" onPress={() => router.back()} />
        <ScreenHeading title="Deadline agenda" />
      </View>
      <Text style={ui.subtitle}>
        Open authorized work · {from} to {to} · {zone}
      </Text>
      <View style={ui.row}>
        <Action
          title="Earlier"
          onPress={() => setFrom((d) => shiftDate(d, -AGENDA_DAYS))}
        />
        <Action
          title="Today"
          onPress={() => setFrom(companyDate(new Date(), zone))}
        />
        <Action
          title="Later"
          onPress={() => setFrom((d) => shiftDate(d, AGENDA_DAYS))}
        />
      </View>
      <Action
        title="Export calendar"
        disabled={!complete}
        onPress={() => setExporting(true)}
      />
      {exporting && (
        <CalendarExport
          key={
            w.company +
            ":" +
            w.session?.user.id +
            ":" +
            w.policyEpoch +
            ":" +
            from
          }
          from={from}
          to={to}
          onClose={() => setExporting(false)}
        />
      )}
      {agenda.loading && <Text>Loading current deadlines…</Text>}
      {!!agenda.error && <Text accessibilityRole="alert">{agenda.error}</Text>}
      {agenda.ready && !complete && (
        <Text accessibilityRole="alert">
          The calendar is incomplete. Retry before relying on it.
        </Text>
      )}
      {complete && !groups.length && (
        <Text style={ui.subtitle}>No open deadlines in this range.</Text>
      )}
      <FlatList
        data={groups}
        keyExtractor={(g) => g.date}
        refreshControl={
          <RefreshControl
            refreshing={agenda.loading}
            onRefresh={() => agenda.retry()}
          />
        }
        renderItem={({ item: g }) => (
          <View style={mobileUI.surface}>
            <Text accessibilityRole="header" style={mobileUI.sectionTitle}>
              {day(g.date)} · {g.rows.length}{" "}
              {g.rows.length === 1 ? "deadline" : "deadlines"}
            </Text>
            {g.rows.map(({ task: t, time }) => (
              <Action
                key={t.id}
                title={`${time || "All day"} · ${t.title} · ${person(t.ownerId)} · ${t.status.replaceAll("_", " ")}`}
                onPress={() =>
                  router.push({
                    pathname: "/task/[id]",
                    params: { id: t.id, company: w.company },
                  })
                }
              />
            ))}
          </View>
        )}
      />
    </Page>
  );
}
