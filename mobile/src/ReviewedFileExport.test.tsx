// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import ReviewedFileExport from "./ReviewedFileExport";
const h = vi.hoisted(() => ({
  valid: true,
  request: vi.fn(),
  share: vi.fn(),
  retry: vi.fn(),
  data: { id: "d", version: 1, text: "Fictional controlled export" },
}));
vi.mock("./execution", () => ({
  useExecutionRead: () => ({ ready: true, data: h.data, retry: h.retry }),
  useExecutionGuard: () => () => () => h.valid,
}));
vi.mock("./Workspace", () => ({
  useWorkspace: () => ({ company: "co", foreground: true, work: {} }),
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
  h.request.mockReset();
  h.share.mockReset();
  h.retry.mockReset();
  h.request.mockResolvedValue(h.data);
});
it.each(["current", "changed", "revoked"])(
  "exports only reviewed %s current source and keeps copies explicit",
  async (mode) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const node = document.createElement("div"),
      root = createRoot(node);
    const click = async (s: string) =>
      act(async () =>
        [...node.querySelectorAll("button")]
          .find((b) => b.textContent === s)!
          .click(),
      );
    try {
      await act(async () =>
        root.render(
          <ReviewedFileExport<{ id: string; version: number; text: string }>
            title="Guidance export"
            path="/knowledge/d"
            fileName="guidance.md"
            description="Titles and guidance body"
            signature={(d) => d.id + ":" + d.version}
            summarize={(d) => [d.text]}
            serialize={(d) => d.text}
            options={{
              mimeType: "text/markdown",
              UTI: "public.plain-text",
              dialogTitle: "Share guidance",
            }}
            onClose={() => {}}
          />,
        ),
      );
      expect(
        [...node.querySelectorAll("button")].find(
          (b) => b.textContent === "Share reviewed file",
        )!.disabled,
      ).toBe(true);
      await click("I reviewed these fields and the external audience");
      if (mode === "changed")
        h.request.mockResolvedValue({ ...h.data, version: 2 });
      if (mode === "revoked")
        h.request.mockImplementation(async () => {
          h.valid = false;
          return h.data;
        });
      await click("Share reviewed file");
      expect(h.share).toHaveBeenCalledTimes(mode === "current" ? 1 : 0);
      if (mode === "changed")
        expect(node.textContent).toContain("Source changed");
    } finally {
      await act(async () => root.unmount());
    }
  },
);
