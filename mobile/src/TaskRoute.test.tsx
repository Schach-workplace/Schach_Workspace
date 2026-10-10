// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import TaskRoute from "./app/task/[id]";
const env = vi.hoisted(() => ({
  w: {} as any,
  company: "c",
  id: "outside-list",
  focused: true,
}));
vi.mock("./Workspace", () => ({ useWorkspace: () => env.w }));
vi.mock("./TaskDetailScreen", () => ({
  default: ({ id }: any) => createElement("span", {}, "Targeted detail " + id),
}));
vi.mock("react-native", () => ({
  Text: ({ children }: any) => createElement("span", {}, children),
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: env.id, company: env.company }),
  Redirect: ({ href }: any) => createElement("span", {}, "Redirect " + href),
  useFocusEffect: (fn: any) =>
    useEffect(() => (env.focused ? fn() : undefined), [fn]),
}));
afterEach(() => {
  env.focused = true;
  env.company = "c";
});
it.each(["pending", "foreign", "logged-out", "authorized"])(
  "gates targeted task route with current session/company/access: %s",
  async (mode) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    env.w = {
      company: "c",
      session: { user: { id: "u" } },
      restoring: false,
      foreground: mode !== "pending",
      work: { tasks: [] },
      policyEpoch: 1,
    };
    if (mode === "foreign") env.company = "other";
    if (mode === "logged-out") env.w.session = null;
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(<TaskRoute />));
      expect(
        container.textContent.includes("Targeted detail outside-list"),
      ).toBe(mode === "authorized");
      if (mode === "foreign")
        expect(container.textContent).toContain("Redirect /(tabs)/work");
      if (mode === "logged-out")
        expect(container.textContent).toContain("Redirect /login");
    } finally {
      await act(async () => root.unmount());
    }
  },
);
it("withholds a private routed detail when its route is unfocused", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  env.focused = false;
  env.w = {
    company: "c",
    session: { user: { id: "u" } },
    foreground: true,
    work: { tasks: [] },
  };
  const c = document.createElement("div");
  const root = createRoot(c);
  try {
    await act(async () => root.render(<TaskRoute />));
    expect(c.textContent).toBe("");
  } finally {
    await act(async () => root.unmount());
  }
});
