// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  NativeImpact,
  NativeSchedule,
  NativeProjects,
  NativeTemplates,
} from "./Execution";
import ProjectScreen from "./ProjectScreen";
import { clearAllDrafts } from "./conversationDrafts";
import { NativeApiError } from "./client";
import { clearAllBusinessAttempts } from "../../shared/business/attempts";
const s = vi.hoisted(() => ({ w: {} as any, request: vi.fn() }));
vi.mock("./client", () => ({
  client: { endpoint: "https://owned.test", generation: 1, request: s.request },
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
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("./Workspace", () => ({
  useWorkspace: () => s.w,
  Page: ({ children }: { children: ReactNode }) =>
    createElement("div", {}, children),
}));
vi.mock("./AttentionInbox", () => ({ default: () => null }));
vi.mock("@react-native-community/datetimepicker", () => ({
  default: () => null,
}));

vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  Sheet: ({ children, title }: any) =>
    createElement("section", { "aria-label": title }, children),
}));
vi.mock("react-native", () => ({
  StyleSheet: { create: (value: unknown) => value },
  Platform: { OS: "android" },
  FlatList: ({ data, renderItem }: any) =>
    createElement("div", {}, ...data.map((item: any) => renderItem({ item }))),
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  TextInput: ({ value, onChangeText, accessibilityLabel }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      onChange: (e: any) => onChangeText(e.target.value),
    }),
}));
let root: Root, c: HTMLDivElement;
const render = async (node: ReactNode) =>
  act(async () => {
    root.render(node);
    await new Promise((r) => setTimeout(r, 5));
  });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  clearAllBusinessAttempts();
  clearAllDrafts();
  c = document.createElement("div");
  document.body.append(c);
  root = createRoot(c);
  s.w = {
    company: "co",
    session: { user: { id: "actor" } },
    foreground: true,
    policyEpoch: 0,
    recordEpoch: 0,
    attentionEpoch: 0,
    work: {
      readBasis: "basis",
      me: { role: "founder" },
      people: [
        { id: "actor", name: "Human owner", role: "founder", active: true },
        {
          id: "reviewer",
          name: "Independent reviewer",
          role: "head",
          active: true,
        },
      ],
      departments: [],
      company: { timezone: "Asia/Kolkata" },
      tasks: [],
    },
    refresh: vi.fn().mockResolvedValue(undefined),
    setError: vi.fn(),
    error: "",
  };
  s.request.mockReset();
});
afterEach(async () => {
  await act(() => root.unmount());
  c.remove();
});
it("hides impact immediately on background and never uses old source after denied refresh", async () => {
  s.request.mockResolvedValue({
    nodes: [
      {
        id: "a",
        title: "Authorized source",
        code: "A",
        originalCommitment: { dueDate: "2026-10-10" },
        currentCommitment: { dueDate: "2026-10-11" },
      },
    ],
    edges: [],
    notice: "Only authorized linked work is shown.",
  });
  await render(createElement(NativeImpact, { id: "a" }));
  expect(c.textContent).toContain("Authorized source");
  s.w.foreground = false;
  await render(createElement(NativeImpact, { id: "a" }));
  expect(c.textContent).not.toContain("Authorized source");
  s.w.foreground = true;
  s.request.mockRejectedValue(Error("Unavailable"));
  await render(createElement(NativeImpact, { id: "a" }));
  expect(c.textContent).not.toContain("Authorized source");
});
it("opens projects from the scoped execution endpoint", async () => {
  s.request.mockResolvedValue({
    projects: [{ id: "p", name: "Visible project" }],
  });
  await render(createElement(NativeProjects));
  expect(s.request).toHaveBeenCalledWith("/companies/co/projects");
  expect(c.textContent).toContain("Visible project");
});
it("requires a concrete per-row reason before schedule preview", async () => {
  await render(
    createElement(NativeSchedule, {
      tasks: [
        {
          id: "a",
          title: "A",
          version: 1,
          status: "todo",
          dueDate: "2026-10-10",
          deadlineMode: "all_day",
          attachments: [],
        } as any,
      ],
    }),
  );
  expect(
    Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === "Preview schedule",
    )?.disabled,
  ).toBe(true);
  expect(s.request).not.toHaveBeenCalled();
});
const click = async (title: string) =>
  act(async () => {
    const b = Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === title,
    );
    expect(b, title).toBeDefined();
    b!.click();
    await new Promise((r) => setTimeout(r, 5));
  });
