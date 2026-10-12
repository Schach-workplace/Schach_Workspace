import { useRef, useState, useEffect } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { Page, useWorkspace } from "./Workspace";
import { ui } from "./ConnectUI";
import {
  overview,
  overviewAvailable,
  percent,
  type OverviewSource,
} from "./overviewModel";
// Read-only mobile Overview. It summarizes the current bootstrap and scoped
// task pages already loaded by the workspace (the same /bootstrap + /tasks
// reads the browser Overview uses) and never writes.
export default function OverviewScreen() {
  const w = useWorkspace();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      await w.refresh("all");
    } catch (e) {
      if (alive.current)
        setError((e as Error).message || "Unable to refresh the overview.");
    } finally {
      if (alive.current) setRefreshing(false);
    }
  }
  const source = w.work as unknown as OverviewSource | null;
  const body = () => {
    if (!source)
      return (
        <Text style={ui.subtitle} accessibilityRole="progressbar">
          Loading the current company overview…
        </Text>
      );
    if (!overviewAvailable(source.me.role))
      return (
        <View style={ui.section}>
          <Text style={ui.body}>
            The company overview is available to leadership roles. Your own
            commitments are in Work.
          </Text>
        </View>
      );
    const v = overview(source);
    const person = (id: string) =>
      source.people.find((p) => p.id === id)?.name ?? "Company member";
    const max = Math.max(2, ...v.pulse.map((d) => d.accepted));
    return (
      <>
        <View style={ui.row}>
          {v.cards.map((c) => (
            <View
              key={c.title}
              style={[ui.bubble, { minWidth: 150, flexGrow: 1 }]}
              accessible
              accessibilityLabel={`${c.title}: ${c.value}. ${c.detail}`}
            >
              <Text style={ui.subtitle}>{c.title}</Text>
              <Text style={ui.title}>{c.value}</Text>
              <Text style={ui.metadata}>{c.detail}</Text>
            </View>
          ))}
        </View>
        <View style={ui.section}>
          <Text style={ui.name}>Needs attention</Text>
          <Text style={ui.subtitle}>
            {v.attention.length} distinct tasks need a decision, support or a
            new plan.
          </Text>
          {v.attention.slice(0, 8).map((t) => (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              accessibilityLabel={`Open task ${t.title}`}
              style={ui.conversation}
              onPress={() =>
                router.push({
                  pathname: "/task/[id]",
                  params: { id: t.id, company: w.company },
                })
              }
            >
              <View style={{ flex: 1 }}>
                <Text style={ui.body}>{t.title}</Text>
                <Text style={ui.metadata}>
                  {person(t.ownerId)} · {t.status.replace("_", " ")}
                  {t.dueDate ? " · due " + t.dueDate : ""}
                </Text>
              </View>
            </Pressable>
          ))}
          {v.attention.length === 0 && (
            <Text style={ui.subtitle}>Nothing needs attention right now.</Text>
          )}
        </View>
        <View style={ui.section}>
          <Text style={ui.name}>Delivery pulse</Text>
          <Text style={ui.subtitle}>Accepted work · last 7 days</Text>
          {v.pulse.map((d) => (
            <View
              key={d.day}
              style={ui.row}
              accessible
              accessibilityLabel={`${d.day}: ${d.accepted} accepted`}
            >
              <Text style={[ui.metadata, { width: 92 }]}>{d.day}</Text>
              <View
                style={{
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: "#b9520c",
                  width: `${Math.max(2, (d.accepted / max) * 60)}%`,
                }}
              />
              <Text style={ui.metadata}>{String(d.accepted)}</Text>
            </View>
          ))}
        </View>
        <View style={ui.section}>
          <Text style={ui.name}>Across departments</Text>
          {v.departments.map((d) => (
            <View key={d.id} style={ui.conversation}>
              <View style={{ flex: 1 }}>
                <Text style={ui.body}>{d.name}</Text>
                <Text style={ui.metadata}>
                  {d.open} open · {d.overdue} overdue · {d.accepted}/{d.total}{" "}
                  accepted
                </Text>
              </View>
            </View>
          ))}
          {v.departments.length === 0 && (
            <Text style={ui.subtitle}>No departments are visible yet.</Text>
          )}
        </View>
        <View style={ui.section}>
          <Text style={ui.name}>Project health</Text>
          {v.projects.map((p) => (
            <View key={p.id} style={ui.conversation}>
              <View style={{ flex: 1 }}>
                <Text style={ui.body}>{p.name}</Text>
                <Text style={ui.metadata}>
                  {p.risk ? `${p.risk} need attention` : "No overdue work"} ·{" "}
                  {p.accepted}/{p.total} accepted (
                  {percent(p.accepted, p.total)}%)
                </Text>
              </View>
            </View>
          ))}
          {v.projects.length === 0 && (
            <Text style={ui.subtitle}>No active projects.</Text>
          )}
        </View>
        <View style={ui.section}>
          <Text style={ui.name}>Latest activity</Text>
          {v.activities.map((a) => (
            <View key={a.id} style={ui.conversation}>
              <View style={{ flex: 1 }}>
                <Text style={ui.body}>
                  {person(a.userId)} {a.action.replace(/_/g, " ")}
                </Text>
                {!!a.detail && <Text style={ui.metadata}>{a.detail}</Text>}
                <Text style={ui.metadata}>{a.createdAt.slice(0, 10)}</Text>
              </View>
            </View>
          ))}
          {v.activities.length === 0 && (
            <Text style={ui.subtitle}>No recent activity is visible.</Text>
          )}
        </View>
      </>
    );
  };
  return (
    <Page scroll={false}>
      <View style={ui.header}>
        <View style={{ flexShrink: 1 }}>
          <Text style={ui.title}>Overview</Text>
          <Text style={ui.subtitle}>
            Read-only · current role and company scope
          </Text>
        </View>
      </View>
      {!!error && (
        <Text style={ui.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <ScrollView
        contentContainerStyle={{ paddingVertical: 12, gap: 8 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
          />
        }
      >
        {body()}
      </ScrollView>
    </Page>
  );
}
