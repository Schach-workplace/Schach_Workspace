// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import FinanceAssistanceScreen from "./FinanceAssistanceScreen";
const h = vi.hoisted(() => ({
  w: {
    foreground: true,
    company: "owned-company",
    policyEpoch: 1,
    session: { user: { id: "actor" } },
    work: {
      me: { role: "member", departmentId: "d" },
      departments: [{ id: "d", name: "Engineering" }],
    },
  },
  execute: vi.fn(),
  camera: vi.fn(),
}));
vi.mock("./Workspace", () => ({
  useWorkspace: () => h.w,
  styles: {},
  Page: ({ children }: any) => createElement("div", {}, children),
}));
vi.mock("./ConnectUI", () => ({
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
}));
vi.mock("./ramInput", () => ({
  useRamInput: (_f: string, _k: string, v: any) => useState(v),
}));
vi.mock("./execution", () => ({
  useExecutionRead: () => ({ ready: true, data: { items: [] } }),
  useExecutionMutation: () => ({ execute: h.execute }),
}));
vi.mock("./client", () => ({
  client: {
    generation: 1,
    endpoint: "https://owned.test",
    registerCancellation: () => () => {},
  },
}));
vi.mock("./capture", () => ({
  captureOwner: vi.fn(),
  authorizeCapture: vi.fn(),
  chooseFinanceFile: vi.fn(),
}));
vi.mock("./FinanceIntakeReview", () => ({
  financePreviewHash: vi.fn(),
  default: ({ id }: any) =>
    createElement("div", {}, "Actual reserved source " + id),
}));
vi.mock("./FinanceReceiptReview", () => ({ default: () => null }));
vi.mock("./FinanceStatementReview", () => ({ default: () => null }));
vi.mock("./FinanceDuplicateReview", () => ({ default: () => null }));
vi.mock("./FinanceReconciliation", () => ({ default: () => null }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("react-native", () => ({
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  FlatList: ({ ListHeaderComponent }: any) =>
    createElement("div", {}, ListHeaderComponent),
}));
it("reserves real receipt source before camera without fabricated identity and hides bank controls for personal scope", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.execute.mockImplementation(
    async (_p: any, _b: any, _m: any, committed: any) => {
      committed({ id: "canonical-intake" });
      return { id: "canonical-intake" };
    },
  );
  const node = document.createElement("div");
  const root = createRoot(node);
  await act(async () => root.render(createElement(FinanceAssistanceScreen)));
  expect(node.textContent).not.toContain("Choose bank CSV");
  await act(async () =>
    [...node.querySelectorAll("button")]
      .find((b) => b.textContent === "Engineering")!
      .click(),
  );
  const buttons = [...node.querySelectorAll("button")];
  const camera = buttons.find(
    (b) => b.textContent === "Reserve receipt camera capture",
  );
  expect(camera).toBeTruthy();
  await act(async () => camera!.click());
  expect(h.execute).toHaveBeenCalledWith(
    "/finance/intakes",
    { capture: true, purpose: "receipt", destinationDepartmentId: "d" },
    "POST",
    expect.any(Function),
  );
  expect(node.textContent).toContain("Actual reserved source canonical-intake");
  h.w.foreground = false;
  await act(async () => root.render(createElement(FinanceAssistanceScreen)));
  expect(node.textContent).not.toContain("canonical-intake");
  await act(async () => root.unmount());
  h.w.foreground = true;
});
