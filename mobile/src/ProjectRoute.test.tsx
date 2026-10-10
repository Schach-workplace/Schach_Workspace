// @vitest-environment happy-dom
import { act, createElement, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import ProjectRoute from "./app/project/[id]";
const s = vi.hoisted(() => ({ w: {} as any, params: {} as any }));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => s.params,
  useFocusEffect: (fn: () => void) => useEffect(fn, [fn]),
  Redirect: ({ href }: { href: string }) =>
    createElement("span", {}, "Redirect " + href),
}));
vi.mock("./Workspace", () => ({ useWorkspace: () => s.w }));
vi.mock("./ProjectScreen", () => ({
  default: ({ id }: { id: string }) =>
    createElement("span", {}, "Independent current project " + id),
}));
vi.mock("react-native", () => ({
  Text: ({ children }: { children: ReactNode }) =>
    createElement("span", {}, children),
}));
let r: Root, c: HTMLDivElement;
beforeEach(() => {
  c = document.createElement("div");
  r = createRoot(c);
  s.params = { id: "beyond-page", company: "co" };
  s.w = {
    company: "co",
    session: { user: { id: "actor" } },
    foreground: true,
    work: {},
    policyEpoch: 1,
  };
});
afterEach(async () => {
  await act(() => r.unmount());
});
it("opens a company-qualified project independently of bootstrap lists", async () => {
  await act(() => r.render(createElement(ProjectRoute)));
  expect(c.textContent).toContain("Independent current project beyond-page");
});
it("rejects a project route belonging to another company", async () => {
  s.params.company = "other";
  await act(() => r.render(createElement(ProjectRoute)));
  expect(c.textContent).toContain("Redirect /(tabs)/work");
  expect(c.textContent).not.toContain("Independent current project");
});
it("holds project details behind foreground authorization", async () => {
  s.w.foreground = false;
  await act(() => r.render(createElement(ProjectRoute)));
  expect(c.textContent).toContain("Checking current company access");
  expect(c.textContent).not.toContain("Independent current project");
});
