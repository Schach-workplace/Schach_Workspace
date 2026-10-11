// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import FinanceDraftForm from "./FinanceDraftForm";
const s = vi.hoisted(() => ({ w: {} as any, request: vi.fn() }));
vi.mock("./Execution", () => ({ NativeProjectChoice: () => null }));
vi.mock("./Workspace", () => ({ useWorkspace: () => s.w, styles: {} }));
vi.mock("./client", () => ({
  client: { endpoint: "https://owned.test", generation: 1, request: s.request },
  NativeApiError: class extends Error {},
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Sheet: ({ children }: any) => createElement("div", {}, children),
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
}));
vi.mock("react-native", () => ({
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  TextInput: ({ value, onChangeText, accessibilityLabel, editable }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      disabled: editable === false,
      onInput: (e: any) => onChangeText(e.target.value),
    }),
}));
it("submits human decimal amount as a keyed exact draft and keeps frozen unknown response", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.w = {
    foreground: true,
    company: "c",
    session: { user: { id: "u" } },
    work: {
      company: { currency: "INR" },
      me: { id: "u", role: "founder", departmentId: "d" },
      departments: [{ id: "d", name: "Finance" }],
      expenseCategories: [{ id: "cat", name: "Materials", active: true }],
      projects: [],
      tasks: [],
    },
    refresh: vi.fn(),
  };
  s.request.mockRejectedValue(Error("Lost response"));
  const c = document.createElement("div");
  document.body.append(c);
  const root = createRoot(c);
  await act(async () =>
    root.render(
      createElement(FinanceDraftForm, {
        onClose: () => {},
        onCreated: () => {},
      }),
    ),
  );
  const input = async (label: string, value: string) =>
    act(async () => {
      const x = c.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
      x.value = value;
      x.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await input("Expense title", "Fictional supplies");
  await input("Vendor", "Demo Stationery");
  await input("Expense date", "2026-10-10");
  await input("Amount (INR)", "1300.50");
  await act(async () => {
    [...c.querySelectorAll("button")]
      .find((x) => x.textContent === "Materials")!
      .click();
  });
  await act(async () => {
    [...c.querySelectorAll("button")]
      .find((x) => x.textContent === "Create reviewed draft")!
      .click();
  });
  expect(s.request.mock.calls[0][2].amountMinor).toBe(130050);
  expect(s.request.mock.calls[0][2].retryKey).toBeTruthy();
  const first = s.request.mock.calls[0][2];
  await act(async () => {
    [...c.querySelectorAll("button")]
      .find((x) => x.textContent === "Retry same draft")!
      .click();
  });
  expect(s.request.mock.calls[1][2]).toEqual(first);
  await act(async () => root.unmount());
  c.remove();
});
