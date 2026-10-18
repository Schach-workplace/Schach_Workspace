import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import KeyboardFrame from "./KeyboardFrame";
import { colors, metrics, typeScale } from "./mobileTheme";

export default function LoginFrame({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={s.root}>
      <KeyboardFrame>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.body}
        >
          <View style={s.card}>
            <View style={s.mark} accessible={false}>
              <Text style={s.markText}>W</Text>
            </View>
            <Text style={s.brand} accessibilityRole="header">
              Workspace
            </Text>
            <Text style={s.intro}>
              Your work, conversations and company in one place.
            </Text>
            {children}
          </View>
        </ScrollView>
      </KeyboardFrame>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  body: { flexGrow: 1, padding: metrics.gutter, justifyContent: "center" },
  card: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    padding: metrics.gutter,
    gap: 16,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mark: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.accent,
    justifyContent: "center",
    alignItems: "center",
  },
  markText: { fontSize: 24, fontWeight: "800", color: colors.surface },
  brand: { fontSize: 30, fontWeight: "700", color: colors.text },
  intro: { fontSize: typeScale.body, color: colors.secondary, lineHeight: 24 },
});
