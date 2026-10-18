// @vitest-environment happy-dom
import { act, createElement, Children } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import ConnectList from "./ConnectList";
function container({ children }: any) {
  for (const child of Children.toArray(children))
    if (
      (typeof child === "string" && child !== "") ||
      typeof child === "number"
    )
      throw Error("Raw native container text: " + JSON.stringify(child));
  return createElement("div", {}, children);
}
vi.mock("./client", () => ({
  client: { request: async () => ({ conversations: [] }) },
}));
const ws = vi.hoisted(() => ({
  refresh: (() => Promise.resolve()) as () => Promise<void>,
  conversations: [] as any[],
  selected: vi.fn(),
  setError: (() => {}) as (message: string) => void,
}));
vi.mock("./Workspace", () => ({
  Page: container,
  useWorkspace: () => ({
    refresh: () => ws.refresh(),
    company: "c",
    foreground: true,
    session: { user: { id: "u" } },
    conversations: ws.conversations,
    select: ws.selected,
    work: {
      me: { role: "admin" },
      people: [{ id: "v", name: "Sam", active: true, role: "admin" }],
    },
    setError: (m: string) => ws.setError(m),
  }),
}));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("expo-router", () => ({ router: { push: nav.push } }));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Sheet: container,
  PersonAvatar: () => null,
  Action: ({ title, onPress }: any) =>
    createElement("button", { onClick: onPress }, title),
}));
vi.mock("react-native", () => ({
  View: container,
  Pressable: ({ children, onPress, accessibilityLabel }: any) =>
    createElement(
      "button",
      { onClick: onPress, "aria-label": accessibilityLabel },
      children,
    ),
  Text: ({ children }: any) => createElement("span", {}, children),
  TextInput: ({ accessibilityLabel, value, onChangeText }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      onChange: (e: any) => onChangeText(e.target.value),
    }),
  FlatList: ({
    refreshControl,
    data,
    renderItem,
    ListHeaderComponent,
    ListFooterComponent,
  }: any) =>
    createElement(
      "div",
      { "data-list": "conversations" },
      refreshControl,
      ListHeaderComponent,
      ...data.map((item: any) => renderItem({ item })),
      ListFooterComponent,
    ),
  RefreshControl: ({ onRefresh, refreshing }: any) =>
    createElement(
      "button",
      { onClick: onRefresh, "data-refreshing": String(refreshing) },
      "Pull to refresh",
    ),
}));
it("renders direct, group and channel creation without raw native text children", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<ConnectList />));
  const click = async (label: string) =>
    act(async () => {
      const b = [...host.querySelectorAll("button")].find(
        (b) => b.textContent === label,
      );
      expect(b).toBeTruthy();
      b!.click();
    });
  await click("＋ New");
  for (const kind of ["Group", "Channel", "Direct message"]) {
    const button = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.toLowerCase() === kind.toLowerCase(),
    );
    expect(button).toBeTruthy();
    await act(async () => button!.click());
  }
  await act(async () => root.unmount());
});
it("links the read-only Overview and Workload screens for the current company", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<ConnectList />));
  for (const [label, pathname] of [
    ["Overview", "/overview"],
    ["Workload", "/workload"],
  ]) {
    const b = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === label,
    );
    expect(b).toBeTruthy();
    await act(async () => b!.click());
    expect(nav.push).toHaveBeenLastCalledWith({
      pathname,
      params: { company: "c" },
    });
  }
  await act(async () => root.unmount());
});
it("pull-to-refresh reloads the conversation list through the workspace and surfaces failures", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  let finish: () => void = () => {};
  const refresh = vi.fn(
    () => new Promise<void>((resolve) => (finish = resolve)),
  );
  ws.refresh = refresh;
  await act(async () => root.render(<ConnectList />));
  const pull = () =>
    [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Pull to refresh",
    )!;
  await act(async () => pull().click());
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(pull().dataset.refreshing).toBe("true");
  // A second pull while one is running does not start another reload.
  await act(async () => pull().click());
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(pull().dataset.refreshing).toBe("false");
  const setError = vi.fn();
  ws.setError = setError;
  ws.refresh = vi.fn(async () => {
    throw Error("Company access is unavailable.");
  });
  await act(async () => pull().click());
  expect(setError).toHaveBeenCalledWith("Company access is unavailable.");
  expect(pull().dataset.refreshing).toBe("false");
  await act(async () => root.unmount());
});

it("recovers from an empty filter and opens the current company's conversation", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  ws.conversations = [{ id: "private-dm", kind: "dm", peerId: "v" }];
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<ConnectList />));
  const button = (title: string) =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === title)!;
  await act(async () => button("Unread").click());
  expect(host.textContent).toContain("No matching conversations");
  expect(host.textContent).toContain(
    "Try another name or show all conversations.",
  );
  await act(async () => button("Clear filters").click());
  expect(host.textContent).not.toContain("No matching conversations");
  const dm = host.querySelector(
    'button[aria-label="Sam"]',
  )! as HTMLButtonElement;
  expect(dm).toBeTruthy();
  await act(async () => dm.click());
  expect(ws.selected).toHaveBeenLastCalledWith("private-dm");
  expect(nav.push).toHaveBeenLastCalledWith({
    pathname: "/chat/[id]",
    params: { id: "private-dm", company: "c", messageId: undefined },
  });
  await act(async () => root.unmount());
  ws.conversations = [];
});

it("keeps discovery controls and secondary navigation inside the scrollable conversation list", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<ConnectList />));
    const list = host.querySelector('[data-list="conversations"]')!;
    expect(
      list.querySelector('input[aria-label="Filter conversations"]'),
    ).toBeTruthy();
    expect(list.textContent).toContain("Search & saved messages");
  } finally {
    await act(async () => root.unmount());
  }
});
