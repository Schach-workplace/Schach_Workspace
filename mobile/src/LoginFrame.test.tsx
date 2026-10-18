// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import LoginFrame from "./LoginFrame";
vi.mock("react-native", () => ({
  StyleSheet: { create: <T,>(s: T) => s },
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  ScrollView: ({
    children,
    keyboardShouldPersistTaps,
    contentContainerStyle,
  }: any) =>
    createElement(
      "div",
      {
        "data-keyboard-taps": keyboardShouldPersistTaps,
        "data-grow": contentContainerStyle.flexGrow,
      },
      children,
    ),
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: any) => createElement("main", {}, children),
}));
vi.mock("./KeyboardFrame", () => ({
  default: ({ children, enabled = true }: any) =>
    createElement("section", { "data-keyboard-aware": enabled }, children),
}));
it("keeps all sign-in fields and the submit action in one safe-area keyboard-aware scroll", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const c = document.createElement("div");
  const root = createRoot(c);
  try {
    await act(async () =>
      root.render(
        <LoginFrame>
          <button>Sign in</button>
        </LoginFrame>,
      ),
    );
    expect(
      c.querySelector(
        'main [data-keyboard-aware="true"] [data-keyboard-taps="handled"] button',
      )?.textContent,
    ).toBe("Sign in");
    expect(c.querySelector('[data-grow="1"]')).not.toBeNull();
    expect(c.textContent).toContain("Workspace");
  } finally {
    await act(async () => root.unmount());
  }
});
