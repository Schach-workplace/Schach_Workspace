import { clearAllBusinessAttempts } from "../../shared/business/attempts";
// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WorkScreen from "./WorkScreen";
import TaskDetailScreen from "./TaskDetailScreen";
import { clearAllDrafts } from "./conversationDrafts";
vi.mock("./Execution", () => ({
  NativeTemplates: () => null,
  NativeProjectChoice: () => null,
  NativeImpact: () => null,
  NativeSchedule: () => null,
}));
vi.mock("./TaskCsv", () => ({
  default: ({
    tasks,
    onClose,
  }: {
    tasks: { title: string }[];
    onClose: () => void;
  }) =>
    createElement(
      "section",
      { "aria-label": "Tasks CSV" },
      `CSV for ${tasks.map((t) => t.title).join("|")}`,
      createElement("button", { onClick: onClose }, "Close CSV"),
    ),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-router", () => ({ router: { push: vi.fn(), back: vi.fn() } }));
vi.mock("@react-native-community/datetimepicker", () => ({
  default: () => null,
}));
const state = vi.hoisted(() => ({ w: {} as any, request: vi.fn() }));
vi.mock("./client", () => ({ client: { request: state.request } }));
vi.mock("./CaptureControl", () => ({ default: () => null }));
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
  ScrollView: ({ children }: any) => createElement("div", {}, children),
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
  FlatList: ({
    data,
    renderItem,
    refreshControl,
    ListHeaderComponent,
    ListEmptyComponent,
  }: any) =>
    createElement(
      "div",
      {},
      refreshControl,
      ListHeaderComponent,
      !data.length && ListEmptyComponent,
      ...data.map((item: any, index: number) => renderItem({ item, index })),
    ),
  RefreshControl: ({ onRefresh, refreshing }: any) =>
    createElement(
      "button",
      { onClick: onRefresh, "data-refreshing": String(refreshing) },
      "Pull to refresh",
    ),
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
      .find(
        (b) =>
          b.textContent === title || b.getAttribute("aria-label") === title,
      )!
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
    foreground: true,
    policyEpoch: 0,
    session: { user: { id: "me" } },
    setError: vi.fn(),
    refresh: vi.fn(async () => {}),
    work: {
      me: { id: "me", role: "member", departmentId: "d" },
      company: { id: "company", timezone: "Asia/Kolkata" },
      people: [
        { id: "me", name: "Current member", role: "member", active: true },
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
  clearAllDrafts();
  clearAllBusinessAttempts();
});
it("keeps creation out of the list and supports search/status filters", async () => {
  await act(async () => root.render(createElement(WorkScreen)));
  expect(container.querySelector('input[aria-label="Task title"]')).toBeNull();
  await click("Open");
  expect(container.textContent).not.toContain("Finished work");
  await fill("Search work", "unrelated");
  expect(container.textContent).not.toContain("Prepare handover");
});
it("opens Tasks CSV with the currently shown tasks for every role", async () => {
  state.w.work.me.role = "viewer";
  await act(async () => root.render(createElement(WorkScreen)));
  expect(container.textContent).not.toContain("New task");
  await click("Open");
  await click("Work tools");
  await click("Tasks CSV");
  expect(
    container.querySelector('section[aria-label="Tasks CSV"]')!.textContent,
  ).toContain("CSV for Prepare handover");
  expect(container.textContent).not.toContain("Finished work");
  await click("Close CSV");
  expect(container.querySelector('section[aria-label="Tasks CSV"]')).toBeNull();
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
  expect(container.textContent).toContain(
    "Retry this same submission when connected.",
  );
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
  await act(async () =>
    root.render(createElement(TaskDetailScreen, { id: "open" })),
  );
  await click("Submit for review / complete");
  expect(state.request).toHaveBeenCalledTimes(2);
  expect(state.request.mock.calls[0][0]).toContain("/tasks/");
  expect(state.request.mock.calls[0][1]).toBeUndefined();
  expect(state.w.refresh).toHaveBeenCalled();
  expect(container.textContent).toContain("Task changed or access changed");
});
it("keeps an already submitted A write separate from B after a fast route jump", async () => {
  let finish!: (v: unknown) => void;
  const taskA = state.w.work.tasks[0];
  const taskB = { ...taskA, id: "second", title: "Independent B work" };
  state.request.mockImplementation(async (path: string, method: string) => {
    if (method === "PATCH")
      return new Promise((r) => {
        finish = r;
      });
    return { task: path.endsWith("/second") ? taskB : taskA };
  });
  await act(async () =>
    root.render(
      createElement(TaskDetailScreen, { key: "company:me:A", id: "open" }),
    ),
  );
  await click("Submit for review / complete");
  expect(finish).toBeTypeOf("function");
  await act(async () =>
    root.render(
      createElement(TaskDetailScreen, { key: "company:me:B", id: "second" }),
    ),
  );
  const before = state.request.mock.calls.length;
  await act(async () => finish({ ok: true }));
  expect(
    state.request.mock.calls.find((call) => call[1] === "PATCH")?.[0],
  ).toBe("/companies/company/tasks/open");
  expect(state.w.refresh).not.toHaveBeenCalled();
  expect(state.request).toHaveBeenCalledTimes(before);
  expect(container.textContent).toContain("Independent B work");
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
  clearAllDrafts();
  clearAllBusinessAttempts();
  state.w = { ...state.w, policyEpoch: state.w.policyEpoch + 1 };
  await act(async () => root.render(createElement(WorkScreen)));
  expect(container.querySelector('input[aria-label="Task title"]')).toBeNull();
});

it("restores authored input after the OS picker remounts the route, without a cached task body", async () => {
  await act(async () => root.render(createElement(WorkScreen)));
  await click("New task");
  await fill("Task title", "Camera return input");
  await fill("Deadline time", "16:00");
  await act(async () => root.render(null));
  state.w = { ...state.w, work: null, foreground: false };
  await act(async () => root.render(createElement(WorkScreen)));
  state.w = {
    ...state.w,
    foreground: true,
    work: {
      me: { role: "member", id: "me" },
      company: { timezone: "Asia/Kolkata" },
      tasks: [],
      people: [],
    },
  };
  await act(async () => root.render(createElement(WorkScreen)));
  await click("New task");
  expect(
    (
      container.querySelector(
        'input[aria-label="Task title"]',
      ) as HTMLInputElement
    ).value,
  ).toBe("Camera return input");
  expect(
    (
      container.querySelector(
        'input[aria-label="Deadline time"]',
      ) as HTMLInputElement
    ).value,
  ).toBe("16:00");
  expect(container.textContent).not.toContain("Prepare handover");
});
it("routes to a task outside the loaded list and inspects all bounded evidence pages", async () => {
  state.w.work.tasks = [];
  state.request.mockImplementation(async (path: string) =>
    path.includes("/attachments?")
      ? {
          attachments: [{ id: "more", fileName: "Later evidence.pdf" }],
          hasMore: false,
          cursor: "",
        }
      : {
          task: {
            id: "target",
            title: "Outside list",
            status: "todo",
            version: 1,
            attachments: [{ id: "first", fileName: "First evidence.pdf" }],
            description: "",
            ownerId: "other",
            requiresApproval: false,
          },
          evidence: { attachments: { hasMore: true, cursor: "next" } },
        },
  );
  await act(async () => root.render(<TaskDetailScreen id="target" />));
  expect(container.textContent).toContain("Outside list");
  expect(container.textContent).toContain(
    "Inspect evidence: Later evidence.pdf",
  );
  expect(state.request.mock.calls[1][0]).toContain(
    "/tasks/target/attachments?limit=100&cursor=next",
  );
});

it("retires confirmed create input before reopening a new task", async () => {
  await act(async () => root.render(<WorkScreen />));
  await click("New task");
  await fill("Task title", "Completed attempt");
  await click("Create task");
  await click("New task");
  expect(
    (
      container.querySelector(
        'input[aria-label="Task title"]',
      ) as HTMLInputElement
    ).value,
  ).toBe("");
});

it.each([
  { name: "default all-day", shortcut: false, timed: false, steps: 3 },
  { name: "tomorrow all-day", shortcut: true, timed: false, steps: 4 },
  { name: "tomorrow timed", shortcut: true, timed: true, steps: 5 },
])("records controlled native create interaction: $name", async (scenario) => {
  let steps = 0;
  const step = async (action: () => Promise<unknown>) => {
    steps++;
    await action();
  };
  await act(async () => root.render(<WorkScreen />));
  await step(() => click("New task"));
  await step(() => fill("Task title", "Controlled " + scenario.name));
  if (scenario.shortcut) await step(() => click("Tomorrow"));
  if (scenario.timed) await step(() => fill("Deadline time", "16:00"));
  await step(() => click("Create task"));
  const creates = state.request.mock.calls.filter(
    (c) => c[0] === "/companies/company/tasks" && c[1] === "POST",
  );
  const completed =
    creates.length === 1 &&
    container.querySelector('input[aria-label="Task title"]') === null;
  expect(completed).toBe(true);
  expect(steps).toBe(scenario.steps);
  console.info(
    "CONTROLLED_TASK_CREATE_JSON " +
      JSON.stringify({
        platform: "native-component",
        scenario: scenario.name,
        attempted: 1,
        completed: completed ? 1 : 0,
        steps,
        measurement:
          "Happy-dom controlled interaction, field edit counts one action; not physical usability",
      }),
  );
});

it("does not retire a newer Work form when an older unmounted create confirms", async () => {
  let release: (v: any) => void = () => {};
  state.request.mockImplementation(() => new Promise((r) => (release = r)));
  await act(async () => root.render(<WorkScreen />));
  await click("New task");
  await fill("Task title", "Older submitted task");
  await click("Create task");
  await act(async () => root.render(null));
  await act(async () => root.render(<WorkScreen />));
  await fill("Task title", "New authored task");
  await act(async () => release({ id: "confirmed-old" }));
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Task title"]')
      ?.value,
  ).toBe("New authored task");
});

it("retries a lost create response with the same frozen key after dismissal and remount", async () => {
  state.request.mockRejectedValueOnce(new Error("Lost response"));
  await act(async () => root.render(<WorkScreen />));
  await click("New task");
  await fill("Task title", "Canonical mobile task");
  await click("Create task");
  const submitted = state.request.mock.calls[0][2];
  expect(submitted.retryKey).toEqual(expect.any(String));
  await click("Close");
  await act(async () => root.render(null));
  await act(async () => root.render(<WorkScreen />));
  await click("New task");
  await click("Retry same submission");
  expect(state.request.mock.calls[1][2]).toEqual(submitted);
});
it("clears only the current create-owned global recovery error", async () => {
  state.request.mockRejectedValueOnce(Error("transport"));
  await act(() => root.render(<WorkScreen />));
  await click("New task");
  await fill("Task title", "Recover once");
  await click("Create task");
  expect(container.textContent).not.toContain("transport");
  await click("Retry same submission");
  const update = state.w.setError.mock.calls.at(-1)?.[0];
  expect(typeof update).toBe("function");
  expect(
    update("The result is unknown. Retry this same submission when connected."),
  ).toBe("");
  expect(update("Newer unrelated error")).toBe("Newer unrelated error");
});

it("pulls the task list to refresh through the workspace task reload", async () => {
  await act(async () => root.render(<WorkScreen />));
  await click("Pull to refresh");
  expect(state.w.refresh).toHaveBeenCalledWith("tasks");
  const pull = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === "Pull to refresh",
  )!;
  expect(pull.dataset.refreshing).toBe("false");
});
it("opens the read-only deadline agenda for the current company", async () => {
  const { router } = await import("expo-router");
  await act(async () => root.render(<WorkScreen />));
  await click("Work tools");
  await click("Deadline agenda");
  expect(router.push).toHaveBeenCalledWith({
    pathname: "/calendar",
    params: { company: "company" },
  });
});

it("keeps task content and filters in the virtualized scroll, with tools behind an explicit action", async () => {
  await act(async () => root.render(createElement(WorkScreen)));
  expect(container.textContent).toContain("2 matching authorized tasks");
  expect(container.textContent).not.toContain("Planning authorized work");
  await click("Work tools");
  expect(container.textContent).toContain("Planning authorized work");
  await click("Close");
  const open = container.querySelector(
    '[aria-label="Open: Prepare handover"]',
  ) as HTMLButtonElement;
  expect(open).toBeTruthy();
  await act(async () => open.click());
  const { router } = await import("expo-router");
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: "/task/[id]",
    params: { id: "open", company: "company" },
  });
});
it("explains Focus from recorded facts without granting a review or exposing completed work", async () => {
  await act(async () => root.render(<WorkScreen />));
  await click("Focus");
  expect(container.textContent).toContain("Your open work");
  expect(container.textContent).toContain("not employee ratings");
  expect(container.textContent).not.toContain("Finished work");
});
