import { initializeReportTemps } from "../reportClient";
import { useEffect } from "react";
import { Stack } from "expo-router";
import { WorkspaceProvider } from "../Workspace";
import { ActiveCall } from "../CallRuntime";
export default function Layout() {
  useEffect(() => {
    void initializeReportTemps().catch(() => {});
  }, []);
  return (
    <WorkspaceProvider>
      <Stack screenOptions={{ headerShown: false }} />
      <ActiveCall />
    </WorkspaceProvider>
  );
}
