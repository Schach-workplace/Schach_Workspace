import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Action } from "./ConnectUI";
import { colors, metrics, typeScale } from "./mobileTheme";

export interface WorkspaceFrameProps {
  children: ReactNode;
  userName?: string;
  companies: { id: string; name: string }[];
  company: string;
  scopeKey: string;
  foreground: boolean;
  preserveMounted?: boolean;
  scroll?: boolean;
  safeBottom?: boolean;
  error?: string;
  onSwitchCompany: (id: string) => void;
  onDismissError: () => void;
}

export default function WorkspaceFrame({
  children,
  userName,
  companies,
  company,
  scopeKey,
  foreground,
  preserveMounted = false,
  scroll = true,
  safeBottom = false,
  error,
  onSwitchCompany,
  onDismissError,
}: WorkspaceFrameProps) {
  return (
    <SafeAreaView
      edges={
        safeBottom
          ? ["top", "left", "right", "bottom"]
          : ["top", "left", "right"]
      }
      style={s.root}
    >
      <View style={s.header}>
        <Text style={s.brand} accessibilityRole="header">
          Workspace
        </Text>
        {!!userName && <Text style={s.user}>{userName}</Text>}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.companies}
        >
          {companies.map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={c.name}
              accessibilityHint="Switch company workspace"
              accessibilityState={{ selected: company === c.id }}
              onPress={() => onSwitchCompany(c.id)}
              style={[s.company, company === c.id && s.activeCompany]}
            >
              <Text style={[s.companyText, company === c.id && s.activeText]}>
                {company === c.id ? "✓ " : ""}
                {c.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {!!error && (
        <View style={s.error}>
          <Text style={s.errorText} accessibilityRole="alert">
            {error}
          </Text>
          <Action title="Dismiss error" onPress={onDismissError} />
        </View>
      )}
      {foreground || preserveMounted ? (
        <View
          key={scopeKey}
          style={[s.content, { opacity: foreground ? 1 : 0 }]}
          pointerEvents={foreground ? "auto" : "none"}
          accessibilityElementsHidden={!foreground}
          importantForAccessibility={
            foreground ? "auto" : "no-hide-descendants"
          }
        >
          {scroll ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={s.body}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={s.flexBody}>{children}</View>
          )}
        </View>
      ) : (
        <Text style={s.notice}>
          Return to the app to check current company access.
        </Text>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: metrics.gutter,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  brand: { fontSize: typeScale.title, fontWeight: "700", color: colors.text },
  user: { fontSize: typeScale.support, color: colors.secondary },
  companies: { gap: 8, paddingTop: 10, alignItems: "center" },
  company: {
    minHeight: metrics.touch,
    minWidth: metrics.touch,
    maxWidth: 280,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: metrics.radius,
    backgroundColor: colors.canvas,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  activeCompany: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  companyText: {
    fontSize: typeScale.support,
    color: colors.secondary,
    fontWeight: "600",
    flexShrink: 1,
  },
  activeText: { color: colors.accent },
  content: { flex: 1, backgroundColor: colors.canvas },
  body: { padding: metrics.gutter, paddingBottom: 28, gap: 8 },
  flexBody: { flex: 1, paddingHorizontal: metrics.gutter, paddingBottom: 8 },
  error: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: colors.errorSurface,
  },
  errorText: { color: colors.error, fontSize: typeScale.support },
  notice: {
    padding: metrics.gutter,
    fontSize: typeScale.body,
    color: colors.secondary,
  },
});
