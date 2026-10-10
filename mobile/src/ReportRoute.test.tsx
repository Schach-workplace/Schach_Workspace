// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import ReportRoute from "./app/report/[id]";
const env = vi.hoisted(() => ({ w: {} as any, company: "co" }));
vi.mock("./Workspace", () => ({ useWorkspace: () => env.w }));
vi.mock("./ReportScreen", () => ({
  default: ({ id, kind }: any) =>
    createElement("span", {}, `Targeted ${kind} ${id}`),
}));
vi.mock("react-native", () => ({
  Text: ({ children }: any) => createElement("span", {}, children),
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "rj_outside-list", company: env.company }),
  Redirect: ({ href }: any) => createElement("span", {}, href),
  useFocusEffect: (fn: any) => useEffect(fn, [fn]),
}));
it.each(["pending", "foreign", "logged-out", "authorized"])(
  "company-qualified report route independently gates %s",
  async (mode) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    env.company = mode === "foreign" ? "other" : "co";
    env.w = {
      company: "co",
      session: mode === "logged-out" ? null : { user: { id: "user" } },
      work: { tasks: [] },
      foreground: mode !== "pending",
      restoring: false,
    };
    const c = document.createElement("div"),
      root = createRoot(c);
    try {
      await act(async () => root.render(<ReportRoute />));
      expect(c.textContent?.includes("Targeted job rj_outside-list")).toBe(
        mode === "authorized",
      );
      if (mode === "foreign") expect(c.textContent).toContain("/(tabs)/work");
      if (mode === "logged-out") expect(c.textContent).toContain("/login");
    } finally {
      await act(() => root.unmount());
    }
  },
);