const fill = async (label: string, value: string) =>
  act(async () => {
    const e = c.querySelector<HTMLInputElement>(
      `input[aria-label="${label}"]`,
    )!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(e, value);
    e.dispatchEvent(new Event("input", { bubbles: true }));
  });
const task = {
  id: "a",
  title: "A",
  version: 1,
  status: "todo",
  dueDate: "2026-10-10",
  originalDueDate: "2026-10-09",
  deadlineMode: "all_day",
  attachments: [],
} as any;
const template = {
  id: "t",
  version: 3,
  name: "Delivery template",
  description: "Delivery",
  defaults: { checklist: ["Inspect delivery"] },
};
it("previews exact template version with human owner/reviewer choices and retries frozen apply after remount", async () => {
  let first = true;
  s.request.mockImplementation(
    async (path: string, method?: string, body?: any) => {
      if (path.endsWith("/apply")) {
        if (first) {
          first = false;
          throw Error("Lost ACK");
        }
        return { id: "created" };
      }
      if (path.endsWith("/preview"))
        return {
          fields: {
            title: "Reviewed delivery",
            ownerId: "actor",
            reviewerId: "reviewer",
            requiresApproval: true,
            dueDate: "2026-10-12",
          },
          templateVersion: 3,
          projectVersion: 0,
          unresolved: [],
        };
      if (path.endsWith("/task-templates/t")) return { template };
      if (path.includes("task-templates?")) return { templates: [template] };
      return { projects: [] };
    },
  );
  await render(createElement(NativeTemplates));
  await click("Delivery template");
  await click("Preview template");
  expect(c.textContent).toContain("Reviewed owner: Human owner");
  expect(c.textContent).toContain("Independent reviewer: Independent reviewer");
  expect(
    s.request.mock.calls.find((v) => String(v[0]).endsWith("/preview"))?.[2],
  ).toMatchObject({
    expectedTemplateVersion: 3,
    anchorDate: expect.any(String),
    fields: {},
  });
  await click("Create reviewed task");
  const firstBody = s.request.mock.calls.find((v) =>
    String(v[0]).endsWith("/apply"),
  )![2];
  await render(null);
  await render(createElement(NativeTemplates));
  await click("Retry same template application");
  const submitted = s.request.mock.calls.filter((v) =>
    String(v[0]).endsWith("/apply"),
  );
  expect(submitted).toHaveLength(2);
  expect(submitted[1][2]).toEqual(firstBody);
});
it("uses captured task/template versions for fresh unchecked checklist application", async () => {
  s.request.mockImplementation(async (path: string, method?: string) =>
    method
      ? { id: "a" }
      : path.endsWith("/t")
        ? { template }
        : { templates: [template] },
  );
  await render(createElement(NativeTemplates, { task }));
  await click("Delivery template");
  await click("Append fresh unchecked items");
  expect(s.request.mock.calls.find((v) => v[1] === "POST")).toEqual([
    "/companies/co/tasks/a/checklists/apply",
    "POST",
    expect.objectContaining({
      templateId: "t",
      version: 1,
      expectedTemplateVersion: 3,
      retryKey: expect.any(String),
    }),
  ]);
});
it("recovers persisted schedule and frozen confirmation after lost ACK and remount", async () => {
  const proposal = {
    id: "p",
    version: 1,
    method: "manual",
    expiresAt: "2026-10-11T12:00:00Z",
    expired: false,
    rows: [
      {
        taskId: "a",
        title: "A",
        original: { dueDate: "2026-10-09" },
        before: { dueDate: "2026-10-10" },
        current: { dueDate: "2026-10-10" },
        after: { dueDate: "2026-10-12" },
        reason: "Reviewed delay",
      },
    ],
    advisories: [],
    notice: "Only authorized work.",
  };
  let first = true;
  s.request.mockImplementation(async (path: string) => {
    if (path.endsWith("/apply")) {
      if (first) {
        first = false;
        throw Error("Lost ACK");
      }
      return { ids: ["a"] };
    }
    return { proposal };
  });
  await render(createElement(NativeSchedule, { tasks: [task] }));
  await fill("Reason: A", "Reviewed delay");
  await click("Preview schedule");
  expect(c.textContent).toContain("Original: 2026-10-09");
  expect(c.textContent).toContain("Proposed: 2026-10-12");
  await click("Confirm reviewed schedule");
  const body = s.request.mock.calls.find((v) =>
    String(v[0]).endsWith("/apply"),
  )![2];
  await render(null);
  await render(createElement(NativeSchedule, { tasks: [task] }));
  await click("Retry same schedule confirmation");
  expect(
    s.request.mock.calls.filter((v) => String(v[0]).endsWith("/apply"))[1][2],
  ).toEqual(body);
});
const project = {
  id: "deep",
  name: "Independently opened project",
  version: 7,
  taskOwnerPolicy: "actor",
};
const milestone = {
  id: "m",
  title: "Delivery criteria",
  version: 4,
  criteriaVersion: 2,
  state: "draft",
  criteria: [{ id: "criterion", text: "Delivery inspected" }],
  taskIds: ["a"],
  submittedTasks: [],
  assertions: [],
  basisCurrent: true,
  canSubmit: true,
  canEdit: false,
  canReview: false,
  canReopen: false,
  acceptances: [],
};
it("opens independent project detail beyond initial list and owner submits explicit current task basis", async () => {
  s.request.mockImplementation(async (path: string, method?: string) => {
    if (method) return { id: "m" };
    if (path.endsWith("/deep"))
      return {
        project,
        canEdit: true,
        summary: { total: 1, accepted: 1, label: "authorized tasks" },
      };
    if (path.endsWith("/milestones")) return { milestones: [milestone] };
    if (path.endsWith("/m")) return { milestone };
    if (path.endsWith("/tasks/a"))
      return { task: { ...task, status: "done", version: 6 } };
    throw Error("unexpected");
  });
  await render(createElement(ProjectScreen, { id: "deep" }));
  expect(s.request.mock.calls[0][0]).toBe("/companies/co/projects/deep");
  expect(c.textContent).toContain("Authorized tasks: 1/1 accepted");
  await click("Open milestone: Delivery criteria");
  await fill(
    "Criterion assertion: Delivery inspected",
    "Inspected accepted evidence",
  );
  await click("Inspect current submission basis");
  await click("Submit milestone for independent review");
  const post = s.request.mock.calls.find((v) => v[1] === "POST");
  expect(post?.[2]).toMatchObject({
    action: "submit",
    version: 4,
    criteriaVersion: 2,
    expectedProjectVersion: 7,
    tasks: [{ taskId: "a", version: 6 }],
    assertions: [
      { criterionId: "criterion", statement: "Inspected accepted evidence" },
    ],
  });
  expect(
    s.request.mock.calls.filter(
      (v) => v[1] && String(v[0]).includes("/tasks/"),
    ),
  ).toHaveLength(0);
});
it("independent reviewer accepts bound milestone without task or goal mutation", async () => {
  const review = {
    ...milestone,
    state: "in_review",
    canSubmit: false,
    canReview: true,
    submittedTasks: [{ taskId: "a", version: 6 }],
    assertions: [{ criterionId: "criterion", statement: "Inspected" }],
  };
  s.request.mockImplementation(async (path: string, method?: string) =>
    method
      ? { id: "m" }
      : path.endsWith("/deep")
        ? { project, summary: { total: 1, accepted: 1 }, canEdit: false }
        : path.endsWith("/milestones")
          ? { milestones: [review] }
          : { milestone: review },
  );
  await render(createElement(ProjectScreen, { id: "deep" }));
  await click("Open milestone: Delivery criteria");
  await click("Accept reviewed milestone");
  expect(s.request.mock.calls.find((v) => v[1] === "POST")?.[2]).toMatchObject({
    action: "approve",
    tasks: [{ taskId: "a", version: 6 }],
    version: 4,
    expectedProjectVersion: 7,
  });
  expect(
    s.request.mock.calls.filter(
      (v) => v[1] && !String(v[0]).endsWith("/transition"),
    ),
  ).toHaveLength(0);
});
it("hides previously reviewed milestone when the same membership basis loses source access", async () => {
  s.request.mockImplementation(async (path: string) =>
    path.endsWith("/deep")
      ? { project, summary: { total: 1, accepted: 1 } }
      : path.endsWith("/milestones")
        ? { milestones: [milestone] }
        : { milestone },
  );
  await render(createElement(ProjectScreen, { id: "deep" }));
  await click("Open milestone: Delivery criteria");
  expect(c.textContent).toContain("Delivery inspected");
  s.w.executionEpoch = 1;
  s.request.mockRejectedValue(
    new NativeApiError(404, "not_found", "Source unavailable"),
  );
  await render(createElement(ProjectScreen, { id: "deep" }));
  expect(c.textContent).not.toContain("Delivery inspected");
});
it("discards delayed company A source after switch to B", async () => {
  let release!: (v: any) => void;
  s.request.mockImplementation((path: string) =>
    path.includes("/co/")
      ? new Promise((r) => (release = r))
      : Promise.resolve({
          nodes: [
            {
              id: "b",
              title: "Company B current source",
              code: "B",
              originalCommitment: {},
              currentCommitment: {},
            },
          ],
          edges: [],
          notice: "Authorized B",
        }),
  );
  await render(createElement(NativeImpact, { id: "a" }));
  s.w.company = "other";
  await render(createElement(NativeImpact, { id: "a" }));
  expect(c.textContent).toContain("Company B current source");
  await act(async () =>
    release({
      nodes: [
        {
          id: "a",
          title: "Delayed private A",
          originalCommitment: {},
          currentCommitment: {},
        },
      ],
      edges: [],
    }),
  );
  expect(c.textContent).not.toContain("Delayed private A");
});
it("requires a fresh preview when persisted proposal has expired", async () => {
  s.request.mockResolvedValue({
    proposal: {
      id: "expired",
      version: 1,
      expiresAt: "past",
      expired: true,
      method: "manual",
      rows: [],
      advisories: [],
      notice: "Current scope",
    },
  });
  await render(createElement(NativeSchedule, { tasks: [task] }));
  await fill("Reason: A", "Review dates");
  await click("Preview schedule");
  expect(
    Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === "Confirm reviewed schedule",
    )?.disabled,
  ).toBe(true);
  await click("Edit and create a fresh preview");
  expect(c.textContent).toContain("Preview schedule");
});
it("accepted tasks are unavailable for schedule rows", async () => {
  await render(
    createElement(NativeSchedule, { tasks: [{ ...task, status: "done" }] }),
  );
  expect(c.querySelector('input[aria-label="Reason: A"]')).toBeNull();
  expect(
    Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === "Preview schedule",
    )?.disabled,
  ).toBe(true);
});
it("known successful checklist action retires retry before refresh failure", async () => {
  s.w.refresh.mockRejectedValue(Error("Refresh unavailable"));
  s.request.mockImplementation(async (path: string, method?: string) =>
    method
      ? { id: "a" }
      : path.endsWith("/t")
        ? { template }
        : { templates: [template] },
  );
  await render(createElement(NativeTemplates, { task }));
  await click("Delivery template");
  await click("Append fresh unchecked items");
  expect(c.textContent).toContain(
    "Saved. Refresh to inspect the current result.",
  );
  expect(c.textContent).not.toContain("Retry same template application");
});
it("blocks required unresolved template choices until humans select independent people", async () => {
  s.request.mockImplementation(async (path: string) =>
    path.endsWith("/preview")
      ? {
          fields: {
            title: "Unresolved delivery",
            ownerId: "",
            reviewerId: "",
            requiresApproval: true,
          },
          templateVersion: 3,
          projectVersion: 0,
          unresolved: ["owner", "reviewer"],
        }
      : path.endsWith("/t")
        ? { template }
        : path.includes("task-templates?")
          ? { templates: [template] }
          : { projects: [] },
  );
  await render(createElement(NativeTemplates));
  await click("Delivery template");
  await click("Preview template");
  expect(c.textContent).toContain("Required choice: reviewer");
  expect(
    Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === "Create reviewed task",
    )?.disabled,
  ).toBe(true);
  await click("Reviewed owner: Choose person");
  await click("Human owner · founder");
  await click("Independent reviewer: Choose person");
  await click("Independent reviewer · head");
  expect(
    Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === "Create reviewed task",
    )?.disabled,
  ).toBe(false);
});
it("project defaults use exact existing positive-version PATCH and no unsupported retry envelope", async () => {
  const full = {
    ...project,
    name: "Project",
    description: "",
    departmentId: "",
    ownerId: "actor",
    defaultTaskOwnerId: "",
    defaultReviewerId: "",
    defaultRequiresApproval: false,
    dueDate: "",
    color: "#F97316",
    status: "active",
  };
  s.request.mockImplementation(async (path: string, method?: string) =>
    method
      ? { id: "deep" }
      : path.endsWith("/deep")
        ? { project: full, canEdit: true, summary: { total: 0, accepted: 0 } }
        : { milestones: [] },
  );
  await render(createElement(ProjectScreen, { id: "deep" }));
  await click("Edit project task defaults");
  await click("Save reviewed defaults");
  const body = s.request.mock.calls.find((v) => v[1] === "PATCH")![2];
  expect(body.version).toBe(7);
  expect(body.retryKey).toBeUndefined();
  expect(body.companyId).toBeUndefined();
  expect(body.id).toBeUndefined();
});
it("keeps exact milestone decision retry reachable after committed workflow state advances", async () => {
  const review = {
    ...milestone,
    state: "in_review",
    canSubmit: false,
    canReview: true,
    submittedTasks: [{ taskId: "a", version: 6 }],
    assertions: [],
  };
  let current = review;
  s.request.mockImplementation(async (path: string, method?: string) => {
    if (method) {
      current = { ...review, state: "accepted", canReview: false };
      throw Error("Lost committed response");
    }
    return path.endsWith("/deep")
      ? { project, summary: { total: 1, accepted: 1 } }
      : path.endsWith("/milestones")
        ? { milestones: [current] }
        : { milestone: current };
  });
  await render(createElement(ProjectScreen, { id: "deep" }));
  await click("Open milestone: Delivery criteria");
  await click("Accept reviewed milestone");
  const body = s.request.mock.calls.find((v) => v[1] === "POST")![2];
  s.w.executionEpoch = 1;
  await render(createElement(ProjectScreen, { id: "deep" }));
  await click("Retry same milestone action");
  expect(s.request.mock.calls.filter((v) => v[1] === "POST")[1][2]).toEqual(
    body,
  );
});
it("management preserves and exposes every permitted typed task default while renaming", async () => {
  const existing = {
    ...template,
    kind: "task",
    scopeOwnerId: "actor",
    scopeDepartmentId: "",
    defaults: {
      title: "Delivery",
      description: "Review evidence",
      priority: "high",
      estimatedHours: 3.5,
      tags: ["delivery"],
      status: "backlog",
      ownerPolicy: "actor",
      relativeDueDays: 2,
      checklist: ["Inspect"],
    },
  };
  s.request.mockImplementation(async (path: string, method?: string) =>
    method
      ? { id: "t" }
      : path.endsWith("/t")
        ? { template: existing }
        : path.includes("task-templates?")
          ? { templates: [existing] }
          : { projects: [] },
  );
  await render(createElement(NativeTemplates));
  await click("Delivery template");
  await click("Manage task templates");
  await fill("Template name", "Renamed delivery");
  await click("Save template");
  expect(s.request.mock.calls.find((v) => v[1] === "PATCH")?.[2]).toMatchObject(
    {
      version: 3,
      name: "Renamed delivery",
      defaults: {
        title: "Delivery",
        description: "Review evidence",
        priority: "high",
        estimatedHours: 3.5,
        tags: ["delivery"],
        status: "backlog",
        relativeDueDays: 2,
      },
    },
  );
});
it("keeps the authored milestone input mounted and focused while same-source reauthorization hides fetched values and disables submission", async () => {
  let pause = false,
    release!: (v: any) => void;
  const detail = {
    project: { ...project, ownerId: "actor" },
    canEdit: true,
    summary: { total: 1, accepted: 0 },
  };
  s.request.mockImplementation(async (path: string) =>
    path.endsWith("/deep")
      ? pause
        ? new Promise((r) => (release = r))
        : detail
      : { milestones: [] },
  );
  s.w.work.tasks = [
    { id: "poll-task", projectId: "deep", title: "Current project task" },
  ];
  await render(createElement(ProjectScreen, { id: "deep" }));
  await click("New project milestone");
  await fill("Milestone title", "Preserved explicit title");
  await fill("Acceptance criteria, one per line", "Inspect signed evidence");
  await click("Select: Current project task");
  await click("Independent milestone reviewer: Choose person");
  await click("Independent reviewer · head");
  expect(
    [...c.querySelectorAll("button")].find(
      (b) => b.textContent === "Save milestone criteria",
    )?.disabled,
  ).toBe(false);
  const input = c.querySelector<HTMLInputElement>(
    'input[aria-label="Milestone title"]',
  )!;
  input.focus();
  pause = true;
  s.w.executionEpoch = 1;
  await render(createElement(ProjectScreen, { id: "deep" }));
  expect(c.querySelector('input[aria-label="Milestone title"]')).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(
    [...c.querySelectorAll("button")].find(
      (b) => b.textContent === "Save milestone criteria",
    )?.disabled,
  ).toBe(true);
  expect(c.textContent).not.toContain("Authorized tasks:");
  pause = false;
  await act(async () => {
    release(detail);
    await new Promise((r) => setTimeout(r, 10));
  });
  expect(
    c.querySelector<HTMLInputElement>('input[aria-label="Milestone title"]')
      ?.value,
  ).toBe("Preserved explicit title");
  expect(c.querySelector('input[aria-label="Milestone title"]')).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(
    [...c.querySelectorAll("button")].find(
      (b) => b.textContent === "Save milestone criteria",
    )?.disabled,
  ).toBe(false);
  expect(c.textContent).toContain(
    "Independent milestone reviewer: Independent reviewer",
  );
  expect(c.textContent).toContain("Selected: Current project task");
});
it("confirmed project denial purges preserved milestone modal and authored fields before access is restored", async () => {
  let denied = false;
  const detail = {
    project: { ...project, ownerId: "actor" },
    canEdit: true,
    summary: { total: 0, accepted: 0 },
  };
  s.request.mockImplementation(async (path: string) => {
    if (path.endsWith("/deep")) {
      if (denied) throw new NativeApiError(404, "not_found", "Unavailable");
      return detail;
    }
    return { milestones: [] };
  });
  await render(createElement(ProjectScreen, { id: "deep" }));
  await click("New project milestone");
  await fill("Milestone title", "Private denied title");
  denied = true;
  s.w.executionEpoch = 1;
  await render(createElement(ProjectScreen, { id: "deep" }));
  expect(c.textContent).not.toContain("Private denied title");
  denied = false;
  s.w.executionEpoch = 2;
  await render(createElement(ProjectScreen, { id: "deep" }));
  expect(c.querySelector('input[aria-label="Milestone title"]')).toBeNull();
  await click("New project milestone");
  expect(
    c.querySelector<HTMLInputElement>('input[aria-label="Milestone title"]')
      ?.value,
  ).toBe("");
});

