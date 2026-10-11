import { Redirect, useLocalSearchParams } from "expo-router";
import { Page, useWorkspace } from "../Workspace";
import { NativeProjects } from "../Execution";
export default function Route() {
  const w = useWorkspace();
  const p = useLocalSearchParams<{ company?: string }>();
  if (!w.session && !w.restoring) return <Redirect href="/login" />;
  if (p.company && p.company !== w.company)
    return <Redirect href="/(tabs)/more" />;
  return (
    <Page>
      <NativeProjects />
    </Page>
  );
}
