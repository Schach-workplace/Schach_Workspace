// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
const h = vi.hoisted(() => ({
  assessment: {} as any,
  execute: vi.fn().mockResolvedValue({}),
  ready: true,
  capture: { state: {}, subscribe: () => () => {}, clear: vi.fn() },
}));
vi.mock("./Workspace", () => ({
  useWorkspace: () => ({
    company: "outcome",
    session: { user: { id: "actor" } },
  }),
}));
vi.mock("./client", () => ({ client: { endpoint: "https://owned.test" } }));
vi.mock("./capture", () => ({ captureOwner: () => h.capture }));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("expo-crypto", () => ({}));
vi.mock("./ramInput", () => ({
  useRamInput: (_f: string, _k: string, v: any) => useState(v),
}));
vi.mock("./execution", () => ({
  useExecutionRead: () => ({
    ready: h.ready,
    data: h.ready
      ? {
          id: "source",
          state: "scanning",
          version: 3,
          purpose: "receipt",
          assessment: h.assessment,
        }
      : undefined,
    retry: vi.fn(),
  }),
  useExecutionMutation: () => ({ execute: h.execute, busy: false }),
}));
vi.mock("./ConnectUI", () => ({
  Sheet: ({ children }: any) => createElement("div", {}, children),
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { disabled, onClick: onPress }, title),
}));
vi.mock("react-native", () => ({
  Text: ({ children }: any) => createElement("span", {}, children),
  Image: () => null,
}));
import FinanceIntakeReview from "./FinanceIntakeReview";
it.each([
  ["rejected", "scan_rejected", false],
  ["failed", "scan_unavailable", true],
  ["failed", "retry_exhausted", true],
])(
  "renders terminal native %s/%s and keeps rejected bytes quarantined",
  async (status, errorCode, retryable) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    h.assessment = { status, errorCode, retryable };
    h.ready = true;
    h.execute.mockClear();
    const node = document.createElement("div");
    const root = createRoot(node);
    const props = {
      id: "source",
      onClose: () => {},
      onExtracted: () => {},
      onStatement: () => {},
    };
    await act(async () =>
      root.render(createElement(FinanceIntakeReview, props)),
    );
    const button = (title: string) =>
      [...node.querySelectorAll("button")].find((b) => b.textContent === title);
    expect(button("Check clean assessment")).toBeUndefined();
    expect(node.textContent).toMatch(/remains quarantined/i);
    expect(button("Extract this clean receipt")).toBeUndefined();
    if (retryable) {
      await act(async () =>
        button("Retry unavailable clean assessment")!.click(),
      );
      expect(h.execute).toHaveBeenCalledWith(
        "/finance/intakes/source/finalize",
        { expectedVersion: 3, retryAssessment: true },
      );
    } else expect(button("Retry unavailable clean assessment")).toBeUndefined();
    await act(async () => button("Cancel private intake")!.click());
    expect(h.execute).toHaveBeenCalledWith("/finance/intakes/source/cancel", {
      expectedVersion: 3,
    });
    h.ready = false;
    await act(async () =>
      root.render(createElement(FinanceIntakeReview, props)),
    );
    expect(node.textContent).not.toMatch(/remains quarantined/i);
    await act(async () => root.unmount());
  },
);
