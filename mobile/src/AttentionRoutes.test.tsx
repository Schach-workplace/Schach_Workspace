// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import ExpenseRoute from "./app/expense/[id]";
import IntakeRoute from "./app/intake/[id]";
const env = vi.hoisted(() => ({ w: {} as any, company: "c", focused: true }));
vi.mock("./Workspace", () => ({
  useWorkspace: () => env.w,
  Page: ({ children }: any) => createElement("div", {}, children),
}));
vi.mock("./ExpenseDecision", () => ({
  default: ({ expense }: any) =>
    createElement("span", {}, "Exact expense " + expense.id),
}));
vi.mock("./Intake", () => ({
  default: ({ initialId }: any) =>
    createElement("span", {}, "Exact published intake " + initialId),
}));
vi.mock("react-native", () => ({
  Text: ({ children }: any) => createElement("span", {}, children),
}));
vi.mock("expo-router", () => ({
  router: { back: vi.fn() },
  useLocalSearchParams: () => ({
    id: "outside-first-100",
    company: env.company,
  }),
  Redirect: ({ href }: any) => createElement("span", {}, "Redirect " + href),
  useFocusEffect: (fn: any) =>
    useEffect(() => (env.focused ? fn() : undefined), [fn]),
}));
it.each(["expense", "intake"])(
  "opens exact %s independently of initial lists with current focus/company/access guards",
  async (kind) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    env.company = "c";
    env.focused = true;
    env.w = {
      company: "c",
      session: { user: { id: "u" } },
      foreground: true,
      work: { tasks: [], expenses: [] },
      policyEpoch: 1,
    };
    const host = document.createElement("div");
    const root = createRoot(host);
    const Component = kind === "expense" ? ExpenseRoute : IntakeRoute;
    await act(async () => root.render(<Component />));
    expect(host.textContent).toContain("outside-first-100");
    env.w = { ...env.w, foreground: false };
    await act(async () => root.render(<Component />));
    expect(host.textContent).not.toContain("outside-first-100");
    env.w = { ...env.w, foreground: true };
    env.company = "foreign";
    await act(async () => root.render(<Component />));
    expect(host.textContent).toContain("Redirect /(tabs)/work");
    await act(async () => root.unmount());
  },
);
