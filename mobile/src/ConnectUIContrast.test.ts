import { describe, expect, it, vi } from "vitest";
import { ui } from "./ConnectUI";
vi.mock("react-native", () => ({
  StyleSheet: { create: <T>(s: T) => s },
  Modal: () => null,
  Pressable: () => null,
  ScrollView: () => null,
  Text: () => null,
  View: () => null,
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: () => null }));
vi.mock("./KeyboardFrame", () => ({ default: () => null }));
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const color = (s: unknown) => (s as { color: string }).color.toLowerCase();
const size = (s: unknown) => (s as { fontSize: number }).fontSize;
describe("Connect UI text meets WCAG AA on its light surfaces", () => {
  const pairs: [string, unknown, string[]][] = [
    ["subtitle", ui.subtitle, ["#ffffff", "#faf9f6"]],
    ["actionText", ui.actionText, ["#ffffff", "#faf9f6"]],
    ["metadata", ui.metadata, ["#f1f3f6", "#fff2e8", "#ffffff", "#faf9f6"]],
    ["day", ui.day, ["#ffffff", "#faf9f6"]],
    ["avatarText", ui.avatarText, [String(ui.avatar.backgroundColor)]],
    ["error", ui.error, [String(ui.error.backgroundColor)]],
  ];
  it.each(pairs)("%s is at least 4.5:1 and 13pt", (_name, style, grounds) => {
    for (const ground of grounds)
      expect(contrast(color(style), ground)).toBeGreaterThanOrEqual(4.5);
    expect(size(style)).toBeGreaterThanOrEqual(13);
  });
  it("keeps white button and badge text readable on the accent", () => {
    expect(
      contrast("#ffffff", String(ui.primary.backgroundColor)),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast("#ffffff", String(ui.badge.backgroundColor)),
    ).toBeGreaterThanOrEqual(4.5);
    expect(size(ui.badge)).toBeGreaterThanOrEqual(13);
  });
  it("keeps hierarchy: titles and names stay larger than meta text", () => {
    expect(size(ui.title)).toBeGreaterThan(size(ui.subtitle));
    expect(size(ui.name)).toBeGreaterThan(size(ui.metadata));
  });
});
