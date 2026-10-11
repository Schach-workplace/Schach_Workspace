// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import DeadlinePicker from "./DeadlinePicker";
const env = vi.hoisted(() => ({ picker: {} as any }));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  Text: ({ children }: any) => createElement("span", {}, children),
  View: ({ children }: any) => createElement("div", {}, children),
  TextInput: ({ accessibilityLabel, value }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      readOnly: true,
    }),
}));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
}));
vi.mock("@react-native-community/datetimepicker", () => ({
  default: (props: any) => {
    env.picker = props;
    return createElement("span", {}, "Native " + props.mode);
  },
}));
it("preserves accepted task default immediate calendar edits and all-day/timed controls without report staging", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const c = document.createElement("div"),
    root = createRoot(c),
    change = vi.fn();
  try {
    await act(async () =>
      root.render(
        <DeadlinePicker
          date="2026-09-01"
          time=""
          timezone="UTC"
          onChange={change}
        />,
      ),
    );
    expect(c.querySelector('input[aria-label="Due date"]')).toBeTruthy();
    expect(c.querySelector('input[aria-label="Deadline time"]')).toBeTruthy();
    await act(async () =>
      Array.from(c.querySelectorAll("button"))
        .find((b) => b.textContent === "Choose calendar date")!
        .click(),
    );
    await act(async () =>
      env.picker.onValueChange({}, new Date("2026-09-03T12:00:00Z")),
    );
    expect(change).toHaveBeenCalledWith({ date: "2026-09-03", time: "" });
    expect(c.textContent).not.toContain("Confirm selected");
    await act(async () =>
      Array.from(c.querySelectorAll("button"))
        .find((b) => b.textContent === "Use timed deadline")!
        .click(),
    );
    expect(change).toHaveBeenCalledWith({ date: "2026-09-01", time: "16:00" });
  } finally {
    await act(() => root.unmount());
  }
});
