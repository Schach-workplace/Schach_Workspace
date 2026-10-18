import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, Text, type ColorValue } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useWorkspace } from "../../Workspace";
import { colors } from "../../mobileTheme";
import { tabBadge, unreadNotificationCount } from "../../tabBadges";
// Text glyphs (forced to text presentation with U+FE0E) follow the tab tint
// without adding an icon dependency.
const glyphs = {
  chats: "✉︎",
  work: "☑︎",
  inbox: "⚑︎",
  calls: "☏︎",
  more: "⋯",
} as const;
function icon(name: keyof typeof glyphs) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return (
      <Text
        accessible={false}
        importantForAccessibility="no"
        style={{ color, fontSize: size - 2, lineHeight: size }}
      >
        {glyphs[name]}
      </Text>
    );
  }
  return TabIcon;
}
export default function Layout() {
  const w = useWorkspace();
  if (w.restoring)
    return (
      <SafeAreaView
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          backgroundColor: "#fff",
        }}
      >
        <ActivityIndicator size="large" accessibilityLabel="Loading" />
        <Text accessibilityRole="progressbar">Checking your session…</Text>
      </SafeAreaView>
    );
  if (!w.session) return <Redirect href="/login" />;
  const unread = unreadNotificationCount(w.foreground ? w.work : null);
  return (
    <Tabs
      key={w.session.user.id + ":" + w.company + ":" + w.policyEpoch}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.secondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontSize: 13, fontWeight: "600" },
        tabBarItemStyle: { minHeight: 48 },
      }}
    >
      <Tabs.Screen
        name="chats"
        options={{ title: "Chats", tabBarIcon: icon("chats") }}
      />
      <Tabs.Screen
        name="work"
        options={{ title: "Work", tabBarIcon: icon("work") }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: "Inbox",
          tabBarIcon: icon("inbox"),
          tabBarBadge: tabBadge(unread),
          tabBarAccessibilityLabel: unread
            ? `Inbox, ${unread} unread notifications`
            : "Inbox",
        }}
      />
      <Tabs.Screen
        name="calls"
        options={{ title: "Calls", tabBarIcon: icon("calls") }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: "More", tabBarIcon: icon("more") }}
      />
    </Tabs>
  );
}