it("publishes one atomic all-day and timed schedule commitment from the real deadline picker callback", async () => {
  s.request.mockResolvedValue({
    proposal: { id: "picker-proposal", rows: [], advisories: [] },
  });
  await render(createElement(NativeSchedule, { tasks: [task] }));
  await fill("Due date", "2026-10-22");
  expect(
    c.querySelector<HTMLInputElement>('input[aria-label="Due date"]')?.value,
  ).toBe("2026-10-22");
  await fill("Deadline time", "16:30");
  expect(
    c.querySelector<HTMLInputElement>('input[aria-label="Due date"]')?.value,
  ).toBe("2026-10-22");
  expect(
    c.querySelector<HTMLInputElement>('input[aria-label="Deadline time"]')
      ?.value,
  ).toBe("16:30");
  await fill("Reason: A", "Reviewed timed commitment");
  await click("Preview schedule");
  const submitted = s.request.mock.calls.find((v) =>
    v[0].endsWith("/preview"),
  )![2];
  expect(submitted.changes[0]).toMatchObject({
    dueDate: "2026-10-22",
    deadlineMode: "timed",
    dueAt: "2026-10-22T11:00:00.000Z",
    dueTimezone: "Asia/Kolkata",
  });
});

it("native template rename preserves an absent relative deadline separately from zero", async () => {
  const existing = {
    ...template,
    kind: "task",
    scopeOwnerId: "actor",
    scopeDepartmentId: "",
    defaults: { title: "No deadline", ownerPolicy: "actor", checklist: [] },
  };
  s.request.mockImplementation(async (path: string, method?: string) =>
    method
      ? { id: "t" }
      : path.endsWith("/t")
        ? { template: existing }
        : path.includes("task-templates?")
          ? { templates: [existing] }
          : { projects: [] },
  );
  await render(createElement(NativeTemplates));
  await click("Delivery template");
  await click("Manage task templates");
  await fill("Template name", "Renamed without deadline");
  await click("Save template");
  expect(
    s.request.mock.calls.find((v) => v[1] === "PATCH")![2].defaults,
  ).not.toHaveProperty("relativeDueDays");
});
it("retains and deduplicates all graph pages including later edges", async () => {
  const node = (id: string) => ({
    id,
    title: id.toUpperCase(),
    code: id,
    originalCommitment: { dueDate: "" },
    currentCommitment: { dueDate: "" },
  });
  s.request.mockImplementation(async (path: string) =>
    path.includes("cursor=")
      ? {
          nodes: [node("b"), node("c")],
          edges: [
            { from: "a", to: "b" },
            { from: "b", to: "c" },
          ],
          paths: [
            ["a", "b"],
            ["b", "c"],
          ],
          nextCursor: "",
        }
      : {
          nodes: [node("a")],
          edges: [{ from: "a", to: "b" }],
          paths: [["a", "b"]],
          nextCursor: "next",
        },
  );
  await render(createElement(NativeImpact, { id: "a" }));
  expect(c.textContent).toContain("B → C");
  expect(
    [...c.querySelectorAll("span")].filter((e) => e.textContent === "A → B"),
  ).toHaveLength(1);
});
it("keeps an authored milestone reviewer search mounted during source checks without clearing the selected person", async () => {
  let pause = false,
    release!: (v: any) => void;
  const detail = {
    project: { ...project, ownerId: "actor" },
    canEdit: true,
    summary: { total: 0, accepted: 0 },
  };
  s.request.mockImplementation(async (path: string) =>
    path.endsWith("/deep")
      ? pause
        ? new Promise((r) => (release = r))
        : detail
      : { milestones: [] },
  );
  await render(createElement(ProjectScreen, { id: "deep" }));
  await click("New project milestone");
  await click("Independent milestone reviewer: Choose person");
  await click("Independent reviewer · head");
  await click("Independent milestone reviewer: Independent reviewer");
  await fill("Find independent milestone reviewer", "Inde");
  const input = c.querySelector(
    'input[aria-label="Find independent milestone reviewer"]',
  )!;
  (input as HTMLInputElement).focus();
  pause = true;
  s.w.executionEpoch = 1;
  await render(createElement(ProjectScreen, { id: "deep" }));
  expect(
    c.querySelector('input[aria-label="Find independent milestone reviewer"]'),
  ).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(c.textContent).not.toContain("Independent reviewer · head");
  pause = false;
  await act(async () => {
    release(detail);
    await new Promise((r) => setTimeout(r, 10));
  });
  expect((input as HTMLInputElement).value).toBe("Inde");
  expect(c.textContent).toContain(
    "Independent milestone reviewer: Independent reviewer",
  );
});
