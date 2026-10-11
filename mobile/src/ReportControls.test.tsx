// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { ReportField } from "./ReportControls";
vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  Sheet: ({ children }: any) => createElement("div", {}, children),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  Text: ({ children }: any) => createElement("span", {}, children),
  View: ({ children }: any) => createElement("div", {}, children),
  TextInput: ({ accessibilityLabel, value, editable }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      readOnly: true,
      disabled: editable === false,
    }),
}));
const env = vi.hoisted(() => ({ picker: {} as any }));
vi.mock("@react-native-community/datetimepicker", () => ({
  default: (props: any) => {
    env.picker = props;
    return createElement("span", {}, "Native picker " + props.mode);
  },
}));
it("offers actual zoned calendar selection alongside labelled manual input and keeps authored input editable during pending picker authorization", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const c = document.createElement("div"),
    root = createRoot(c);
  const change = vi.fn();
  try {
    await act(async () =>
      root.render(
        <ReportField
          {...({
            label: "Historical start date YYYY-MM-DD",
            value: "2026-09-01",
            calendar: "date",
            timezone: "Asia/Kolkata",
            onChange: change,
          } as any)}
        />,
      ),
    );
    const button = Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === "Choose Historical start date YYYY-MM-DD",
    );
    expect(button).toBeTruthy();
    await act(async () => button!.click());
    expect(env.picker.mode).toBe("date");
    expect(env.picker.timeZoneName).toBe("Asia/Kolkata");
    await act(async () =>
      env.picker.onValueChange({}, new Date("2026-09-03T06:30:00Z")),
    );
    expect(change).not.toHaveBeenCalled();
    await act(async () =>
      Array.from(c.querySelectorAll("button"))
        .find(
          (b) =>
            b.textContent ===
            "Confirm selected Historical start date YYYY-MM-DD",
        )!
        .click(),
    );
    expect(change).toHaveBeenCalledWith("2026-09-03");
    await act(async () =>
      root.render(
        <ReportField
          {...({
            label: "Historical start date YYYY-MM-DD",
            value: "2026-09-03",
            calendar: "date",
            timezone: "Asia/Kolkata",
            pickerDisabled: true,
            onChange: change,
          } as any)}
        />,
      ),
    );
    expect(c.querySelector("input")!.disabled).toBe(false);
    expect(
      Array.from(c.querySelectorAll("button")).find((b) =>
        b.textContent?.startsWith("Choose"),
      )?.disabled,
    ).toBe(true);
  } finally {
    await act(() => root.unmount());
  }
});

it("retains an open native calendar through pending authorization and stages selection until authorized confirmation", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const c = document.createElement("div"),
    root = createRoot(c),
    change = vi.fn();
  const props = {
    label: "Saved start date YYYY-MM-DD",
    value: "2026-09-01",
    calendar: "date" as const,
    timezone: "UTC",
    onChange: change,
  };
  const render = async (pending: boolean) =>
    act(async () =>
      root.render(<ReportField {...props} pickerDisabled={pending} />),
    );
  try {
    await render(false);
    await act(async () =>
      Array.from(c.querySelectorAll("button"))
        .find((b) => b.textContent === "Choose Saved start date YYYY-MM-DD")!
        .click(),
    );
    expect(c.textContent).toContain("Native picker date");
    await render(true);
    expect(c.textContent).toContain("Native picker date");
    await act(async () =>
      env.picker.onValueChange({}, new Date("2026-09-03T12:00:00Z")),
    );
    expect(change).not.toHaveBeenCalled();
    const confirm = Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === "Confirm selected Saved start date YYYY-MM-DD",
    )!;
    expect(confirm).toBeTruthy();
    expect(confirm.disabled).toBe(true);
    await render(false);
    await act(async () =>
      Array.from(c.querySelectorAll("button"))
        .find(
          (b) =>
            b.textContent === "Confirm selected Saved start date YYYY-MM-DD",
        )!
        .click(),
    );
    expect(change).toHaveBeenCalledWith("2026-09-03");
  } finally {
    await act(() => root.unmount());
  }
});
