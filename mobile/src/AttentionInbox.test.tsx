// @vitest-environment happy-dom
import { act, createElement, Children } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AttentionInbox from "./AttentionInbox";
import { clearAllDrafts } from "./conversationDrafts";
const env = vi.hoisted(() => ({
  company: "c",
  request: vi.fn(),
  epoch: 0,
  foreground: true,
  push: vi.fn(),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "native-attention-key" }));
vi.mock("./client", () => ({
  client: { endpoint: "https://test", generation: 1, request: env.request },
  NativeApiError: class extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("./Workspace", () => ({
  styles: {},
  useWorkspace: () => ({
    company: env.company,
    session: { user: { id: "u" } },
    foreground: env.foreground,
    attentionEpoch: env.epoch,
    recordEpoch: 0,
    work: {
      readBasis: "basis",
      company: { timezone: "Asia/Kolkata" },
      me: { id: "u" },
      people: [],
    },
    refresh: async () => {},
    select: vi.fn(),
  }),
}));
vi.mock("expo-router", () => ({ router: { push: env.push } }));
vi.mock("./ConnectUI", () => ({
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  Sheet: ({ title, children, onClose }: any) =>
    createElement(
      "section",
      { "aria-label": title },
      createElement("button", { onClick: onClose }, "Close"),
      children,
    ),
}));
vi.mock("./PersonPicker", () => ({
  default: ({ people, onChange, label, value, disabled }: any) =>
    createElement(
      "select",
      {
        "aria-label": label,
        value,
        disabled,
        onChange: (e: any) => onChange(e.target.value),
      },
      createElement("option", { value: "" }, "Choose a person"),
      ...people.map((p: any) =>
        createElement("option", { key: p.id, value: p.id }, p.name),
      ),
    ),
}));
vi.mock("./DeadlinePicker", () => ({ default: () => null }));
vi.mock("react-native", () => ({
  Text: ({ children, accessibilityRole }: any) =>
    createElement("span", { role: accessibilityRole }, children),
  View: ({ children }: any) => {
    for (const child of Children.toArray(children))
      if (
        (typeof child === "string" && child !== "") ||
        typeof child === "number"
      )
        throw Error("Raw native Inbox text: " + JSON.stringify(child));
    return createElement("div", {}, children);
  },
  TextInput: ({ value, onChangeText, accessibilityLabel, editable }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      disabled: editable === false,
      onInput: (e: any) => onChangeText(e.target.value),
    }),
}));
const item = {
  id: "a",
  companyId: "c",
  recipientId: "u",
  sourceKind: "task",
  sourceId: "t",
  kind: "task_review",
  state: "open",
  version: 1,
  sourceVersion: 4,
  title: "Review native delivery",
  summary: "Check evidence",
  link: "#tasks?task=t",
  ownerName: "Alex",
  canDecide: true,
  canRoute: true,
  actions: ["resolve", "route", "snooze"],
  routePeople: [{ id: "v", name: "Sam", active: true, role: "admin" }],
  snoozedUntil: null,
  dueAt: null,
  reminderState: "pending",
};
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const click = async (label: string) =>
  act(async () => {
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === label,
    );
    expect(button).toBeTruthy();
    button!.click();
  });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  env.company = "c";
  env.foreground = true;
  env.epoch = 0;
  env.request.mockReset();
  env.push.mockReset();
  env.request.mockImplementation(async (path: string) =>
    path.includes("/attention/a")
      ? { item }
      : { items: [item], hasMore: false, cursor: "" },
  );
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  clearAllDrafts();
});
it("retains the exact reviewed route through transport failure and duplicate retry presses", async () => {
  let payload: any;
  let calls = 0;
  env.request.mockImplementation(
    async (path: string, method: string, body: any) => {
      if (method === "POST") {
        calls++;
        if (!payload) payload = body;
        if (calls === 1) throw new Error("Network interrupted");
        expect(body).toEqual(payload);
        return { resultVersion: 2 };
      }
      return path.endsWith("/attention/a")
        ? { item }
        : { items: [item], hasMore: false, cursor: "" };
    },
  );
  await act(async () => root.render(<AttentionInbox />));
  expect(container.textContent).toContain("Review native delivery");
  await click("Route Inbox item");
  const reason = container.querySelector(
    'input[aria-label="Routing reason"]',
  ) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(reason, "Please follow up");
    reason.dispatchEvent(new Event("input", { bubbles: true }));
    reason.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const choice = container.querySelector(
    'select[aria-label="Route to"]',
  ) as HTMLSelectElement;
  await act(async () => {
    choice.value = "v";
    choice.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("Review routing");
  await click("Confirm routing");
  expect(container.textContent).toContain("Network interrupted");
  await click("Retry same action");
  expect(calls).toBe(2);
  expect(payload).toMatchObject({
    action: "route",
    recipientId: "v",
    expectedVersion: 1,
  });
  expect(env.push).not.toHaveBeenCalled();
});
it("rejects a delayed old-company preview and refreshes current source removals", async () => {
  let oldResolve: (v: any) => void = () => {};
  env.request.mockImplementation((path: string) =>
    path.includes("/c/")
      ? new Promise((resolve) => (oldResolve = resolve))
      : Promise.resolve({
          items: [{ ...item, companyId: "d", title: "New native company" }],
          hasMore: false,
          cursor: "",
        }),
  );
  await act(async () => root.render(<AttentionInbox />));
  env.company = "d";
  await act(async () => root.render(<AttentionInbox />));
  await act(async () =>
    oldResolve({
      items: [{ ...item, title: "Old private native preview" }],
      hasMore: false,
      cursor: "",
    }),
  );
  expect(container.textContent).toContain("New native company");
  expect(container.textContent).not.toContain("Old private native preview");
  env.epoch++;
  env.request.mockResolvedValue({ items: [], hasMore: false, cursor: "" });
  await act(async () => root.render(<AttentionInbox />));
  expect(container.textContent).not.toContain("New native company");
});
it("opens company-qualified business navigation independently of Inbox resolution", async () => {
  await act(async () => root.render(<AttentionInbox />));
  await click("Open business decision");
  expect(env.push).toHaveBeenCalledWith({
    pathname: "/task/[id]",
    params: { id: "t", company: "c" },
  });
  expect(env.request.mock.calls.every((c) => c[1] !== "POST")).toBe(true);
});
it("keeps updates read separate and restores authored routing after dismissal", async () => {
  await act(async () => root.render(<AttentionInbox />));
  await click("Updates");
  expect(container.textContent).toContain(
    "Reading conversation updates does not resolve attention",
  );
  expect(container.textContent).not.toContain("Review native delivery");
  await click("Action required");
  await click("Route Inbox item");
  const reason = container.querySelector(
    'input[aria-label="Routing reason"]',
  ) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(reason, "Recoverable reason");
    reason.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Close");
  await click("Route Inbox item");
  expect(
    (
      container.querySelector(
        'input[aria-label="Routing reason"]',
      ) as HTMLInputElement
    ).value,
  ).toBe("Recoverable reason");
  expect(env.request.mock.calls.every((c) => c[1] !== "POST")).toBe(true);
});
it("guards duplicate confirmation while a reviewed request is pending", async () => {
  let resolve: (v: any) => void = () => {};
  env.request.mockImplementation(async (path: string, method: string) =>
    method === "POST"
      ? new Promise((r) => (resolve = r))
      : path.endsWith("/attention/a")
        ? { item }
        : { items: [item], hasMore: false, cursor: "" },
  );
  await act(async () => root.render(<AttentionInbox />));
  await click("Resolve Inbox item");
  const input = container.querySelector("input") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "Handled separately");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Review resolution");
  await act(async () => {
    const b = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Confirm resolution",
    )!;
    b.click();
    b.click();
  });
  expect(env.request.mock.calls.filter((c) => c[1] === "POST")).toHaveLength(1);
  await act(async () => resolve({ resultVersion: 2 }));
});
