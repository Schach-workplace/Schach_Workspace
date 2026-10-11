import { useState } from "react";
import { FlatList, Text, View } from "react-native";
import { router } from "expo-router";
import { Page, useWorkspace } from "./Workspace";
import { Action, ui } from "./ConnectUI";
import { useExecutionRead } from "./execution";
import GoalMetadataForm from "./GoalMetadataForm";
import type { MeasuredGoal } from "../../shared/goals/types";
export default function GoalsScreen() {
  const w = useWorkspace();
  const q = useExecutionRead<{ goals: MeasuredGoal[] }>("/goals");
  const [creating, setCreating] = useState(false);
  return (
    <Page scroll={false} safeBottom>
      <View style={ui.row}>
        <Action title="‹ Back" onPress={() => router.back()} />
        {["founder", "ceo", "admin", "head", "manager"].includes(
          w.work?.me.role ?? "",
        ) && (
          <Action title="New measured goal" onPress={() => setCreating(true)} />
        )}
      </View>
      <Text style={ui.title}>Measured outcomes</Text>
      <Text>
        Task progress never changes independent measurements. Raw values remain
        visible; attainment is bounded.
      </Text>
      <FlatList
        data={q.ready ? (q.data?.goals ?? []) : []}
        keyExtractor={(g) => g.id}
        ListEmptyComponent={
          <Text>
            {q.error ??
              (q.ready
                ? "No goals in current scope."
                : "Checking current goals…")}
          </Text>
        }
        renderItem={({ item: g }) => (
          <View style={{ gap: 8, paddingVertical: 12 }}>
            <Text style={ui.title}>{g.name}</Text>
            <Text>
              Current: {g.current} {g.unit} · Baseline: {g.baseline} · Target:{" "}
              {g.target}
              {g.target < g.baseline ? " · Lower is better" : ""}
            </Text>
            <Action
              title={"Open " + g.name}
              onPress={() =>
                router.push({
                  pathname: "/goals/[id]",
                  params: { company: w.company, id: g.id },
                })
              }
            />
          </View>
        )}
      />
      {creating && (
        <GoalMetadataForm
          ready
          onClose={() => {
            setCreating(false);
            q.retry();
          }}
        />
      )}
    </Page>
  );
}
