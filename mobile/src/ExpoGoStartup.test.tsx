// @vitest-environment happy-dom
import { act, createElement, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ go: true, events: [] as string[] }));
vi.mock("expo", () => ({ isRunningInExpoGo: () => env.go }));
vi.mock("@livekit/react-native", () => {
  if (env.go) throw Error("LiveKit native module is unavailable in Expo Go");
  return { registerGlobals: () => env.events.push("register") };
});
vi.mock("./Calls", () => {
  if (env.go) throw Error("Calls must not load in Expo Go");
  env.events.push("calls-module");
  return {
    default: () => createElement("div", {}, "Native calls"),
    ActiveCall: () => createElement("div", {}, "Native active call"),
  };
});
vi.mock("./reportClient", () => ({ initializeReportTemps: async () => {} }));
vi.mock("./Workspace", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  Page: ({ children }: { children: ReactNode }) =>
    createElement("main", {}, children),
}));
vi.mock("expo-router", () => ({
  Stack: () => createElement("div", {}, "Workspace routes"),
  useFocusEffect: (fn: () => void) => useEffect(fn, [fn]),
}));
vi.mock("react-native", () => ({
  Text: ({ children }: { children: ReactNode }) =>
    createElement("span", {}, children),
  View: ({ children }: { children: ReactNode }) =>
    createElement("div", {}, children),
}));

let cleanup = async () => {};
afterEach(async () => {
  await cleanup();
  vi.resetModules();
  env.events = [];
});

async function render(Component: React.ComponentType) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  const root = createRoot(container);
  cleanup = async () => {
    await act(async () => root.unmount());
  };
  await act(async () => {
    root.render(createElement(Component));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return container;
}

it("opens core routes in Expo Go without evaluating custom native call modules", async () => {
  env.go = true;
  const { default: Layout } = await import("./app/_layout");
  const container = await render(Layout);
  expect(container.textContent).toContain("Workspace routes");
  expect(container.textContent).not.toContain("Native active call");
  expect(env.events).toEqual([]);
});

it("opens the Calls destination in Expo Go with an honest unavailable state", async () => {
  env.go = true;
  const { default: CallsRoute } = await import("./app/(tabs)/calls");
  const container = await render(CallsRoute);
  expect(container.textContent).toContain("Calls are unavailable in Expo Go");
  expect(env.events).toEqual([]);
});

it("initializes and renders native calls outside Expo Go", async () => {
  env.go = false;
  const { default: Layout } = await import("./app/_layout");
  const container = await render(Layout);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(container.textContent).toContain("Native active call");
  expect(env.events).toEqual(["register", "calls-module"]);
});
