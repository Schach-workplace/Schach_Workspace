// @vitest-environment happy-dom
import { useLayoutEffect, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useRamInput } from "./ramInput";
import { WorkspaceProvider, useWorkspace } from "./Workspace";
import { client } from "./client";
import { clearAllDrafts, readDraft, writeDraft } from "./conversationDrafts";
const env = vi.hoisted(() => ({
  state: (_s: string) => {},
  offline: false,
  basis: "basis",
  setInput: (_s: string) => {},
  input: "",
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
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: any) => createElement("div", {}, children),
}));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("expo-notifications", () => ({
  getLastNotificationResponseAsync: async () => null,
  addNotificationReceivedListener: () => ({ remove() {} }),
  addNotificationResponseReceivedListener: () => ({ remove() {} }),
}));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_e: string, fn: (s: string) => void) => {
      env.state = fn;
      return { remove() {} };
    },
  },
  Platform: { OS: "android" },
  StyleSheet: { create: (s: any) => s },
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  Button: () => null,
  ScrollView: ({ children }: any) => createElement("div", {}, children),
}));
function AuthoredForm() {
  const [value, setValue] = useRamInput("$finance-create", "title", "");
  useLayoutEffect(() => {
    env.setInput = setValue;
    env.input = value;
  });
  return createElement("span", {}, value);
}
let w: ReturnType<typeof useWorkspace>;
function Probe() {
  const current = useWorkspace();
  useLayoutEffect(() => {
    w = current;
  });
  return createElement(
    "span",
    {},
    current.selected + ":" + current.foreground,
    current.foreground ? createElement(AuthoredForm) : null,
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  clearAllDrafts();
  client.token = "";
  client.clearGeneration();
});
it("provider hides fetched history on background but retains selected conversation and RAM authored retry across offline poll", async () => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  env.offline = false;
  env.basis = "basis";
  const session = {
    user: { id: "u", name: "User" },
    companies: [{ id: "c", name: "Company" }],
  };
  client.token = "token";
  vi.spyOn(client, "restore").mockResolvedValue();
  vi.spyOn(client, "request").mockImplementation(async (path: string) => {
    if (env.offline) throw Error("offline");
    if (path === "/auth/session") return session as any;
    if (path === "/devices") return { id: "device" } as any;
    if (path.endsWith("/bootstrap"))
      return {
        readBasis: env.basis,
        me: { id: "u", role: "member" },
        people: [],
        tasks: [],
        expenses: [],
        company: { id: "c", timezone: "Asia/Kolkata" },
      } as any;
    if (path.includes("/conversations"))
      return { conversations: [], cursor: "", hasMore: false } as any;
    if (path.endsWith("/inbox")) return { events: [] } as any;
    return { tasks: [], expenses: [], cursor: "", hasMore: false } as any;
  });
  const root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    ),
  );
  await act(async () => w.select("a"));
  await act(async () => env.setInput("Authored finance input"));
  const scope = {
    serverOrigin: "https://test",
    companyId: "c",
    userId: "u",
    conversationId: "a",
  };
  writeDraft(scope, {
    body: "private authored",
    pendingPayload: {
      body: "private authored",
      replyToId: "",
      clientMessageId: "fixed",
    },
  });
  env.offline = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(w.selected).toBe("a");
  expect(readDraft(scope).body).toBe("private authored");
  await act(async () => env.state("background"));
  expect(w.foreground).toBe(false);
  expect(w.work).toBeNull();
  expect(
    readDraft({
      serverOrigin: client.endpoint,
      companyId: "c",
      userId: "u",
      conversationId: "$finance-create",
      threadRootId: "input:title",
    }).body,
  ).toContain("Authored finance input");
  expect(w.selected).toBe("a");
  expect(readDraft(scope).pendingPayload?.clientMessageId).toBe("fixed");
  env.offline = false;
  await act(async () => env.state("active"));
  expect(w.foreground).toBe(true);
  expect(env.input).toBe("Authored finance input");
  expect(w.selected).toBe("a");
  await act(async () => env.state("background"));
  env.basis = "changed-membership-graph";
  await act(async () => env.state("active"));
  expect(readDraft(scope).body).toBe("");
  expect(env.input).toBe("");
  await act(async () => {
    client.onPolicyChange?.(404);
  });
  expect(readDraft(scope).body).toBe("");
  expect(w.selected).toBe("");
  await act(async () => root.unmount());
});

it("authorizes foreground promptly after delayed session restore", async () => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  client.token = "token";
  vi.spyOn(client, "restore").mockResolvedValue();
  const session = {
    user: { id: "u", name: "User" },
    companies: [{ id: "c", name: "Company" }],
  };
  let delaySession = false,
    release: () => void = () => {};
  vi.spyOn(client, "request").mockImplementation(async (path: string) => {
    if (path === "/auth/session")
      return delaySession
        ? await new Promise((r) => (release = () => r(session as any)))
        : (session as any);
    if (path === "/devices") return { id: "device" } as any;
    if (path.endsWith("/bootstrap"))
      return {
        readBasis: "same",
        me: { id: "u", role: "member" },
        people: [],
        tasks: [],
        expenses: [],
        company: { id: "c", timezone: "Asia/Kolkata" },
      } as any;
    if (path.includes("/conversations"))
      return { conversations: [], cursor: "", hasMore: false } as any;
    if (path.endsWith("/inbox")) return { events: [] } as any;
    return { tasks: [], expenses: [], cursor: "", hasMore: false } as any;
  });
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () =>
      root.render(
        <WorkspaceProvider>
          <Probe />
        </WorkspaceProvider>,
      ),
    );
    expect(w.foreground).toBe(true);
    await act(async () => env.state("background"));
    delaySession = true;
    await act(async () => env.state("active"));
    expect(w.foreground).toBe(false);
    await act(async () => release());
    expect(w.foreground).toBe(true);
  } finally {
    await act(async () => root.unmount());
  }
});
