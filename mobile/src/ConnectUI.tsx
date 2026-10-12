import KeyboardFrame from "./KeyboardFrame";
import type { ReactNode } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
export function Action({
  title,
  onPress,
  disabled = false,
  primary = false,
  selected = false,
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        ui.action,
        primary && ui.primary,
        selected && ui.selected,
        style,
        (disabled || pressed) && { opacity: disabled ? 0.45 : 0.7 },
      ]}
    >
      <Text
        style={[
          ui.actionText,
          primary && { color: "#fff" },
          selected && { color: "#a8480f" },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function PersonAvatar({ name }: { name: string }) {
  return (
    <View style={ui.avatar}>
      <Text style={ui.avatarText}>
        {name
          .split(" ")
          .filter(Boolean)
          .slice(0, 2)
          .map((n) => n[0])
          .join("")
          .toUpperCase()}
      </Text>
    </View>
  );
}
export function Sheet({
  title,
  onClose,
  children,
  keyboard = true,
  scroll = true,
  busy = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  keyboard?: boolean;
  scroll?: boolean;
  busy?: boolean;
}) {
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <SafeAreaView style={ui.sheet}>
        <KeyboardFrame enabled={keyboard}>
          <View style={ui.header}>
            <Text style={ui.title}>{title}</Text>
            <Action title="Close" disabled={busy} onPress={onClose} />
          </View>
          {scroll ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={ui.sheetBody}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={[ui.sheetBody, { flex: 1 }]}>{children}</View>
          )}
        </KeyboardFrame>
      </SafeAreaView>
    </Modal>
  );
}
export const ui = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: "#fff" },
  sheetBody: { padding: 18, gap: 14 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e9ebef",
  },
  title: { fontSize: 19, fontWeight: "700", color: "#354052", flexShrink: 1 },
  subtitle: { fontSize: 13, color: "#56637a", lineHeight: 19 },
  action: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 13,
    borderRadius: 8,
  },
  actionText: { fontSize: 14, fontWeight: "600", color: "#4f5d72" },
  primary: { backgroundColor: "#b9520c" },
  selected: { backgroundColor: "#fff1e5" },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5e9df",
  },
  avatarText: { fontSize: 13, fontWeight: "700", color: "#7a5434" },
  conversation: {
    paddingVertical: 16,
    paddingHorizontal: 12,
    flexDirection: "row",
    gap: 13,
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#f0f1f4",
  },
  name: { fontSize: 14, fontWeight: "600", color: "#475367" },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
    gap: 13,
  },
  input: {
    borderWidth: 1,
    borderColor: "#e4e8ee",
    backgroundColor: "#fcfcfd",
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: "#455269",
    marginVertical: 8,
  },
  composer: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#e9ebef",
    backgroundColor: "#fff",
  },
  history: { flex: 1 },
  historyBody: { paddingVertical: 14, gap: 16 },
  message: { flexDirection: "row", gap: 10 },
  bubble: {
    borderRadius: 12,
    borderTopLeftRadius: 0,
    backgroundColor: "#f1f3f6",
    padding: 13,
    marginTop: 6,
  },
  ownBubble: { backgroundColor: "#fff2e8" },
  body: { fontSize: 14, lineHeight: 22, color: "#4b576b" },
  metadata: { fontSize: 13, color: "#5f6b7d" },
  error: {
    color: "#9a3f35",
    backgroundColor: "#fff4f1",
    padding: 12,
    fontSize: 13,
  },
  badge: {
    backgroundColor: "#b9520c",
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 3,
    color: "#fff",
    fontSize: 13,
  },
  section: { gap: 10, paddingVertical: 12 },
  quote: {
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: "#e99458",
    backgroundColor: "#fff7f0",
  },
  day: {
    textAlign: "center",
    fontSize: 13,
    color: "#5f6b7d",
    paddingVertical: 8,
  },
});
