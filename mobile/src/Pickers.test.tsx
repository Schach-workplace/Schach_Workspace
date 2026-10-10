// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DeadlinePicker from "./DeadlinePicker";
import PersonPicker from "./PersonPicker";
const env = vi.hoisted(() => ({ picker: null as any }));
vi.mock("@react-native-community/datetimepicker", () => ({
  default: function MockDatePicker(props: any) {
    useLayoutEffect(() => {
      env.picker = props;
    });
    return createElement("span", {}, "system calendar");
  },
}));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  Sheet: ({ children, onClose }: any) =>
    createElement(
      "section",
      {},
      createElement("button", { onClick: onClose }, "Close"),
      children,
    ),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  View: ({ children }: { children: ReactNode }) =>
    createElement("div", {}, children),
  Text: ({ children }: { children: ReactNode }) =>
    createElement("span", {}, children),
  TextInput: ({ accessibilityLabel, value, onChangeText }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      onChange: (e: any) => onChangeText(e.target.value),
    }),
  FlatList: ({ data, renderItem }: any) =>
    createElement(
      "div",
      {},
      data.map((item: any) =>
        createElement("div", { key: item.id }, renderItem({ item })),
      ),
    ),
}));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  root = createRoot(container);
  env.picker = null;
});
afterEach(() => act(() => root.unmount()));
const click = async (name: string) =>
  act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === name)!
      .click();
  });
it("uses company timezone and preserves original values when the calendar is canceled", async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(
      <DeadlinePicker
        date="2026-10-12"
        time="16:00"
        timezone="Asia/Kolkata"
        onChange={change}
      />,
    ),
  );
  await click("Choose calendar date");
  expect(env.picker.timeZoneName).toBe("Asia/Kolkata");
  await act(async () => env.picker.onDismiss());
  expect(change).not.toHaveBeenCalled();
  await click("Choose calendar date");
  await act(async () =>
    env.picker.onValueChange({}, new Date("2026-10-12T20:00:00Z")),
  );
  expect(change).toHaveBeenLastCalledWith({
    date: "2026-10-13",
    time: "16:00",
  });
  await click("Use all-day deadline");
  expect(change).toHaveBeenLastCalledWith({ date: "2026-10-12", time: "" });
});
it("offers only active authorized eligible people, searches names and clears a newly invalid reviewer", async () => {
  const change = vi.fn();
  const people = [
    { id: "owner", name: "Owner", role: "member", active: true },
    { id: "r", name: "Rita", role: "head", active: true },
    { id: "v", name: "Viewer", role: "viewer", active: true },
    { id: "off", name: "Inactive", role: "head", active: false },
  ];
  await act(async () =>
    root.render(
      <PersonPicker
        label="Reviewer"
        people={people}
        excludeIds={["owner"]}
        value=""
        onChange={change}
      />,
    ),
  );
  await click("Reviewer: Choose person");
  expect(container.textContent).toContain("Rita · head");
  expect(container.textContent).not.toContain("Owner ·");
  expect(container.textContent).not.toContain("Viewer ·");
  expect(container.textContent).not.toContain("Inactive ·");
  await click("Rita · head");
  expect(change).toHaveBeenLastCalledWith("r");
  await act(async () =>
    root.render(
      <PersonPicker
        label="Reviewer"
        people={people.map((p) => ({ ...p, active: false }))}
        value="r"
        onChange={change}
      />,
    ),
  );
  expect(change).toHaveBeenLastCalledWith("");
});
