import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { useFocusEffect } from "expo-router";
import { Page, useWorkspace } from "../../Workspace";
import AttentionInbox from "../../AttentionInbox";
export default function Inbox() {
  const w = useWorkspace();
  const [refreshing, setRefreshing] = useState(false);
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  async function reload() {
    try {
      await w.refresh("attention");
    } catch (e) {
      w.setError((e as Error).message);
    }
  }
  const reloadOnFocus = useEffectEvent(reload);
  // Re-read attention (and the unread badge source) whenever Inbox is shown.
  useEffect(() => {
    if (focused) void reloadOnFocus();
  }, [focused]);
  async function pull() {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <Page scroll={false}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={pull} />
        }
      >
        <AttentionInbox key={w.company + ":" + w.session?.user.id} />
      </ScrollView>
    </Page>
  );
}
