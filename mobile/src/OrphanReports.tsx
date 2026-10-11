import { useLayoutEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useWorkspace } from "./Workspace";
import { Action } from "./ConnectUI";
import { useExecutionRead, useExecutionMutation } from "./execution";
import type { OrphanDefinition } from "../../shared/reports/types";
export default function OrphanReports({
  onReadState,
}: {
  onReadState?: (ready: boolean, denied: boolean) => void;
} = {}) {
  const w = useWorkspace();
  const leader = ["founder", "ceo", "admin"].includes(w.work?.me.role ?? "");
  const q = useExecutionRead<{ orphans: OrphanDefinition[] }>(
    "/reports/definitions/orphans",
    leader,
  );
  useLayoutEffect(() => {
    onReadState?.(!leader || !!q.ready, !!q.denied);
  }, [onReadState, leader, q.ready, q.denied]);
  if (!leader) return null;
  return (
    <View>
      <Text>Orphaned schedules</Text>
      <Text>
        Pause or delete stops an inactive owner’s exports and Inbox links.
      </Text>
      {q.loading && <Text>Checking orphaned definitions…</Text>}
      {q.error && <Text>{q.error}</Text>}
      {q.ready &&
        q.data?.orphans.map((d) => (
          <OrphanRow key={d.id} definition={d} changed={q.retry} />
        ))}
    </View>
  );
}
function OrphanRow({
  definition: d,
  changed,
}: {
  definition: OrphanDefinition;
  changed: () => void;
}) {
  const action = useExecutionMutation("$report-orphan:" + d.id, [
    "/reports/definitions/orphans",
  ]);
  const [error, setError] = useState("");
  function confirm(state: "paused" | "deleted") {
    Alert.alert(
      "Stop orphaned report delivery?",
      "Exports and Inbox links are cancelled. Ownership and report contents remain private.",
      [
        { text: "Keep", style: "cancel" },
        { text: "Confirm", onPress: () => void apply(state) },
      ],
    );
  }
  async function apply(state: "paused" | "deleted") {
    try {
      await action.execute(
        `/reports/definitions/${encodeURIComponent(d.id)}/orphan-state`,
        action.attempt?.payload ?? { expectedVersion: d.version, state },
        "PATCH",
        changed,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <View>
      <Text>
        Definition {d.id} · version {d.version} · {d.state}
      </Text>
      {error && <Text>{error}</Text>}
      {action.attempt ? (
        <Action
          title="Retry original orphan action"
          disabled={action.busy}
          onPress={() =>
            confirm(action.attempt!.payload.state as "paused" | "deleted")
          }
        />
      ) : (
        <>
          <Action
            title="Pause orphan"
            disabled={action.busy}
            onPress={() => confirm("paused")}
          />
          <Action
            title="Delete orphan"
            disabled={action.busy}
            onPress={() => confirm("deleted")}
          />
        </>
      )}
    </View>
  );
}
