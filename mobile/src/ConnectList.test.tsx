// @vitest-environment happy-dom
import { act, createElement, Children } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import ConnectList from "./ConnectList";
function container({ children }: any) {
  for (const child of Children.toArray(children))
    if ((typeof child === "string" && child !== "") || typeof child === "number")
      throw Error("Raw native container text: "+JSON.stringify(child));
  return createElement("div", {}, children);
}
vi.mock("./client", () => ({
  client: { request: async () => ({ conversations: [] }) },
}));
vi.mock("./Workspace", () => ({
  Page: container,
  useWorkspace: () => ({
    company: "c",
    foreground: true,
    session: { user: { id: "u" } },
    conversations: [],
    work: {
      me: { role: "admin" },
      people: [{ id: "v", name: "Sam", active: true, role: "admin" }],
    },
    setError: vi.fn(),
  }),
}));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Sheet: container,
  PersonAvatar: () => null,
  Action: ({ title, onPress }: any) =>
    createElement("button", { onClick: onPress }, title),
}));
vi.mock("react-native", () => ({
  View: container,
  Pressable: container,
  Text: ({ children }: any) => createElement("span", {}, children),
  TextInput: () => null,
  FlatList: () => null,
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
