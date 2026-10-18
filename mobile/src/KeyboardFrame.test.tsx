// @vitest-environment happy-dom
import { act, createElement, forwardRef, useImperativeHandle } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import KeyboardFrame from "./KeyboardFrame";
const env = vi.hoisted(() => ({
  os: "android",
  offset: 0,
  layout: () => {},
  top: 148,
  height: 680,
  windowTop: undefined as number | undefined,
  handlers: new Map<string, (event: any) => void>(),
  measured: null as
    null | ((x: number, y: number, w: number, h: number) => void),
  defer: false,
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return env.os;
    },
  },
  Keyboard: {
    metrics: () => undefined,
    addListener: (event: string, callback: (event: any) => void) => {
      env.handlers.set(event, callback);
      return { remove: () => env.handlers.delete(event) };
    },
  },
  View: forwardRef(function MeasuredView(
    { children, onLayout, style }: any,
    ref: any,
  ) {
    if (onLayout) env.layout = onLayout;
    useImperativeHandle(ref, () => ({
      measure: (cb: any) => {
        if (env.defer) env.measured = (_x, y, w, h) => cb(0, 0, w, h, 0, y);
        else cb(0, 0, 350, env.height, 0, env.top);
      },
      measureInWindow: (cb: any) => {
        if (env.defer) env.measured = cb;
        else cb(0, env.windowTop ?? env.top, 350, env.height);
      },
    }));
    return createElement("div", { style }, children);
  }),
  KeyboardAvoidingView: ({ children, keyboardVerticalOffset }: any) => {
    env.offset = keyboardVerticalOffset;
    return createElement("section", {}, children);
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => {
  env.defer = false;
  env.os = "android";
  env.top = 148;
  env.height = 680;
  env.windowTop = undefined;
});
async function mount(enabled = true) {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <KeyboardFrame enabled={enabled}>
        <span>Send</span>
      </KeyboardFrame>,
    ),
  );
  await act(async () => env.layout());
  return { root, host };
}
it("keeps the existing measured iOS keyboard offset", async () => {
  env.os = "ios";
  const { root } = await mount();
  expect(env.offset).toBe(148);
  env.top = 24;
  await act(async () => env.layout());
  expect(env.offset).toBe(24);
  await act(async () => root.unmount());
});
it("remeasures Android overlap after native navigation moves the frame", async () => {
  env.top = 185;
  env.height = 584;
  const { root, host } = await mount();
  env.top = 234;
  env.windowTop = 185;
  await act(async () =>
    env.handlers.get("keyboardDidShow")?.({ endCoordinates: { screenY: 548 } }),
  );
  expect(host.querySelector('[style*="padding-bottom: 270px"]')).not.toBeNull();
  await act(async () => env.handlers.get("keyboardDidHide")?.({}));
  expect(host.querySelector('[style*="padding-bottom: 0px"]')).not.toBeNull();
  await act(async () => root.unmount());
  expect(env.handlers.size).toBe(0);
});
it("does not double-reserve an already resized Android window or a disabled frame", async () => {
  env.height = 350;
  const { root, host } = await mount();
  await act(async () =>
    env.handlers.get("keyboardDidShow")?.({ endCoordinates: { screenY: 548 } }),
  );
  expect(host.querySelector('[style*="padding-bottom: 0px"]')).not.toBeNull();
  env.height = 680;
  await act(async () =>
    root.render(
      <KeyboardFrame enabled={false}>
        <span>Send</span>
      </KeyboardFrame>,
    ),
  );
  await act(async () =>
    env.handlers.get("keyboardDidShow")?.({ endCoordinates: { screenY: 548 } }),
  );
  expect(host.querySelector('[style*="padding-bottom: 0px"]')).not.toBeNull();
  await act(async () => root.unmount());
});
it("discards a delayed measurement after the keyboard hides", async () => {
  const { root, host } = await mount();
  env.defer = true;
  await act(async () =>
    env.handlers.get("keyboardDidShow")?.({ endCoordinates: { screenY: 548 } }),
  );
  await act(async () => env.handlers.get("keyboardDidHide")?.({}));
  await act(async () => env.measured?.(0, 234, 350, 584));
  expect(host.querySelector('[style*="padding-bottom: 0px"]')).not.toBeNull();
  await act(async () => root.unmount());
});
