import { Redirect, Tabs } from "expo-router";
import { Text } from "react-native";
import { useWorkspace } from "../../Workspace";
export default function Layout() {
  const w = useWorkspace();
  if (w.restoring) return <Text>Checking your session…</Text>;
  if (!w.session) return <Redirect href="/login" />;
  return (
    <Tabs
      key={w.session.user.id + ":" + w.company + ":" + w.policyEpoch}
      screenOptions={{ headerShown: false, tabBarHideOnKeyboard: true }}
    >
      <Tabs.Screen name="chats" options={{ title: "Chats" }} />
      <Tabs.Screen name="work" options={{ title: "Work" }} />
      <Tabs.Screen name="inbox" options={{ title: "Inbox" }} />
      <Tabs.Screen name="calls" options={{ title: "Calls" }} />
      <Tabs.Screen name="more" options={{ title: "More" }} />
    </Tabs>
  );
}
