import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Action } from "./ConnectUI";
import { colors, metrics, typeScale } from "./mobileTheme";
import { overviewAvailable } from "./overviewModel";

export type ModulePath =
  | "/overview"
  | "/projects"
  | "/calendar"
  | "/workload"
  | "/planning"
  | "/goals"
  | "/reports"
  | "/finance"
  | "/requests"
  | "/people"
  | "/intelligence/[id]";
interface Entry {
  title: string;
  description: string;
  path: ModulePath | "/account";
  group: string;
}
const workEntries: Entry[] = [
  {
    title: "Overview",
    description: "Company delivery and work needing attention",
    path: "/overview",
    group: "Plan & deliver",
  },
  {
    title: "Projects",
    description: "Initiatives, milestones and related tasks",
    path: "/projects",
    group: "Plan & deliver",
  },
  {
    title: "Calendar",
    description: "Deadlines and your upcoming agenda",
    path: "/calendar",
    group: "Plan & deliver",
  },
  {
    title: "Workload",
    description: "Recorded capacity and upcoming commitments",
    path: "/workload",
    group: "Plan & deliver",
  },
  {
    title: "Planning",
    description: "Review schedules, dependencies and conflicts",
    path: "/planning",
    group: "Plan & deliver",
  },
  {
    title: "Goals",
    description: "Measured outcomes and supporting evidence",
    path: "/goals",
    group: "Measure & manage",
  },
  {
    title: "Reports",
    description: "Delivery trends, saved reports and exports",
    path: "/reports",
    group: "Measure & manage",
  },
  {
    title: "Finance",
    description: "Expenses, budgets and financial decisions",
    path: "/finance",
    group: "Measure & manage",
  },
  {
    title: "Requests",
    description: "Review incoming work and expense requests",
    path: "/requests",
    group: "Measure & manage",
  },
  {
    title: "People",
    description: "Company members, onboarding and access",
    path: "/people",
    group: "Measure & manage",
  },
];
const personalEntries: Entry[] = [
  {
    title: "Local assistance history",
    description: "Your selected-source assistance jobs",
    path: "/intelligence/[id]",
    group: "Your workspace",
  },
  {
    title: "Account",
    description: "Sign-in security, devices and preferences",
    path: "/account",
    group: "Your workspace",
  },
];
export default function ModuleDirectory({
  workReady,
  role,
  onOpen,
  onAccount,
}: {
  workReady: boolean;
  role?: string;
  onOpen: (path: ModulePath) => void;
  onAccount: () => void;
}) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLocaleLowerCase();
  const entries = [
    ...(workReady
      ? workEntries.filter(
          (e) =>
            (e.path !== "/finance" || role !== "viewer") &&
            (e.path !== "/overview" || (!!role && overviewAvailable(role))),
        )
      : []),
    ...personalEntries,
  ].filter((e) =>
    `${e.title} ${e.description} ${e.group}`.toLocaleLowerCase().includes(term),
  );
  return (
    <View style={s.directory}>
      <View style={s.intro}>
        <Text style={s.title} accessibilityRole="header">
          Explore your workspace
        </Text>
        <Text style={s.description}>
          Find the tools you need for your next step.
        </Text>
      </View>
      <TextInput
        accessibilityLabel="Search modules"
        placeholder="Search modules or what you want to do"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        style={s.search}
      />
      {!!query && <Action title="Clear search" onPress={() => setQuery("")} />}
      {!workReady && (
        <Text style={s.description}>
          Company tools appear when current company access is available.
        </Text>
      )}
      {entries.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>No matching modules</Text>
          <Text style={s.description}>
            Try another word or clear your search.
          </Text>
        </View>
      ) : (
        [...new Set(entries.map((e) => e.group))].map((group) => (
          <View key={group} style={s.group}>
            <Text accessibilityRole="header" style={s.groupTitle}>
              {group}
            </Text>
            <View style={s.card}>
              {entries
                .filter((e) => e.group === group)
                .map((entry) => (
                  <Pressable
                    key={entry.path}
                    accessibilityRole="button"
                    accessibilityLabel={entry.title}
                    accessibilityHint={entry.description}
                    onPress={() =>
                      entry.path === "/account"
                        ? onAccount()
                        : onOpen(entry.path)
                    }
                    style={({ pressed }) => [s.row, pressed && s.pressed]}
                  >
                    <View style={s.rowBody}>
                      <Text style={s.rowTitle}>{entry.title}</Text>
                      <Text style={s.description}>{entry.description}</Text>
                    </View>
                    <Text style={s.chevron} accessible={false}>
                      ›
                    </Text>
                  </Pressable>
                ))}
            </View>
          </View>
        ))
      )}
    </View>
  );
}
const s = StyleSheet.create({
  directory: { gap: 16 },
  intro: { gap: 8, paddingTop: 8 },
  title: { fontSize: typeScale.heading, color: colors.text, fontWeight: "700" },
  description: {
    fontSize: typeScale.support,
    color: colors.secondary,
    lineHeight: 21,
  },
  search: {
    minHeight: metrics.input,
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: metrics.radius,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: typeScale.body,
  },
  group: { gap: 10 },
  groupTitle: {
    fontSize: typeScale.support,
    color: colors.secondary,
    fontWeight: "700",
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  row: {
    minHeight: 76,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowBody: { flex: 1, gap: 5 },
  rowTitle: { fontSize: typeScale.body, fontWeight: "600", color: colors.text },
  chevron: { fontSize: 26, color: colors.secondary },
  pressed: { backgroundColor: colors.accentSoft },
  empty: {
    padding: 20,
    gap: 10,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  emptyTitle: {
    fontSize: typeScale.title,
    fontWeight: "600",
    color: colors.text,
  },
});
