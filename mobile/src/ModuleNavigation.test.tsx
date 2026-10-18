// @vitest-environment happy-dom
import More from "./app/(tabs)/more";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  work: { me: { role: "member" } } as { me: { role: string } } | null,
  foreground: true,
  company: "company",
  policyEpoch: 1,
  session: { user: { id: "fictional-user" } },
  push: vi.fn(),
}));
vi.mock("expo-router", () => ({ router: { push: h.push } }));
vi.mock("./Workspace", () => ({
  useWorkspace: () => h,
  Page: ({ children }: any) => createElement("div", {}, children),
  styles: {},
}));
vi.mock("react-native", () => ({
  StyleSheet: { create: <T,>(s: T) => s },
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children, accessibilityRole }: any) =>
    createElement("span", { role: accessibilityRole }, children),
  TextInput: ({ accessibilityLabel, value, onChangeText }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      onInput: (e: any) => onChangeText(e.target.value),
    }),
  Pressable: ({ children, onPress, accessibilityLabel }: any) =>
    createElement(
      "button",
      { onClick: onPress, "aria-label": accessibilityLabel },
      children,
    ),
}));
vi.mock("./ConnectUI", () => ({
  Action: ({ title, onPress }: any) =>
    createElement("button", { onClick: onPress, "aria-label": title }, title),
}));
let cleanup = async () => {};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(h, {
    work: { me: { role: "member" } },
    foreground: true,
    company: "company",
    policyEpoch: 1,
    session: { user: { id: "fictional-user" } },
  });
  h.push.mockReset();
});
afterEach(async () => cleanup());
async function render() {
  const c = document.createElement("div");
  const r = createRoot(c);
  const update = async () => act(async () => r.render(createElement(More)));
  cleanup = async () => act(async () => r.unmount());
  await update();
  const press = async (label: string) =>
    act(async () =>
      (c.querySelector(`[aria-label="${label}"]`) as HTMLElement).click(),
    );
  const search = async (value: string) =>
    act(async () => {
      const input = c.querySelector(
        '[aria-label="Search modules"]',
      ) as HTMLInputElement;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  return { c, update, press, search };
}
it("retains every existing destination and makes calendar/workload findable with company-qualified routes", async () => {
  const { c, press } = await render();
  for (const [title, path] of [
    ["Finance", "/finance"],
    ["People", "/people"],
    ["Planning", "/planning"],
    ["Goals", "/goals"],
    ["Development", "/growth"],
    ["Knowledge", "/knowledge"],
    ["Projects", "/projects"],
    ["Reports", "/reports"],
    ["Requests", "/requests"],
    ["Calendar", "/calendar"],
    ["Workload", "/workload"],
  ]) {
    expect(c.querySelector(`[aria-label="${title}"]`)).not.toBeNull();
    await press(title);
    expect(h.push).toHaveBeenLastCalledWith({
      pathname: path,
      params: { company: "company" },
    });
  }
  await press("Local assistance history");
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/intelligence/[id]",
    params: { company: "company", id: "history" },
  });
  await press("Account");
  expect(h.push).toHaveBeenLastCalledWith("/account");
});
it("finds modules by purpose or group and recovers from an empty search", async () => {
  const { c, search, press } = await render();
  await search("capacity");
  expect(c.querySelector('[aria-label="Workload"]')).not.toBeNull();
  expect(c.querySelector('[aria-label="Finance"]')).toBeNull();
  await search("plan & deliver");
  expect(c.querySelector('[aria-label="Calendar"]')).not.toBeNull();
  await search("no-such-fictional-module");
  expect(c.textContent).toContain("No matching modules");
  await press("Clear search");
  expect(c.querySelector('[aria-label="Finance"]')).not.toBeNull();
});
it("preserves role-based discovery and does not infer authority from missing work", async () => {
  h.work = { me: { role: "viewer" } };
  const { c, update } = await render();
  expect(c.querySelector('[aria-label="Finance"]')).toBeNull();
  expect(c.querySelector('[aria-label="Overview"]')).not.toBeNull();
  h.work = null;
  await update();
  for (const title of ["Finance", "People", "Overview", "Reports"])
    expect(c.querySelector(`[aria-label="${title}"]`)).toBeNull();
  expect(c.querySelector('[aria-label="Account"]')).not.toBeNull();
  expect(
    c.querySelector('[aria-label="Local assistance history"]'),
  ).not.toBeNull();
});
it.each(["company", "actor", "policy"])(
  "resets directory search after a %s change",
  async (change) => {
    const { c, search, update, press } = await render();
    await search("capacity");
    if (change === "company") h.company = "next-company";
    if (change === "actor") h.session = { user: { id: "next-user" } };
    if (change === "policy") h.policyEpoch++;
    await update();
    expect(
      (c.querySelector('[aria-label="Search modules"]') as HTMLInputElement)
        .value,
    ).toBe("");
    await press("Finance");
    expect(h.push).toHaveBeenLastCalledWith({
      pathname: "/finance",
      params: { company: h.company },
    });
  },
);
