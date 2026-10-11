import { Redirect, useLocalSearchParams } from "expo-router";
import { useWorkspace } from "../../Workspace";
import FinanceScreen from "../../FinanceScreen";
export default function Route() {
  const w = useWorkspace();
  const p = useLocalSearchParams<{ company?: string }>();
  if (!w.session && !w.restoring) return <Redirect href="/login" />;
  if (p.company && p.company !== w.company)
    return <Redirect href="/(tabs)/more" />;
  return <FinanceScreen />;
}
