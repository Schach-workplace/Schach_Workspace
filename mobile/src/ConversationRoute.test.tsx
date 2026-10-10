// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ConversationRoute from "./app/chat/[id]";
const state = vi.hoisted(() => ({ focused: true, w: {} as any }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: React.ReactNode }) =>
    createElement("div", {}, children),
  Text: ({ children }: { children: unknown }) =>
    createElement("span", {}, children as never),
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "chat-a", company: "company" }),
  useFocusEffect: (callback: () => void) => {
    const focused = state.focused;
    return useEffect(() => {
      if (focused) return callback();
    }, [callback, focused]);
  },
  Redirect: () => createElement("span", {}, "Redirect"),
  router: { replace: vi.fn() },
}));
vi.mock("./Workspace", () => ({ useWorkspace: () => state.w }));
vi.mock("./NativeConversation", () => ({
  default: () => createElement("span", {}, "Current chat"),
}));
vi.mock("./ConnectUI", () => ({ Action: () => null }));
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.focused = true;
  state.w = {
    session: { user: { id: "person" } },
    company: "company",
    foreground: true,
    selected: "chat-a",
    policyEpoch: 0,
    restoring: false,
    select: vi.fn(),
  };
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(() => root.unmount()));
it("does not reopen a conversation after authorization clears its selection", async () => {
  await act(async () => root.render(createElement(ConversationRoute)));
  state.w = { ...state.w, selected: "", policyEpoch: 1 };
  await act(async () => root.render(createElement(ConversationRoute)));
  expect(state.w.select).not.toHaveBeenCalled();
});
it("does not let a retained unfocused route cancel another conversation", async () => {
  state.focused = false;
  state.w.selected = "chat-b";
  await act(async () => root.render(createElement(ConversationRoute)));
  expect(state.w.select).not.toHaveBeenCalled();
});
