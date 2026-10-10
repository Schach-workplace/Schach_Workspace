import { Redirect, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Text } from "react-native";
import { useWorkspace } from "../../Workspace";
import ReportScreen from "../../ReportScreen";
export default function ReportRoute() {
  const w = useWorkspace();
  const p = useLocalSearchParams<{
    id: string;
    company: string;
    kind?: string;
  }>();
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  if (!focused) return null;
  if (w.restoring) return <Text>Checking session…</Text>;
  if (!w.session) return <Redirect href="/login" />;
  if (w.company !== p.company) return <Redirect href="/(tabs)/work" />;
  if (!w.foreground || !w.work)
    return <Text>Checking current company access…</Text>;
  return (
    <ReportScreen
      key={w.company + ":" + w.session.user.id + ":" + p.id}
      id={p.id}
      kind={p.kind ?? (p.id.startsWith("rj_") ? "job" : "snapshot")}
    />
  );
}
