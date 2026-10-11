// @vitest-environment happy-dom
import More from "./app/(tabs)/more";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  work: { me: { role: "member" } },
  foreground: true,
  company: "company",
  push: vi.fn(),
}));
vi.mock("expo-router", () => ({ router: { push: h.push } }));
vi.mock("../../Workspace", () => ({
  useWorkspace: () => h,
  Page: ({ children }: any) => createElement("div", {}, children),
  styles: {},
}));
vi.mock("./Workspace", () => ({
  useWorkspace: () => h,
  Page: ({ children }: any) => createElement("div", {}, children),
  styles: {},
}));
vi.mock("react-native", () => ({
  Text: ({ children }: any) => createElement("span", {}, children),
}));
vi.mock("../../ConnectUI", () => ({
  Action: ({ title, onPress }: any) =>
    createElement("button", { onClick: onPress }, title),
}));
vi.mock("./ConnectUI", () => ({
  Action: ({ title, onPress }: any) =>
    createElement("button", { onClick: onPress }, title),
}));
it("routes each retained module and account through a real company-qualified route", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const c = document.createElement("div");
  const r = createRoot(c);
  await act(async () => r.render(createElement(More)));
  expect([...c.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
    "Finance",
    "Projects",
    "Reports",
    "Requests",
    "Account",
  ]);
  await act(async () => c.querySelector("button")!.click());
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/finance",
    params: { company: "company" },
  });
  await act(async () => r.unmount());
});
