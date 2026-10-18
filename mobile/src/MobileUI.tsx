import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, metrics, typeScale } from "./mobileTheme";

// Presentation only. Callers own authorization, data selection and mutations.
export function ScreenHeading({
  title,
  description,
  action,
  eyebrow,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <View testID="screen-heading" style={mobileUI.headingBlock}>
      {!!eyebrow && <Text style={mobileUI.eyebrow}>{eyebrow}</Text>}
      <View style={mobileUI.headingRow}>
        <Text accessibilityRole="header" style={mobileUI.heading}>
          {title}
        </Text>
        {action}
      </View>
      {!!description && <Text style={mobileUI.secondary}>{description}</Text>}
    </View>
  );
}
export function Surface({ children }: { children: ReactNode }) {
  return <View style={mobileUI.surface}>{children}</View>;
}
export function SectionHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <View style={mobileUI.sectionHeading}>
      <Text accessibilityRole="header" style={mobileUI.sectionTitle}>
        {title}
      </Text>
      {!!description && <Text style={mobileUI.secondary}>{description}</Text>}
    </View>
  );
}
export function FilterBar({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={mobileUI.filterBlock}>
      <Text style={mobileUI.filterLabel}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={mobileUI.filters}
      >
        {options.map((o) => (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: o.value === value }}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [
              mobileUI.filter,
              o.value === value && mobileUI.activeFilter,
              pressed && mobileUI.pressed,
            ]}
          >
            <Text
              style={[
                mobileUI.filterText,
                o.value === value && mobileUI.activeFilterText,
              ]}
            >
              {o.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
export function RecordCard({
  title,
  label,
  detail,
  status,
  onPress,
  trailing,
}: {
  title: string;
  label: string;
  detail?: string;
  status?: string;
  trailing?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={[status?.replaceAll("_", " "), detail, trailing]
        .filter(Boolean)
        .join(". ")}
      onPress={onPress}
      style={({ pressed }) => [mobileUI.record, pressed && mobileUI.pressed]}
    >
      <View style={mobileUI.recordBody}>
        {!!status && (
          <Text style={mobileUI.eyebrow}>{status.replaceAll("_", " ")}</Text>
        )}
        <Text style={mobileUI.recordTitle}>{title}</Text>
        {!!detail && <Text style={mobileUI.secondary}>{detail}</Text>}
        {!!trailing && <Text style={mobileUI.amount}>{trailing}</Text>}
      </View>
      <Text accessible={false} style={mobileUI.chevron}>
        ›
      </Text>
    </Pressable>
  );
}
export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <View style={mobileUI.empty}>
      <Text accessibilityRole="header" style={mobileUI.sectionTitle}>
        {title}
      </Text>
      <Text style={mobileUI.secondary}>{description}</Text>
    </View>
  );
}
export const mobileUI = StyleSheet.create({
  headingBlock: {
    flexShrink: 0,
    minWidth: 0,
    maxWidth: "100%",
    gap: 6,
    paddingTop: 20,
    paddingBottom: 12,
  },
  headingRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  heading: {
    fontSize: typeScale.heading,
    fontWeight: "700",
    color: colors.text,
    flexShrink: 1,
  },
  eyebrow: {
    fontSize: typeScale.meta,
    fontWeight: "700",
    color: colors.accent,
    lineHeight: 20,
  },
  secondary: {
    fontSize: typeScale.support,
    color: colors.secondary,
    lineHeight: 22,
    flexShrink: 1,
  },
  surface: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
    marginVertical: 6,
  },
  sectionHeading: { gap: 4, paddingTop: 16, paddingBottom: 8 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    lineHeight: 26,
  },
  filterBlock: { gap: 4, paddingVertical: 8 },
  filterLabel: {
    fontSize: typeScale.meta,
    fontWeight: "600",
    color: colors.secondary,
  },
  filters: { gap: 8, paddingVertical: 4, paddingRight: 8 },
  filter: {
    minHeight: metrics.touch,
    minWidth: metrics.touch,
    paddingVertical: 12,
    paddingHorizontal: 16,
    justifyContent: "center",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  activeFilter: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  filterText: {
    fontSize: typeScale.support,
    color: colors.secondary,
    fontWeight: "600",
  },
  activeFilterText: { color: colors.accent },
  record: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginVertical: 6,
    minHeight: 80,
  },
  recordBody: { flex: 1, minWidth: 0, gap: 6 },
  recordTitle: {
    fontSize: typeScale.body,
    color: colors.text,
    fontWeight: "600",
    lineHeight: 25,
  },
  amount: {
    fontSize: typeScale.title,
    color: colors.text,
    fontWeight: "700",
    lineHeight: 30,
  },
  chevron: { fontSize: 28, color: colors.secondary },
  empty: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    gap: 8,
    marginVertical: 16,
  },
  listContent: { paddingBottom: 24 },
  tools: { gap: 8 },
  pressed: { opacity: 0.7 },
});
