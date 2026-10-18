// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import WorkspaceFrame from "./WorkspaceFrame";
import { Action } from "./ConnectUI";

vi.mock("react-native", () => ({
  StyleSheet: { create: <T,>(s: T) => s },
  View: ({
    children,
    style,
    pointerEvents,
    accessibilityElementsHidden,
  }: any) =>
    createElement(
      "div",
      {
        style: Array.isArray(style) ? Object.assign({}, ...style) : style,
        "data-pointer": pointerEvents,
        "aria-hidden": accessibilityElementsHidden || undefined,
      },
      children,
    ),
  Text: ({ children, accessibilityRole }: any) =>
    createElement("span", { role: accessibilityRole }, children),
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
    accessibilityState,
    style,
  }: any) =>
    createElement(
      "button",
      {
        onClick: onPress,
        disabled,
        "aria-label": accessibilityLabel,
        "aria-pressed": accessibilityState?.selected,
        style:
          typeof style === "function"
            ? Object.assign({}, ...style({ pressed: false }).filter(Boolean))
            : style,
      },
      children,
    ),
  ScrollView: ({ children, keyboardShouldPersistTaps }: any) =>
    createElement(
      "div",
      { "data-scroll": true, "data-keyboard-taps": keyboardShouldPersistTaps },
      children,
    ),
  Modal: ({ children }: any) => children,
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children, edges }: any) =>
    createElement("main", { "data-edges": edges?.join(",") }, children),
}));
vi.mock("./KeyboardFrame", () => ({
  default: ({ children }: any) => children,
}));

let cleanup = async () => {};
afterEach(async () => cleanup());
async function render(overrides: Record<string, unknown> = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const c = document.createElement("div");
  const root = createRoot(c);
  const props = {
    children: overrides.children,
    userName: "Fictional member",
    companies: [
      { id: "a", name: "Fictional North" },
      { id: "b", name: "Fictional South" },
    ],
    company: "a",
    scopeKey: "a:person",
    foreground: true,
    scroll: true,
    onSwitchCompany: vi.fn(),
    onDismissError: vi.fn(),
    error: "",
    ...overrides,
  };
  const update = async (next: Record<string, unknown>) => {
    Object.assign(props, next);
    await act(async () =>
      root.render(
        createElement(
          WorkspaceFrame,
          props as any,
          (props.children as any) ?? createElement("span", {}, "Private child"),
        ),
      ),
    );
  };
  await update({});
  cleanup = async () => act(async () => root.unmount());
  return { c, props, update };
}

it("announces company selection and dispatches the original company id", async () => {
  const { c, props } = await render({ error: "Fictional connection error" });
  expect(
    c
      .querySelector('[aria-label="Fictional North"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  await act(async () =>
    (c.querySelector('[aria-label="Fictional South"]') as HTMLElement).click(),
  );
  expect(props.onSwitchCompany).toHaveBeenCalledWith("b");
  expect(c.querySelector('[role="alert"]')?.textContent).toContain(
    "Fictional connection error",
  );
  await act(async () =>
    (c.querySelector('[aria-label="Dismiss error"]') as HTMLElement).click(),
  );
  expect(props.onDismissError).toHaveBeenCalledOnce();
});

it("uses bottom safe area on request and keeps taps available inside scrolling forms", async () => {
  const { c } = await render({ safeBottom: true });
  expect(c.querySelector("main")?.getAttribute("data-edges")).toContain(
    "bottom",
  );
  expect(c.querySelector('[data-keyboard-taps="handled"]')).not.toBeNull();
});

it.each([true, false])(
  "hides preserved background children from touch and accessibility, scroll=%s",
  async (scroll) => {
    const { c, update } = await render({ preserveMounted: true, scroll });
    await update({ foreground: false });
    const hidden = c.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(hidden?.textContent).toContain("Private child");
    expect(hidden?.style.opacity).toBe("0");
    expect(hidden?.getAttribute("data-pointer")).toBe("none");
    await update({ foreground: true });
    expect(c.querySelector('[aria-hidden="true"]')).toBeNull();
  },
);

it("unmounts ordinary background content and resets mounted state on a scope change", async () => {
  function Child() {
    const [n, set] = useState(0);
    return createElement("button", { onClick: () => set(n + 1) }, "Draft " + n);
  }
  const { c, update } = await render({ children: createElement(Child) });
  await act(async () =>
    [...c.querySelectorAll("button")]
      .find((b) => b.textContent === "Draft 0")!
      .click(),
  );
  expect(c.textContent).toContain("Draft 1");
  await update({ scopeKey: "b:person", company: "b" });
  expect(c.textContent).toContain("Draft 0");
  await update({ foreground: false });
  expect(c.textContent).not.toContain("Draft 0");
});

it("retains disabled and selected action semantics with comfortable touch targets", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const c = document.createElement("div");
  const root = createRoot(c);
  const press = vi.fn();
  cleanup = async () => act(async () => root.unmount());
  await act(async () =>
    root.render(
      createElement(Action, {
        title: "Pending",
        onPress: press,
        disabled: true,
        selected: true,
      }),
    ),
  );
  const button = c.querySelector("button")!;
  button.click();
  expect(press).not.toHaveBeenCalled();
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(parseInt(button.style.minHeight)).toBeGreaterThanOrEqual(48);
  expect(parseInt(button.style.minWidth)).toBeGreaterThanOrEqual(48);
});
