import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  Redirect,
  router,
  useFocusEffect,
  useLocalSearchParams,
} from "expo-router";
import { Text, View } from "react-native";
import { useWorkspace } from "../../Workspace";
import { Action } from "../../ConnectUI";
import NativeConversation from "../../NativeConversation";
export default function ConversationRoute() {
  const w = useWorkspace();
  const params = useLocalSearchParams<{
    id: string;
    company: string;
    messageId?: string;
  }>();
  const [focused, setFocused] = useState(false);
  const latest = useRef(w);
  useLayoutEffect(() => {
    latest.current = w;
  }, [w]);
  const userId = w.session?.user.id,
    company = w.company,
    foreground = w.foreground,
    routeId = params.id,
    routeCompany = params.company;
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      if (
        userId &&
        company === routeCompany &&
        foreground &&
        latest.current.selected !== routeId
      )
        latest.current.select(routeId);
      return () => setFocused(false);
    }, [userId, company, foreground, routeId, routeCompany]),
  );
  if (w.restoring) return <Text>Checking your session…</Text>;
  if (!focused) return null;
  if (!w.session) return <Redirect href="/login" />;
  if (w.company !== params.company) return <Redirect href="/(tabs)/chats" />;
  if (!w.foreground)
    return <Text>Return to the app to check conversation access.</Text>;
  if (w.selected !== params.id)
    return (
      <View>
        <Text>
          Conversation access changed. Open a conversation from the current
          company list.
        </Text>
        <Action
          title="Back to conversations"
          onPress={() => router.replace("/(tabs)/chats")}
        />
      </View>
    );
  return (
    <NativeConversation
      key={
        w.company +
        ":" +
        w.session.user.id +
        ":" +
        w.selected +
        ":" +
        w.foreground +
        ":" +
        w.policyEpoch
      }
    />
  );
}
