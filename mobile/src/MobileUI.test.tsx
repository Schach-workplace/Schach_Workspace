// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { FilterBar, RecordCard, EmptyState } from "./MobileUI";
vi.mock("react-native", () => ({
  StyleSheet: { create: (x: unknown) => x },
  View: ({ children }: any) => createElement("div", {}, children),
  ScrollView: ({ children, horizontal }: any) =>
    createElement("div", { "data-horizontal": horizontal }, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
    accessibilityState,
  }: any) =>
    createElement(
      "button",
      {
        onClick: onPress,
        "aria-label": accessibilityLabel,
        "aria-pressed": accessibilityState?.selected,
      },
      children,
    ),
}));
it("exposes selected filters and dispatches only the explicitly chosen value", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const c = document.createElement("div"),
    root = createRoot(c),
    change = vi.fn();
  try {
    await act(async () =>
      root.render(
        <FilterBar
          label="Expense status"
          value="all"
          options={[
            { value: "all", label: "All" },
            { value: "draft", label: "Drafts" },
          ]}
          onChange={change}
        />,
      ),
    );
    expect(c.querySelector('[data-horizontal="true"]')).toBeTruthy();
    expect(
      c.querySelector('[aria-label="All"]')?.getAttribute("aria-pressed"),
    ).toBe("true");
    await act(async () =>
      (c.querySelector('[aria-label="Drafts"]') as HTMLButtonElement).click(),
    );
    expect(change.mock.calls).toEqual([["draft"]]);
  } finally {
    await act(async () => root.unmount());
  }
});
it("makes a record one named action with complete title and metadata, without dispatching until pressed", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const c = document.createElement("div"),
    root = createRoot(c),
    open = vi.fn();
  try {
    await act(async () =>
      root.render(
        <RecordCard
          title="A long original commitment"
          label="Open commitment"
          status="Awaiting review"
          detail="14 October · 16:30 Asia/Kolkata"
          onPress={open}
        />,
      ),
    );
    expect(c.querySelectorAll("button")).toHaveLength(1);
    expect(c.textContent).toContain("14 October · 16:30 Asia/Kolkata");
    expect(open).not.toHaveBeenCalled();
    await act(async () =>
      (
        c.querySelector('[aria-label="Open commitment"]') as HTMLButtonElement
      ).click(),
    );
    expect(open).toHaveBeenCalledTimes(1);
    await act(async () =>
      root.render(
        <EmptyState
          title="No matching work"
          description="Change the status or search."
        />,
      ),
    );
    expect(c.textContent).toContain("Change the status or search.");
    expect(c.querySelector("button")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
