// @vitest-environment happy-dom
import { useLayoutEffect, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceProvider, Page, useWorkspace } from "./Workspace";
import { client } from "./client";
const env = vi.hoisted(() => ({
  go: false,
  subscriptions: 0,
  notificationModuleLoads: 0,
  handler: null as any,
  tokenListener: (_t: any) => {},
  responseListener: (_r: any) => {},
  granted: true,
  requested: 0,
  push: [] as unknown[],
}));
vi.mock("expo", () => ({ isRunningInExpoGo: () => env.go }));
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
vi.mock("expo-router", () => ({
  router: { push: (v: unknown) => env.push.push(v) },
}));
vi.mock("expo-notifications", () => {
  env.notificationModuleLoads++;
  return {
    AndroidImportance: { DEFAULT: 3 },
    getLastNotificationResponseAsync: async () => null,
    addNotificationReceivedListener: () => {
      env.subscriptions++;
      return { remove() {} };
    },
    addNotificationResponseReceivedListener: (fn: any) => {
      env.responseListener = fn;
      return { remove() {} };
    },
    addPushTokenListener: (fn: any) => {
      env.tokenListener = fn;
      return { remove() {} };
    },
    setNotificationHandler: (h: any) => {
      env.handler = h;
    },
    getPermissionsAsync: async () => ({ granted: env.granted }),
    requestPermissionsAsync: async () => {
      env.requested++;
      return { granted: env.granted };
    },
    setNotificationChannelAsync: async () => null,
    getDevicePushTokenAsync: async () => ({ type: "android", data: "token-1" }),
  };
});
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove() {} }),
  },
  Platform: { OS: "android" },
  StyleSheet: { create: (s: any) => s },
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children, accessibilityRole }: any) =>
    createElement("span", { role: accessibilityRole }, children),
  Button: ({ title, onPress, accessibilityLabel, accessibilityState }: any) =>
    createElement(
      "button",
      {
        onClick: onPress,
        "aria-label": accessibilityLabel,
        "aria-selected": accessibilityState?.selected,
      },
      title,
    ),
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
    accessibilityState,
  }: any) =>
    createElement(
      "button",
      {
        onClick: onPress,
        disabled,
        "aria-label": accessibilityLabel,
        "aria-selected": accessibilityState?.selected,
      },
      children,
    ),
  ScrollView: ({ children }: any) => createElement("div", {}, children),
}));
let w: ReturnType<typeof useWorkspace>;
function Probe() {
  const current = useWorkspace();
  useLayoutEffect(() => {
    w = current;
  });
  return <Page>{null}</Page>;
}
const devices: any[] = [];
let failPoll = false;
function mockServer() {
  const session = {
    user: { id: "u", name: "User" },
    companies: [
      { id: "c", name: "Alpha" },
      { id: "d", name: "Beta" },
    ],
  };
  client.token = "token";
  vi.spyOn(client, "restore").mockResolvedValue();
  vi.spyOn(client, "request").mockImplementation(
    async (path: string, _m?: string, body?: unknown) => {
      if (path === "/auth/session") return session as any;
      if (path === "/devices") {
        devices.push(body);
        return { id: "device" } as any;
      }
      if (failPoll) throw Error("Network unavailable");
      if (path.endsWith("/bootstrap"))
        return {
          readBasis: "b",
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
    },
  );
}
async function mount() {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    ),
  );
  return { container, root };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  client.token = "";
  client.clearGeneration();
  devices.length = 0;
  env.push.length = 0;
  env.granted = true;
  env.requested = 0;
  env.go = false;
  env.subscriptions = 0;
  failPoll = false;
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("Expo Go keeps authenticated device registration but never subscribes or opts into native push", async () => {
  env.go = true;
  env.handler = null;
  mockServer();
  const { root } = await mount();
  try {
    expect(w.session?.user.id).toBe("u");
    expect(devices).toHaveLength(1);
    expect(devices[0]).not.toHaveProperty("pushToken");
    expect(env.handler).toBeNull();
    expect(env.subscriptions).toBe(0);
    expect(env.notificationModuleLoads).toBe(0);
    await expect(w.registerDevice(true)).rejects.toThrow(
      "Push notifications are unavailable in Expo Go",
    );
    expect(env.requested).toBe(0);
    expect(devices).toHaveLength(1);
    // The free runtime must keep the existing identity/company lifecycle.
    await act(async () => w.switchCompany("d"));
    expect(w.company).toBe("d");
    await act(async () => w.signOut());
    expect(w.session).toBeNull();
    expect(w.work).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
it("shows foreground hints and never attaches a push token at sign-in, even when permission was already granted", async () => {
  mockServer();
  const { root } = await mount();
  const behavior = await env.handler.handleNotification({});
  expect(behavior).toMatchObject({
    shouldShowBanner: true,
    shouldShowList: true,
  });
  expect(env.requested).toBe(0);
  expect(devices).toHaveLength(1);
  expect(devices[0]).not.toHaveProperty("pushToken");
  expect(devices[0]).not.toHaveProperty("pushProvider");
  // A rotated OS token must not opt this user in either.
  await act(async () =>
    env.tokenListener({ type: "android", data: "token-2" }),
  );
  expect(devices).toHaveLength(1);
  await act(async () => root.unmount());
  expect(env.handler).toBeNull();
});
it("re-registers rotated tokens only after this user explicitly enabled push in this session", async () => {
  mockServer();
  const { root } = await mount();
  await act(async () => w.registerDevice(true));
  expect(env.requested).toBe(1);
  expect(devices.at(-1)).toMatchObject({
    pushProvider: "fcm",
    pushToken: "token-1",
  });
  await act(async () =>
    env.tokenListener({ type: "android", data: "token-2" }),
  );
  expect(devices.at(-1)).toMatchObject({
    deviceId: "device",
    pushProvider: "fcm",
    pushToken: "token-2",
  });
  const count = devices.length;
  await act(async () => w.signOut());
  await act(async () =>
    env.tokenListener({ type: "android", data: "token-3" }),
  );
  expect(devices).toHaveLength(count);
  await act(async () => root.unmount());
});
it("a notification that switches company ends the active call like a manual company switch", async () => {
  mockServer();
  const { root } = await mount();
  await act(async () => w.setCall({ id: "call-in-alpha" } as any));
  expect(w.call).not.toBeNull();
  await act(async () =>
    env.responseListener({
      notification: {
        request: {
          identifier: "n2",
          content: {
            data: { eventId: "e2", companyId: "d", conversationId: "x" },
          },
        },
      },
    }),
  );
  expect(w.company).toBe("d");
  expect(w.call).toBeNull();
  await act(async () => root.unmount());
});
it("a notification for the current company keeps the active call", async () => {
  mockServer();
  const { root } = await mount();
  await act(async () => w.setCall({ id: "call-in-alpha" } as any));
  await act(async () =>
    env.responseListener({
      notification: {
        request: {
          identifier: "n3",
          content: {
            data: { eventId: "e3", companyId: "c", conversationId: "x" },
          },
        },
      },
    }),
  );
  expect(w.call).not.toBeNull();
  await act(async () => root.unmount());
});
it("does not send or clear a push token on sign-in when permission is not granted", async () => {
  env.granted = false;
  mockServer();
  const { root } = await mount();
  expect(env.requested).toBe(0);
  expect(devices).toHaveLength(1);
  expect(devices[0]).not.toHaveProperty("pushToken");
  await expect(w.registerDevice(true)).rejects.toThrow(/disabled/);
  expect(env.requested).toBe(1);
  await act(async () => root.unmount());
});
it("opens Inbox for unknown notification payloads", async () => {
  mockServer();
  const { root } = await mount();
  await act(async () =>
    env.responseListener({
      notification: { request: { identifier: "n1", content: { data: {} } } },
    }),
  );
  expect(env.push).toEqual(["/(tabs)/inbox"]);
  await act(async () => root.unmount());
});
it("error banner is dismissible, clears on company switch and after a recovered poll", async () => {
  vi.useFakeTimers();
  mockServer();
  const { container, root } = await mount();
  const alert = () => container.querySelector('[role="alert"]');
  const selected = () =>
    container
      .querySelector('[aria-selected="true"]')
      ?.getAttribute("aria-label");
  expect(selected()).toBe("Alpha");
  await act(async () => w.setError("Upload failed"));
  expect(alert()?.textContent).toBe("Upload failed");
  await act(async () =>
    (
      container.querySelector('[aria-label="Dismiss error"]') as HTMLElement
    ).click(),
  );
  expect(alert()).toBeNull();
  await act(async () => w.setError("Stale company error"));
  await act(async () => w.switchCompany("d"));
  expect(alert()).toBeNull();
  expect(selected()).toBe("Beta");
  failPoll = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(alert()?.textContent).toBe("Network unavailable");
  failPoll = false;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(alert()).toBeNull();
  // A user-action error is not wiped by a later successful poll.
  await act(async () => w.setError("Microphone permission is required."));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(alert()?.textContent).toBe("Microphone permission is required.");
  await act(async () => root.unmount());
});
