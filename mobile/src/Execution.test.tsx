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
vi.mock("./DeadlinePicker", () => ({ default: () => null }));

vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  Sheet: ({ children, title }: any) =>
    createElement("section", { "aria-label": title }, children),
}));
vi.mock("react-native", () => ({
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
