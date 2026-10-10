// @vitest-environment happy-dom
import { act, createElement, forwardRef, useImperativeHandle } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import KeyboardFrame from "./KeyboardFrame";
const env = vi.hoisted(() => ({ offset: 0, layout: () => {}, top: 148 }));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  View: forwardRef(function MeasuredView(
    { children, onLayout }: any,
    ref: any,
  ) {
    env.layout = onLayout;
    useImperativeHandle(ref, () => ({
      measureInWindow: (cb: any) => cb(0, env.top),
    }));
    return createElement("div", {}, children);
  }),
  KeyboardAvoidingView: ({ children, keyboardVerticalOffset }: any) => {
    env.offset = keyboardVerticalOffset;
    return createElement("section", {}, children);
  },
}));
it("accounts for screen origin below company headers and modal safe areas", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      <KeyboardFrame>
        <span>Send</span>
      </KeyboardFrame>,
    ),
  );
  await act(async () => env.layout());
  expect(env.offset).toBe(148);
  const height = 680;
  const keyboardScreenY = 530;
  expect(Math.max(height - (keyboardScreenY - env.offset), 0)).toBe(298);
  env.top = 24;
  await act(async () => env.layout());
  expect(env.offset).toBe(24);
  await act(async () => root.unmount());
});
