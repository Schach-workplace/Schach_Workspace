// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi, afterEach } from "vitest";
import { WorkspaceProvider, useWorkspace } from "./Workspace";
import { client } from "./client";
import SavedReports from "./SavedReports";
import { clearAllDrafts, readDraft } from "./conversationDrafts";
const env = vi.hoisted(() => ({
  state: (_state: string) => {},
  held: false,
  finish: (_value: Response) => {},
  denied: false,
  submitted: [] as any[],
}));
vi.mock("@react-native-community/datetimepicker", () => ({
  default: () => null,
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
vi.mock("./capture", () => ({
  setCaptureContext: () => {},
  clearCaptures: () => {},
  recoverCamera: async () => null,
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("expo-notifications", () => ({
  getLastNotificationResponseAsync: async () => null,
  addNotificationReceivedListener: () => ({ remove() {} }),
  addNotificationResponseReceivedListener: () => ({ remove() {} }),
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: any) => createElement("div", {}, children),
}));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  Sheet: ({ children }: any) => createElement("div", {}, children),
}));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, fn: any) => {
      env.state = fn;
      return { remove() {} };
    },
  },
  Platform: { OS: "android" },
  StyleSheet: { create: (value: any) => value },
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  Button: () => null,
  ScrollView: ({ children }: any) => createElement("div", {}, children),
  FlatList: ({
    data,
    renderItem,
    ListHeaderComponent,
    ListFooterComponent,
  }: any) =>
    createElement(
      "div",
      {},
      ListHeaderComponent,
      ...data.map((item: any) => renderItem({ item })),
      ListFooterComponent,
    ),
  TextInput: ({ value, onChangeText, accessibilityLabel, editable }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      disabled: editable === false,
      onInput: (e: any) => onChangeText(e.target.value),
    }),
}));
let w: ReturnType<typeof useWorkspace>;
function Probe() {
  const current = useWorkspace();
  useLayoutEffect(() => {
    w = current;
  });
  return current.foreground && current.work ? (
    <SavedReports onOpen={() => {}} />
  ) : null;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearAllDrafts();
  client.token = "";
  client.clearGeneration();
});
it("real Workspace ordinary refresh retains the authored input element/focus while fresh recipient choices and submit are withheld", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  env.held = false;
  env.denied = false;
  client.endpoint = "https://owned.test";
  client.token = "token";
  vi.spyOn(client, "restore").mockResolvedValue();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/auth/session"))
        return new Response(
          JSON.stringify({
            user: { id: "user", name: "User" },
            companies: [{ id: "co", name: "Company" }],
          }),
        );
      if (path.endsWith("/bootstrap"))
        return new Response(
          JSON.stringify({
            readBasis: "fixed",
            me: { id: "user", role: "founder" },
            people: [],
            departments: [],
            company: { id: "co", timezone: "Asia/Kolkata" },
            tasks: [],
            expenses: [],
          }),
        );
      if (path.endsWith("/recipients")) {
        if (env.denied)
          return new Response(
            JSON.stringify({
              error: { code: "not_found", message: "Access removed" },
            }),
            { status: 404 },
          );
        if (env.held)
          return new Promise<Response>((resolve) => {
            env.finish = resolve;
          });
        return new Response(
          JSON.stringify({
            recipients: [{ id: "user", name: "Fresh recipient" }],
          }),
        );
      }
      return new Response(
        JSON.stringify({
          id: "device",
          tasks: [],
          expenses: [],
          conversations: [],
          events: [],
          definitions: [],
          orphans: [],
          projects: [],
          hasMore: false,
          cursor: "",
        }),
      );
    }),
  );
  const c = document.createElement("div");
  document.body.append(c);
  const root = createRoot(c);
  try {
    await act(async () => {
      root.render(
        <WorkspaceProvider>
          <Probe />
        </WorkspaceProvider>,
      );
      await new Promise((r) => setTimeout(r, 30));
    });
    const input = c.querySelector<HTMLInputElement>(
      'input[aria-label="Report name"]',
    )!;
    expect(input).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Authored monthly review");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    input.focus();
    env.held = true;
    await act(async () => {
      await w.refresh();
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(c.querySelector('input[aria-label="Report name"]')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Authored monthly review");
    expect(input.disabled).toBe(false);
    expect(c.textContent).not.toContain("Fresh recipient");
    expect(
      Array.from(c.querySelectorAll("button")).find(
        (e) => e.textContent === "Review definition",
      )?.disabled,
    ).toBe(true);
    await act(async () => {
      env.finish(new Response(JSON.stringify({ recipients: [] })));
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(input.value).toBe("Authored monthly review");
    const remove = Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === "Remove unavailable recipients",
    )!;
    expect(remove).toBeTruthy();
    await act(() => remove.click());
    expect(
      Array.from(c.querySelectorAll("button")).find(
        (b) => b.textContent === "Review definition",
      )?.disabled,
    ).toBe(true);
    env.held = false;
    env.denied = true;
    await act(async () => {
      await w.refresh();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(c.querySelector('input[aria-label="Report name"]')).toBeNull();
    expect(
      readDraft({
        serverOrigin: client.endpoint,
        companyId: "co",
        userId: "user",
        conversationId: "$report-definition:new",
        threadRootId: "input:configuration",
      }).body,
    ).toBe("");
  } finally {
    await act(() => root.unmount());
    c.remove();
  }
});
