import { useState } from "react";
import {
  Pressable,
  Text,
  View,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import { Action } from "./ConnectUI";

/** Secondary actions stay available without taking space from message history. */
export function ConversationTools({
  disabled,
  onSearch,
  onRecords,
  onMentions,
  onCall,
}: {
  disabled: boolean;
  onSearch: () => void;
  onRecords: () => void;
  onMentions: () => void;
  onCall: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={connectStyle.tools}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Conversation tools"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((v) => !v)}
        style={connectStyle.toolsToggle}
      >
        <Text style={connectStyle.sectionTitle}>Conversation tools</Text>
        <Text style={connectStyle.support}>
          {expanded ? "Hide −" : "Show ＋"}
        </Text>
      </Pressable>
      {expanded && (
        <View style={connectStyle.toolActions}>
          <Action title="Search & pins" onPress={onSearch} />
          <Action title="Records" onPress={onRecords} />
          <Action title="Audio / video" disabled={disabled} onPress={onCall} />
          <Action title="Mentions in loaded history" onPress={onMentions} />
        </View>
      )}
    </View>
  );
}
// Scoped presentation: no permission, cache, send or publication behavior lives here.
export const connectStyle = {
  heading: {
    paddingVertical: 16,
    gap: 5,
    flexShrink: 1,
    minWidth: 0,
  } as ViewStyle,
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "700",
    color: "#172B36",
    letterSpacing: -0.7,
  } as TextStyle,
  support: { fontSize: 13, lineHeight: 19, color: "#526674" } as TextStyle,
  sectionTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: "#263E4B",
  } as TextStyle,
  summary: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 12,
  } as ViewStyle,
  search: {
    backgroundColor: "#F1F5F6",
    borderColor: "#DCE5E8",
    borderRadius: 16,
    minHeight: 50,
    marginBottom: 6,
  } as ViewStyle,
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    paddingVertical: 6,
  } as ViewStyle,
  conversation: {
    borderBottomColor: "#E5ECEF",
    paddingVertical: 18,
    paddingHorizontal: 4,
    gap: 14,
  } as ViewStyle,
  unread: {
    backgroundColor: "#F3F8FA",
    borderRadius: 14,
    paddingHorizontal: 10,
  } as ViewStyle,
  conversationText: { flex: 1, gap: 5 } as ViewStyle,
  navigation: {
    borderTopWidth: 1,
    borderTopColor: "#DCE5E8",
    paddingTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 2,
  } as ViewStyle,
  chatHeader: { paddingVertical: 10, borderBottomWidth: 0 } as ViewStyle,
  tools: {
    borderWidth: 1,
    borderColor: "#DFE8EC",
    backgroundColor: "#F7FAFB",
    borderRadius: 14,
    marginBottom: 8,
  } as ViewStyle,
  toolsToggle: {
    minHeight: 48,
    paddingHorizontal: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  } as ViewStyle,
  toolActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 6,
    gap: 4,
  } as ViewStyle,
  history: { paddingHorizontal: 4, paddingBottom: 18 } as ViewStyle,
  message: { paddingVertical: 3 } as ViewStyle,
  bubble: { borderRadius: 18, padding: 14 } as ViewStyle,
  composer: {
    borderTopWidth: 1,
    borderTopColor: "#DCE5E8",
    paddingTop: 10,
    backgroundColor: "#FFFFFF",
  } as ViewStyle,
};
