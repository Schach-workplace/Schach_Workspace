import { Redirect, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Text } from "react-native";
import { useWorkspace } from "../../Workspace";
import TaskDetailScreen from "../../TaskDetailScreen";
export default function TaskRoute() {
  const w = useWorkspace();
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const p = useLocalSearchParams<{
    id: string;
    company: string;
    conversationId?: string;
  }>();
  if (!focused) return null;
  if (w.restoring) return <Text>Checking session…</Text>;
  if (!w.session) return <Redirect href="/login" />;
  if (w.company !== p.company) return <Redirect href="/(tabs)/work" />;
  if (!w.foreground || !w.work)
    return <Text>Checking current company access…</Text>;
  return (
    <TaskDetailScreen
      key={
        w.company + ":" + w.session.user.id + ":" + w.policyEpoch + ":" + p.id
      }
      id={p.id}
    />
  );
}
