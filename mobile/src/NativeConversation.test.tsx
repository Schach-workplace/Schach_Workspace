// @vitest-environment happy-dom
import {
  act,
  createElement,
  forwardRef,
  useImperativeHandle,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NativeConversation from "./NativeConversation";
const state = vi.hoisted(() => ({
  offline: false,
  posts: [] as unknown[],
  w: {} as any,
}));
vi.mock("./client", () => ({
  client: {
    request: vi.fn(async (_path: string, method = "GET", body?: unknown) => {
      if (method === "POST" && _path.endsWith("/messages")) {
        state.posts.push(body);
        if (state.posts.length === 1) throw Error("Response lost");
        return { message: { id: "accepted" } };
      }
      if (state.offline) throw Error("Network unavailable");
      if (_path.endsWith("/messages"))
        return { messages: [], cursor: "", hasMore: false };
      if (_path.endsWith("/read")) return {};
      return {
        conversation: {
          id: "chat",
          title: "Site",
          kind: "group",
          public: false,
          archived: false,
          version: 1,
          forwarding: "deny",
        },
        members: [{ userId: "person", role: "member", epoch: 1 }],
      };
    }),
  },
}));
vi.mock("expo-router", () => ({
  router: { back: vi.fn(), push: vi.fn(), replace: vi.fn() },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("./Media", () => ({ default: () => null }));
vi.mock("./Publication", () => ({ default: () => null }));
vi.mock("./Structured", () => ({ default: () => null }));
vi.mock("./ChatControls", () => ({ default: () => null }));
vi.mock("./Workspace", () => ({
  useWorkspace: () => state.w,
  Page: ({ children }: { children: ReactNode }) =>
    createElement("div", {}, children),
}));
vi.mock("./ConnectList", () => ({
  conversationName: () => "Site",
  SearchSheet: () => null,
}));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({
    title,
    onPress,
    disabled,
  }: {
    title: string;
    onPress: () => void;
    disabled?: boolean;
  }) => createElement("button", { onClick: onPress, disabled }, title),
  PersonAvatar: () => null,
  Sheet: ({ children }: { children: ReactNode }) =>
    createElement("div", {}, children),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  View: ({ children }: { children: ReactNode }) =>
    createElement("div", {}, children),
  Text: ({ children }: { children: ReactNode }) =>
    createElement("span", {}, children),
  Pressable: ({
    children,
    onPress,
  }: {
    children: ReactNode;
    onPress?: () => void;
  }) => createElement("button", { onClick: onPress }, children),
  KeyboardAvoidingView: ({ children }: { children: ReactNode }) =>
    createElement("div", {}, children),
  ScrollView: forwardRef(function NativeScroll(
    { children }: { children: ReactNode },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ scrollToEnd: () => {} }));
    return createElement("div", {}, children);
  }),
  TextInput: ({
    value,
    onChangeText,
    accessibilityLabel,
    editable,
  }: {
    value: string;
    onChangeText: (value: string) => void;
    accessibilityLabel: string;
    editable?: boolean;
  }) =>
    createElement("textarea", {
      "aria-label": accessibilityLabel,
      value,
      disabled: editable === false,
      onInput: (e: any) => onChangeText(e.currentTarget.value),
    }),
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.offline = false;
  state.posts = [];
  state.w = {
    company: "company",
    selected: "chat",
    foreground: true,
    session: { user: { id: "person" } },
    work: { me: { role: "member" }, people: [] },
    setError: vi.fn(),
    invalidatePrivateViews: vi.fn(),
  };
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});
it("keeps the same pending message across a recoverable polling outage", async () => {
  await act(async () => root.render(createElement(NativeConversation)));
  const input = container.querySelector(
    'textarea[aria-label="Message"]',
  )! as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input, "Preserve this private draft");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "Send")!
      .click(),
  );
  expect(state.posts).toHaveLength(1);
  state.offline = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(
    container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Message"]',
    )?.value,
  ).toBe("Preserve this private draft");
  state.offline = false;
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "Retry same message")!
      .click(),
  );
  expect(state.posts).toHaveLength(2);
  expect(state.posts[0]).toEqual(state.posts[1]);
});
