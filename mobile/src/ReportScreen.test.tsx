// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import ReportScreen from "./ReportScreen";
const h = vi.hoisted(() => ({
  w: {
    company: "co",
    foreground: true,
    work: {
      company: { timezone: "Asia/Kolkata" },
      tasks: [{ id: "t", title: "Inspect drawings", status: "todo" }],
    },
  },
  push: vi.fn(),
}));
vi.mock("./Workspace", () => ({
  useWorkspace: () => h.w,
  Page: ({ children }: any) => createElement("div", {}, children),
}));
vi.mock("./execution", () => ({ useExecutionRead: () => ({ ready: false }) }));
vi.mock("./IntelligenceLauncher", () => ({ default: () => null }));
vi.mock("./HistoricalReports", () => ({
  default: () => createElement("span", {}, "Historical snapshot view"),
}));
vi.mock("./SavedReports", () => ({
  default: () => createElement("span", {}, "Saved definition view"),
}));
vi.mock("expo-router", () => ({ router: { push: h.push, back: vi.fn() } }));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({ title, onPress }: any) =>
    createElement("button", { onClick: onPress }, title),
}));
vi.mock("react-native", () => ({
  StyleSheet: { create: (x: any) => x },
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  ScrollView: ({ children }: any) => createElement("div", {}, children),
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
    accessibilityState,
  }: any) =>
    createElement(
      "button",
      {
        onClick: onPress,
        "aria-label": accessibilityLabel,
        "aria-pressed": accessibilityState?.selected,
      },
      children,
    ),
  FlatList: ({
    data,
    renderItem,
    ListHeaderComponent,
    ListEmptyComponent,
  }: any) =>
    createElement(
      "div",
      {},
      ListHeaderComponent,
      data.length
        ? data.map((item: any) =>
            createElement("div", { key: item.id }, renderItem({ item })),
          )
        : ListEmptyComponent,
    ),
}));
it("makes report basis explicit and keeps task routes qualified while hiding current records in background", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const node = document.createElement("div"),
    root = createRoot(node);
  const click = async (label: string) =>
    act(async () =>
      [...node.querySelectorAll("button")]
        .find((b) => b.getAttribute("aria-label") === label)!
        .click(),
    );
  try {
    await act(async () => root.render(<ReportScreen />));
    expect(node.textContent).toContain("Current visibility");
    expect(node.textContent).toContain(
      "later task changes can change these values",
    );
    await click("Inspect drawings · todo");
    expect(h.push).toHaveBeenLastCalledWith({
      pathname: "/task/[id]",
      params: { id: "t", company: "co" },
    });
    await click("Historical reports");
    expect(node.textContent).toContain("Historical snapshot view");
    expect(node.textContent).not.toContain("Inspect drawings");
    await click("Saved reports");
    expect(node.textContent).toContain("Saved definition view");
    await click("Current state");
    h.w.foreground = false;
    await act(async () => root.render(<ReportScreen />));
    expect(node.textContent).not.toContain("Inspect drawings");
  } finally {
    h.w.foreground = true;
    await act(async () => root.unmount());
  }
});
