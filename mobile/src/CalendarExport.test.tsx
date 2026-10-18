// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import CalendarExport from "./CalendarExport";
const h = vi.hoisted(() => ({
  valid: true,
  read: {} as any,
  request: vi.fn(),
  share: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("./Workspace", () => ({
  useWorkspace: () => ({ company: "co", foreground: true, work: {} }),
}));
vi.mock("./execution", () => ({
  useExecutionRead: () => ({ ready: true, data: h.read, retry: h.retry }),
  useExecutionGuard: () => () => () => h.valid,
}));
vi.mock("./client", () => ({ client: { request: h.request } }));
vi.mock("./shareDocument", () => ({ shareDocument: h.share }));
vi.mock("react-native", () => ({
  Text: ({ children }: any) => createElement("span", {}, children),
  View: ({ children }: any) => createElement("div", {}, children),
}));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Sheet: ({ children }: any) => createElement("div", {}, children),
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
}));
beforeEach(() => {
  h.valid = true;
  h.read = {
    tasks: [
      {
        id: "t",
        title: "Drawings",
        dueDate: "2026-10-20",
        deadlineMode: "all_day",
      },
    ],
    complete: true,
    timezone: "Asia/Kolkata",
  };
  h.request.mockReset();
  h.share.mockReset();
  h.retry.mockReset();
  h.request.mockImplementation(async () => h.read);
});
it.each(["current", "changed", "revoked"])(
  "reauthorizes %s calendar before export and requires explicit review",
  async (mode) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const node = document.createElement("div"),
      root = createRoot(node),
      close = vi.fn();
    const click = async (text: string) =>
      act(async () =>
        [...node.querySelectorAll("button")]
          .find((b) => b.textContent === text)!
          .click(),
      );
    try {
      await act(async () =>
        root.render(
          <CalendarExport from="2026-10-18" to="2026-11-14" onClose={close} />,
        ),
      );
      expect(
        [...node.querySelectorAll("button")].find(
          (b) => b.textContent === "Share calendar file",
        )!.disabled,
      ).toBe(true);
      await click("I reviewed the export fields and external audience");
      if (mode === "changed")
        h.request.mockResolvedValue({ ...h.read, tasks: [] });
      if (mode === "revoked")
        h.request.mockImplementation(async () => {
          h.valid = false;
          return h.read;
        });
      await click("Share calendar file");
      expect(h.request.mock.calls[0][0]).toContain(
        "/companies/co/planning/calendar?",
      );
      expect(h.share).toHaveBeenCalledTimes(mode === "current" ? 1 : 0);
      if (mode === "current") expect(close).toHaveBeenCalledTimes(1);
      if (mode === "changed") {
        expect(node.textContent).toContain("Calendar changed");
        expect(h.retry).toHaveBeenCalledOnce();
        expect(
          [...node.querySelectorAll("button")].find(
            (b) => b.textContent === "Share calendar file",
          )!.disabled,
        ).toBe(true);
      }
    } finally {
      await act(async () => root.unmount());
    }
  },
);
