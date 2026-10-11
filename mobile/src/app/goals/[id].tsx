import { Redirect, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useState, useCallback } from "react";
import { Text } from "react-native";
import { useWorkspace } from "../../Workspace";
import Screen from "../../GoalScreen";
export default function Route() {
  const w = useWorkspace();
  const p = useLocalSearchParams<{ company: string; id: string }>();
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
  if (p.company !== w.company) return <Redirect href="/(tabs)/more" />;
  return <Screen key={w.company + ":" + w.session.user.id} id={p.id} />;
}
