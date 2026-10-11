// @vitest-environment happy-dom
import AccountScreen from "./AccountScreen";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("./Workspace", () => ({
  useWorkspace: () => ({
    foreground: true,
    company: "company",
    session: { user: { id: "u" } },
    work: { company: { timezone: "Asia/Kolkata" } },
    policyEpoch: 1,
  }),
  Page: ({ children }: any) => createElement("div", {}, children),
  styles: {},
}));
vi.mock("./client", () => ({ client: { generation: 1 } }));
vi.mock("./ConnectUI", () => ({
  Action: ({ title, onPress }: any) =>
    createElement("button", { onClick: onPress }, title),
}));
vi.mock("react-native", () => ({
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  TextInput: ({ accessibilityLabel }: any) =>
    createElement("input", { "aria-label": accessibilityLabel }),
}));
it("preserves privacy, quiet-hours, devices, authenticator and sign-out controls", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const c = document.createElement("div");
  const r = createRoot(c);
  await act(async () => r.render(createElement(AccountScreen)));
  const text = c.textContent;
  for (const expected of [
    "Enable private notification hints",
    "Mute this company",
    "Authenticator protection",
    "Set up authenticator",
    "Sign out",
  ])
    expect(text).toContain(expected);
  expect(c.querySelector('[aria-label="Quiet hours start"]')).not.toBeNull();
  expect(
    c.querySelector('[aria-label="Current password for authenticator"]'),
  ).not.toBeNull();
  await act(async () => r.unmount());
});
