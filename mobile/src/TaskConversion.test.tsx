// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import Publication from "./Publication";
import { clearAllDrafts } from "./conversationDrafts";
const env = vi.hoisted(() => ({ request: vi.fn(), close: vi.fn() }));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("./client", () => ({
  client: { endpoint: "https://test", generation: 1, request: env.request },
}));
vi.mock("./Workspace", () => ({
  styles: {},
  useWorkspace: () => ({
    company: "c",
    session: { user: { id: "u" } },
    refresh: async () => {},
    work: {
      me: { departmentId: "d" },
      people: [
        { id: "u", name: "Una", departmentId: "d", active: true },
        { id: "v", name: "Vik", departmentId: "d", active: true },
      ],
      departments: [],
      company: { timezone: "Asia/Kolkata" },
      expenseCategories: [],
    },
  }),
}));
vi.mock("./PersonPicker", () => ({ default: () => null }));
vi.mock("./DeadlinePicker", () => ({
  default: ({ onChange, disabled }: any) =>
    createElement(
      "button",
      {
        disabled,
        onClick: () => onChange({ date: "2026-10-20", time: "" }),
      },
      "Pick date",
    ),
}));
vi.mock("./ConnectUI", () => ({ Action: () => null }));
vi.mock("react-native", () => ({
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children, accessibilityRole }: any) =>
    createElement("span", { role: accessibilityRole }, children),
  Button: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  TextInput: ({ value, onChangeText, accessibilityLabel, editable }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      disabled: editable === false,
      onChange: (e: any) => onChangeText(e.target.value),
    }),
}));
afterEach(() => {
  clearAllDrafts();
  env.request.mockReset();
  env.close.mockReset();
});
const ROOT = "/companies/c/conversations/a";
function harness(
  actions: { id: string; title: string; sourceRevision: number }[] = [],
) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const commits: { path: string; body: any }[] = [];
  const previews: any[] = [];
  const responses = {
    preview: async (): Promise<unknown> => ({
      audienceUserIds: ["u", "v"],
      notice: "Creates an independent work record.",
    }),
    commit: async (): Promise<unknown> => ({ task: { id: "t" } }),
  };
  env.request.mockImplementation(async (path: string, method, body) => {
    if (path.includes("/work-actions?")) {
      expect(method ?? "GET").toBe("GET");
      return { actions };
    }
    if (path.endsWith("/preview")) {
      previews.push(body);
      return responses.preview();
    }
    commits.push({ path, body });
    return responses.commit();
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  const mount = () =>
    act(async () =>
      root.render(
        <Publication
          only="task"
          source={{ id: "m1", body: "Selected source", revision: 1 } as any}
          conversation={{ id: "a", version: 3 } as any}
          onClose={env.close}
        />,
      ),
    );
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find(
      (b) => b.textContent === label,
    );
  const click = async (label: string) =>
    act(async () => {
      const b = button(label);
      expect(b, label).toBeTruthy();
      expect(b!.disabled, label + " disabled").toBe(false);
      b!.click();
    });
  const type = async (label: string, value: string) =>
    act(async () => {
      const input = container.querySelector(
        `input[aria-label="${label}"]`,
      ) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  return {
    container,
    root,
    mount,
    button,
    click,
    type,
    commits,
    previews,
    responses,
  };
}
it("discloses the task title and destination audience and sends nothing until confirmed", async () => {
  const h = harness();
  try {
    await h.mount();
    expect(h.button("task")).toBeUndefined();
    expect(h.button("request")).toBeUndefined();
    expect(h.button("Preview task audience")!.disabled).toBe(true);
    await h.click("Pick date");
    await h.click("Preview task audience");
    expect(h.previews).toHaveLength(1);
    expect(h.previews[0].task.title).toBe("Selected source");
    const text = h.container.textContent!;
    expect(text).toContain("Task title: Selected source");
    expect(text).toContain("Visible to: Una, Vik");
    expect(text).toContain("Owner: Una");
    expect(text).toContain("Due: 2026-10-20");
    expect(h.button("Create task")!.disabled).toBe(true);
    expect(h.commits).toHaveLength(0);
    await h.click("I confirm this task title and audience");
    expect(h.commits).toHaveLength(0);
    await h.click("Create task");
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0].path).toBe(ROOT + "/task-conversions");
    expect(h.commits[0].body).toMatchObject({
      anchorMessageId: "m1",
      actionId: "primary",
      expectedPolicyVersion: 3,
      sources: [{ messageId: "m1", revision: 1 }],
      task: { title: "Selected source", ownerId: "u", dueDate: "2026-10-20" },
    });
    expect(h.commits[0].body.retryKey).toBe(h.previews[0].retryKey);
    expect(env.close).toHaveBeenCalledOnce();
  } finally {
    await act(async () => h.root.unmount());
  }
});
it("withdraws the disclosure when the title changes after preview", async () => {
  const h = harness();
  try {
    await h.mount();
    await h.click("Pick date");
    await h.click("Preview task audience");
    await h.click("I confirm this task title and audience");
    await h.type("Task title", "Different title");
    expect(h.container.textContent).not.toContain("Visible to:");
    expect(h.button("Create task")!.disabled).toBe(true);
    expect(h.button("I confirm this task title and audience")).toBeUndefined();
    await h.click("Preview task audience");
    expect(h.container.textContent).toContain("Task title: Different title");
    expect(h.commits).toHaveLength(0);
  } finally {
    await act(async () => h.root.unmount());
  }
});
it("shows a failed commit and retries the same frozen key, body and target", async () => {
  const h = harness();
  let fail = true;
  h.responses.commit = async () => {
    if (fail) {
      fail = false;
      throw Error("Network lost");
    }
    return { task: { id: "t" } };
  };
  try {
    await h.mount();
    await h.click("Pick date");
    await h.click("Preview task audience");
    await h.click("I confirm this task title and audience");
    await h.click("Create task");
    expect(h.container.querySelector('[role="alert"]')!.textContent).toBe(
      "Network lost",
    );
    expect(env.close).not.toHaveBeenCalled();
    expect(
      (h.container.querySelector(
        'input[aria-label="Task title"]',
      ) as HTMLInputElement).disabled,
    ).toBe(true);
    await h.click("Retry the same publication");
    expect(h.commits).toHaveLength(2);
    expect(h.commits[1]).toEqual(h.commits[0]);
    expect(env.close).toHaveBeenCalledOnce();
  } finally {
    await act(async () => h.root.unmount());
  }
});
it("surfaces a denied preview and never enables creation", async () => {
  const h = harness();
  h.responses.preview = async () => {
    throw Error("You cannot publish work from this conversation.");
  };
  try {
    await h.mount();
    await h.click("Pick date");
    await h.click("Preview task audience");
    expect(h.container.querySelector('[role="alert"]')!.textContent).toBe(
      "You cannot publish work from this conversation.",
    );
    expect(h.button("Create task")!.disabled).toBe(true);
    expect(h.container.textContent).not.toContain("Visible to:");
    expect(h.commits).toHaveLength(0);
  } finally {
    await act(async () => h.root.unmount());
  }
});
it("offers only current server-declared instruction actions for this revision", async () => {
  const h = harness([
    { id: "a1", title: "Prepare site survey", sourceRevision: 1 },
    { id: "old", title: "Stale split", sourceRevision: 0 },
  ]);
  try {
    await h.mount();
    expect(h.button("Prepare site survey")).toBeTruthy();
    expect(h.button("Stale split")).toBeUndefined();
    await h.click("Prepare site survey");
    expect(
      (h.container.querySelector(
        'input[aria-label="Task title"]',
      ) as HTMLInputElement).value,
    ).toBe("Prepare site survey");
    await h.click("Pick date");
    await h.click("Preview task audience");
    expect(h.container.textContent).toContain("Task title: Prepare site survey");
    await h.click("I confirm this task title and audience");
    await h.click("Create task");
    expect(h.commits[0].body.actionId).toBe("a1");
  } finally {
    await act(async () => h.root.unmount());
  }
});
it("discloses the existing task title and offers to link instead of creating when the server reports an existing task", async () => {
  const h = harness();
  h.responses.preview = async () => ({
    outcome: "existing",
    existingTaskId: "t-old",
    existingTaskTitle: "Already tracked survey",
    audienceUserIds: ["v"],
    notice: "This instruction action already has work.",
  });
  try {
    await h.mount();
    await h.click("Pick date");
    await h.click("Preview task audience");
    const text = h.container.textContent!;
    expect(text).toContain("Task title: Already tracked survey");
    expect(text).not.toContain("Task title: Selected source");
    expect(text).toContain("No new task will be created");
    expect(text).toContain("Visible to: Vik");
    expect(h.button("I confirm this task title and audience")).toBeUndefined();
    expect(h.button("Create task")).toBeUndefined();
    expect(h.button("Link to existing task")!.disabled).toBe(true);
    await h.click("I confirm this existing task and its audience");
    await h.click("Link to existing task");
    expect(h.commits).toHaveLength(1);
    expect(env.close).toHaveBeenCalledOnce();
  } finally {
    await act(async () => h.root.unmount());
  }
});
it("requires a fresh confirmation for every new preview result", async () => {
  const h = harness();
  let audience = ["u"];
  h.responses.preview = async () => ({
    outcome: "created",
    audienceUserIds: audience,
    notice: "Creates an independent work record.",
  });
  try {
    await h.mount();
    await h.click("Pick date");
    await h.click("Preview task audience");
    await h.click("I confirm this task title and audience");
    expect(h.button("Create task")!.disabled).toBe(false);
    audience = ["u", "v"];
    await h.click("Preview task audience");
    expect(h.container.textContent).toContain("Visible to: Una, Vik");
    expect(h.button("Create task")!.disabled).toBe(true);
    expect(h.button("I confirm this task title and audience")).toBeTruthy();
    expect(h.commits).toHaveLength(0);
  } finally {
    await act(async () => h.root.unmount());
  }
});
