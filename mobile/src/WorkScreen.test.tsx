// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WorkScreen from "./WorkScreen";
const state = vi.hoisted(() => ({ w: {} as any, request: vi.fn() }));
vi.mock("./client", () => ({ client: { request: state.request } }));
vi.mock("./Media", () => ({ default: { downloadPath: vi.fn() } }));
vi.mock("./Workspace", () => ({
  useWorkspace: () => state.w,
  styles: {},
  Page: ({ children }: { children: ReactNode }) =>
    createElement("div", {}, children),
}));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({
    title,
    onPress,
    disabled,
  }: {
    title: string;
    onPress: () => void;
    disabled?: boolean;
  }) => createElement("button", { onClick: onPress, disabled }, title),
  Sheet: ({
    title,
    children,
    onClose,
  }: {
    title: string;
    children: ReactNode;
    onClose: () => void;
  }) =>
    createElement(
      "section",
      { "aria-label": title },
      createElement("button", { onClick: onClose }, "Close"),
      children,
    ),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  StyleSheet: { create: (x: unknown) => x },
  View: ({ children }: { children: ReactNode }) =>
    createElement("div", {}, children),
  Text: ({
    children,
    accessibilityRole,
  }: {
    children: ReactNode;
    accessibilityRole?: string;
  }) => createElement("span", { role: accessibilityRole }, children),
  TextInput: ({
    value,
    onChangeText,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (text: string) => void;
    accessibilityLabel: string;
  }) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      onChange: (e: any) => onChangeText(e.target.value),
    }),
}));
let root: Root, container: HTMLDivElement;
const click = async (title: string) =>
  act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === title)!
      .click(),
  );
const fill = async (label: string, value: string) =>
  act(async () => {
    const input = container.querySelector(`input[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-10T20:00:00Z"));
  state.request.mockReset();
  state.request.mockImplementation(async (path: string) =>
    path.includes("/tasks/")
      ? { task: state.w.work.tasks[0] }
      : { id: "new-task" },
  );
  state.w = {
    company: "company",
    policyEpoch: 0,
    session: { user: { id: "me" } },
    setError: vi.fn(),
    refresh: vi.fn(async () => {}),
    work: {
      me: { id: "me", role: "member", departmentId: "d" },
      company: { id: "company", timezone: "Asia/Kolkata" },
      people: [
        { id: "reviewer", name: "Reviewer", role: "head", active: true },
      ],
      tasks: [
        {
          id: "open",
          title: "Prepare handover",
          status: "todo",
          version: 1,
          attachments: [],
          description: "",
          ownerId: "me",
          requiresApproval: false,
          dueDate: "2026-10-12",
        },
        {
          id: "done",
          title: "Finished work",
          status: "done",
          version: 1,
          attachments: [],
          dueDate: "2026-10-10",
        },
      ],
    },
  };
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});
it("keeps creation out of the list and supports search/status filters", async () => {
  await act(async () => root.render(createElement(WorkScreen)));
  expect(container.querySelector('input[aria-label="Task title"]')).toBeNull();
  await click("Open");
  expect(container.textContent).not.toContain("Finished work");
  await fill("Search work", "unrelated");
  expect(container.textContent).not.toContain("Prepare handover");
});
it("creates with a company-time shortcut and human local time", async () => {
  await act(async () => root.render(createElement(WorkScreen)));
  await click("New task");
  await fill("Task title", "Phone commitment");
  await click("Tomorrow");
  await fill("Deadline time", "16:00");
  await click("Create task");
  expect(state.request.mock.calls[0][1]).toBe("POST");
  expect(state.request.mock.calls[0][2]).toMatchObject({
    title: "Phone commitment",
    dueDate: "2026-10-12",
    dueAt: "2026-10-12T10:30:00.000Z",
    dueTimezone: "Asia/Kolkata",
    ownerId: "me",
  });
});
it("retains input after a network failure and guards overlapping submissions", async () => {
  let reject!: (e: Error) => void;
  state.request.mockImplementation(
    () =>
      new Promise((_resolve, r) => {
        reject = r;
      }),
  );
  await act(async () => root.render(createElement(WorkScreen)));
  await click("New task");
  await fill("Task title", "Keep my input");
  await act(async () => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Create task",
    )!;
    button.click();
    button.click();
  });
  expect(state.request).toHaveBeenCalledTimes(1);
  await act(async () => reject(Error("Network unavailable")));
  expect(
    (
      container.querySelector(
        'input[aria-label="Task title"]',
      ) as HTMLInputElement
    ).value,
  ).toBe("Keep my input");
  expect(container.textContent).toContain("Network unavailable");
});
it("clears a company-specific form and denies viewer creation", async () => {
  await act(async () => root.render(createElement(WorkScreen)));
  await click("New task");
  await fill("Task title", "Old company draft");
  state.w = {
    ...state.w,
    company: "another",
    work: { ...state.w.work, me: { ...state.w.work.me, role: "viewer" } },
  };
  await act(async () => root.render(createElement(WorkScreen)));
  expect(container.querySelector('input[aria-label="Task title"]')).toBeNull();
  expect(container.textContent).not.toContain("New task");
});
it("requires reviewing changed task details before a versioned write", async () => {
  state.request
    .mockResolvedValueOnce({ task: state.w.work.tasks[0] })
    .mockResolvedValue({ task: { ...state.w.work.tasks[0], version: 2 } });
  await act(async () => root.render(createElement(WorkScreen)));
  await click("Open: Prepare handover");
  await click("Submit for review / complete");
  expect(state.request).toHaveBeenCalledTimes(2);
  expect(state.request.mock.calls[0][0]).toContain("/tasks/");
  expect(state.request.mock.calls[0][1]).toBeUndefined();
  expect(state.w.refresh).toHaveBeenCalled();
  expect(container.textContent).toContain("Task changed or access changed");
});
it("retains the draft across temporary workspace absence and recovery", async () => {
  await act(async () => root.render(createElement(WorkScreen)));
  await click("New task");
  await fill("Task title", "Recover after outage");
  await click("Tomorrow");
  await fill("Deadline time", "16:00");
  const work = state.w.work;
  state.w = { ...state.w, work: null };
  await act(async () => root.render(createElement(WorkScreen)));
  state.w = { ...state.w, work };
  await act(async () => root.render(createElement(WorkScreen)));
  expect(
    (
      container.querySelector(
        'input[aria-label="Task title"]',
      ) as HTMLInputElement
    )?.value,
  ).toBe("Recover after outage");
  expect(
    (
      container.querySelector(
        'input[aria-label="Due date"]',
      ) as HTMLInputElement
    )?.value,
  ).toBe("2026-10-12");
  expect(
    (
      container.querySelector(
        'input[aria-label="Deadline time"]',
      ) as HTMLInputElement
    )?.value,
  ).toBe("16:00");
});
it("clears retained draft after a confirmed authorization epoch change", async () => {
  await act(async () => root.render(createElement(WorkScreen)));
  await click("New task");
  await fill("Task title", "Clear on confirmed access change");
  state.w = { ...state.w, policyEpoch: state.w.policyEpoch + 1 };
  await act(async () => root.render(createElement(WorkScreen)));
  expect(container.querySelector('input[aria-label="Task title"]')).toBeNull();
});
