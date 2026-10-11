// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
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
  choose: vi.fn(),
  auth: vi.fn(),
  hash: vi.fn(),
  selected: vi.fn(),
  c: {
    generation: 1,
    endpoint: "https://owned.test",
    registerCancellation: () => () => {},
  },
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
  client: h.c,
  NativeApiError: class extends Error {},
}));
vi.mock("./capture", () => ({
  captureOwner: () => ({ select: h.selected }),
  financeFileIntent: () => ({ original: true }),
  authorizeFinanceFile: h.auth,
  authorizeCapture: vi.fn(),
  chooseFinanceFile: h.choose,
}));
vi.mock("./FinanceIntakeReview", () => ({
  financePreviewHash: h.hash,
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

it("reserves and adopts same original file after chooser foreground reauthorization changes request generation", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.execute.mockClear();
  h.w.work.me.role = "finance";
  const node = document.createElement("div"),
    root = createRoot(node);
  const file = {
    uri: "owned.csv",
    name: "fictional.csv",
    size: 212,
    delete: vi.fn(),
  };
  h.choose.mockImplementation(async () => {
    h.c.generation++;
    h.w.foreground = false;
    root.render(createElement(FinanceAssistanceScreen));
    await new Promise((r) => setTimeout(r, 0));
    h.w.foreground = true;
    root.render(createElement(FinanceAssistanceScreen));
    await new Promise((r) => setTimeout(r, 0));
    return file;
  });
  h.hash.mockResolvedValue("exact-original-hash");
  h.auth.mockResolvedValue(undefined);
  h.execute.mockImplementation(
    async (_p: any, _b: any, _m: any, commit: any) => {
      commit({ id: "real-file-intake" });
      return { id: "real-file-intake" };
    },
  );
  await act(async () => root.render(createElement(FinanceAssistanceScreen)));
  await act(async () => {
    [...node.querySelectorAll("button")]
      .find((b) => b.textContent === "Choose bank CSV")!
      .click();
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(h.execute).toHaveBeenCalledWith(
    "/finance/intakes",
    {
      purpose: "statement",
      fileName: "fictional.csv",
      size: 212,
      sha256: "exact-original-hash",
    },
    "POST",
    expect.any(Function),
  );
  expect(h.selected).toHaveBeenCalledWith(file);
  await act(async () => root.unmount());
  h.w.work.me.role = "member";
});

it.each(["policy", "denied"])(
  "deletes the original returned bytes and never reserves after %s loss during hash",
  async (kind) => {
    h.execute.mockClear();
    h.selected.mockClear();
    h.w.work.me.role = "finance";
    h.w.foreground = true;
    const node = document.createElement("div"),
      root = createRoot(node),
      file = {
        uri: "owned.csv",
        name: "fictional.csv",
        size: 212,
        delete: vi.fn(),
      };
    h.choose.mockResolvedValue(file);
    h.hash.mockImplementation(async () => {
      if (kind === "policy") {
        h.w.policyEpoch++;
        flushSync(() => root.render(createElement(FinanceAssistanceScreen)));
        await new Promise((r) => setTimeout(r, 0));
      }
      return "original-hash";
    });
    h.auth.mockImplementation(async () => {
      if (kind === "denied") throw Error("Current finance denied");
    });
    await act(async () => root.render(createElement(FinanceAssistanceScreen)));
    await act(async () => {
      [...node.querySelectorAll("button")]
        .find((b) => b.textContent === "Choose bank CSV")!
        .click();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.selected).not.toHaveBeenCalled();
    expect(file.delete).toHaveBeenCalled();
    await act(async () => root.unmount());
    h.w.work.me.role = "member";
  },
);
