import { Redirect } from "expo-router";
import { useWorkspace } from "../Workspace";
import AccountScreen from "../AccountScreen";
export default function Route() {
  const w = useWorkspace();
  if (!w.session && !w.restoring) return <Redirect href="/login" />;
  return <AccountScreen />;
}
