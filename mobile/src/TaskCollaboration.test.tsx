// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TaskCollaboration from "./TaskCollaboration";
import { taskCollaborationRights } from "./taskCollaboration";
import { clearAllDrafts } from "./conversationDrafts";
const state = vi.hoisted(() => ({ w: {} as any, request: vi.fn() }));
vi.mock("./client", () => ({
  client: { request: state.request, endpoint: "https://test", generation: 0 },
}));
vi.mock("./Workspace", () => ({ useWorkspace: () => state.w }));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) =>
    createElement("div", {}, children),
  Text: ({ children, accessibilityRole }: any) =>
    createElement("span", { role: accessibilityRole }, children),
  TextInput: ({ value, onChangeText, accessibilityLabel }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      onChange: (e: any) => onChangeText(e.target.value),
    }),
}));
let root: Root, container: HTMLDivElement;
const person = (id: string, role: string, extra = {}) => ({
  id,
  name: id + " name",
  role,
  departmentId: "d",
  managerId: "",
  active: true,
  ...extra,
});
const task = {
  id: "t1",
  ownerId: "owner",
  reviewerId: "reviewer",
  createdBy: "owner",
  departmentId: "d",
  collaborators: ["helper"],
  comments: [
    { id: "c1", body: "Existing note", userId: "owner", createdAt: "" },
  ],
};
function as(me: ReturnType<typeof person>) {
  state.w = {
    company: "company",
    session: { user: { id: me.id } },
    work: {
      me,
      company: { timezone: "Asia/Kolkata" },
      people: [
        person("owner", "member"),
        person("reviewer", "head", { departmentId: "other" }),
        person("helper", "member"),
        person("viewer", "viewer"),
      ],
    },
  };
}
const button = (title: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === title,
  );
const click = async (title: string) => act(async () => button(title)!.click());
const fill = async (label: string, value: string) =>
  act(async () => {
    const input = container.querySelector(`input[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const onChanged = vi.fn(async () => {});
const render = () =>
  act(async () =>
    root.render(createElement(TaskCollaboration, { task, onChanged })),
  );
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-10T20:00:00Z"));
  state.request.mockReset();
  state.request.mockResolvedValue({ id: "x" });
  onChanged.mockClear();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  clearAllDrafts();
});
it("mirrors web comment, nudge and time rights including independent owners", () => {
  const data = (me: ReturnType<typeof person>) => ({
    me,
    people: [person("owner", "member"), person("helper", "member")],
  });
  expect(taskCollaborationRights(data(person("owner", "member")), task)).toEqual(
    { comment: true, nudge: false, logTime: true },
  );
  expect(
    taskCollaborationRights(
      data(person("reviewer", "head", { departmentId: "other" })),
      task,
    ),
  ).toEqual({ comment: true, nudge: true, logTime: true });
  expect(
    taskCollaborationRights(data(person("helper", "member")), task),
  ).toEqual({ comment: true, nudge: false, logTime: true });
  expect(
    taskCollaborationRights(data(person("stranger", "member")), task),
  ).toEqual({ comment: true, nudge: false, logTime: false });
  expect(
    taskCollaborationRights(data(person("viewer", "viewer")), task),
  ).toEqual({ comment: false, nudge: false, logTime: false });
  expect(
    taskCollaborationRights(data(person("boss", "admin")), task),
  ).toEqual({ comment: true, nudge: true, logTime: true });
});
it("posts a trimmed comment with the web body, guards double submit and refreshes", async () => {
  as(person("owner", "member"));
  let finish!: (v: unknown) => void;
  state.request.mockImplementation(
    () => new Promise((r) => (finish = r)),
  );
  await render();
  expect(container.textContent).toContain("Existing note");
  expect(button("Nudge")).toBeUndefined();
  await fill("Write a comment", "  Ready for review  ");
  await act(async () => {
    button("Post comment")!.click();
    button("Post comment")!.click();
  });
  expect(state.request).toHaveBeenCalledTimes(1);
  expect(state.request).toHaveBeenCalledWith(
    "/companies/company/tasks/t1/comments",
    "POST",
    { body: "Ready for review" },
  );
  await act(async () => finish({ id: "c2" }));
  expect(onChanged).toHaveBeenCalledOnce();
  expect(
    (container.querySelector('input[aria-label="Write a comment"]') as any)
      .value,
  ).toBe("");
});
it("nudges a different owner with the web default message", async () => {
  as(person("reviewer", "head", { departmentId: "other" }));
  await render();
  await click("Nudge");
  expect(state.request).toHaveBeenCalledWith(
    "/companies/company/tasks/t1/nudge",
    "POST",
    { message: "Please share a progress update on this task." },
  );
  expect(container.textContent).toContain("Update requested");
});
it("logs time with company-date default, validates and surfaces server errors", async () => {
  as(person("helper", "member"));
  await render();
  await click("Log time");
  expect(state.request).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Describe the work completed.");
  await fill("Hours", "1.5");
  await fill("Work completed", "Drafted the handover");
  state.request.mockRejectedValueOnce(Error("Task changed. Reload it."));
  await click("Log time");
  expect(state.request).toHaveBeenCalledWith(
    "/companies/company/tasks/t1/time",
    "POST",
    { hours: 1.5, date: "2026-10-11", note: "Drafted the handover" },
  );
  expect(container.textContent).toContain("Task changed. Reload it.");
  expect(
    (container.querySelector('input[aria-label="Work completed"]') as any)
      .value,
  ).toBe("Drafted the handover");
  expect(onChanged).not.toHaveBeenCalled();
});
it("offers viewers read-only comments", async () => {
  as(person("viewer", "viewer"));
  await render();
  expect(container.textContent).toContain("Existing note");
  expect(container.querySelector("button")).toBeNull();
  expect(container.querySelector("input")).toBeNull();
});
