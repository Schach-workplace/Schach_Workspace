import {
  Redirect,
  router,
  useLocalSearchParams,
  useFocusEffect,
} from "expo-router";
import { useCallback, useState } from "react";
import { Text } from "react-native";
import { Page, useWorkspace, type NativeExpense } from "../../Workspace";
import ExpenseDecision from "../../ExpenseDecision";
export default function ExpenseRoute() {
  const w = useWorkspace();
  const p = useLocalSearchParams<{ id: string; company: string }>();
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
    <Page>
      <ExpenseDecision
        key={[w.company, w.session.user.id, w.policyEpoch, p.id].join(":")}
        expense={{ id: p.id, version: 0 } as NativeExpense}
        onClose={() => router.back()}
      />
    </Page>
  );
}
