import { useCallback, useState } from "react";
import { Redirect, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Text } from "react-native";
import { Page, useWorkspace } from "../../Workspace";
import IntelligenceScreen from "../../IntelligenceScreen";
export default function IntelligenceRoute() {
  const w = useWorkspace();
  const params = useLocalSearchParams<{ id: string; company: string }>();
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  if (w.restoring) return <Text>Checking your session…</Text>;
  if (!w.session) return <Redirect href="/login" />;
  if (params.company !== w.company) return <Redirect href="/(tabs)/more" />;
  if (!focused) return null;
  return (
    <Page preserveMounted safeBottom>
      <IntelligenceScreen
        key={w.company + ":" + w.session.user.id + ":" + w.policyEpoch}
        initialJob={params.id === "history" ? "" : params.id}
      />
    </Page>
  );
}
