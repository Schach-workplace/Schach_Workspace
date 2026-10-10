// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import CaptureControl from "./CaptureControl";
import { CaptureOwner } from "./captureOwner";
const env = vi.hoisted(() => ({
  owner: null as any,
  append: vi.fn(),
  authorize: vi.fn(),
  confirm: null as any,
  uploaded: vi.fn(),
}));
vi.mock("./capture", () => ({
  captureOwner: () => env.owner,
  captureImage: async () => env.owner.state.file,
  chooseCapture: async () => env.owner.state.file,
  authorizeCapture: env.authorize,
  appendCapture: env.append,
}));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
}));
vi.mock("react-native", () => ({
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  Image: ({ accessibilityLabel }: any) =>
    createElement("img", { alt: accessibilityLabel }),
  Alert: {
    alert: (_t: any, _m: any, buttons: any) => {
      env.confirm = buttons.find((b: any) => b.text === "Discard").onPress;
    },
  },
}));
afterEach(() => {
  env.append.mockReset();
  env.authorize.mockReset();
  env.uploaded.mockReset();
});
it("requires explicit upload, blocks additive repeat until authorized Recheck and confirms discard", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const scope = {
    serverOrigin: "https://test",
    companyId: "c",
    userId: "u",
    targetKind: "task" as const,
    targetId: "t",
  };
  env.owner = new CaptureOwner(scope);
  const dispose = vi.fn();
  env.owner.select({
    name: "evidence.png",
    uri: "owned://cache",
    mime: "image/png",
    size: 20,
    delete: dispose,
  });
  env.append.mockRejectedValueOnce(Error("Committed ACK lost"));
  env.authorize.mockResolvedValue(undefined);
  env.uploaded.mockResolvedValue(undefined);
  const c = document.createElement("div");
  const root = createRoot(c);
  const button = (title: string) =>
    [...c.querySelectorAll("button")].find((b) => b.textContent === title)!;
  const click = async (title: string) =>
    act(async () => {
      expect(button(title).disabled).toBe(false);
      button(title).click();
    });
  try {
    await act(async () =>
      root.render(
        <CaptureControl
          scope={scope}
          label="Task evidence"
          onUploaded={env.uploaded}
        />,
      ),
    );
    expect(env.append).not.toHaveBeenCalled();
    await click("Upload to Task evidence");
    expect(env.append).toHaveBeenCalledOnce();
    expect(button("Upload to Task evidence").disabled).toBe(true);
    await click("Recheck record");
    expect(env.authorize).toHaveBeenCalledTimes(2);
    expect(env.uploaded).toHaveBeenCalledOnce();
    expect(button("Upload to Task evidence").disabled).toBe(false);
    await click("Discard selected file");
    expect(env.owner.state.file).not.toBeNull();
    await act(async () => env.confirm());
    expect(env.owner.state.file).toBeNull();
    expect(dispose).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
  }
});
