import { expect, it } from "vitest";
import { readWorkPages } from "./readScopes";
it("withholds prior native lists immediately after a confirmed graph change", async () => {
  const { confirmedNativeWork } = await import("./readScopes");
  const me = { role: "manager", departmentId: "d", managerId: "" };
  const old = {
    readBasis: "subordinate-active",
    me,
    tasks: [{ id: "private" }],
    expenses: [{ id: "expense" }],
  };
  const bootstrap = {
    readBasis: "subordinate-removed",
    me,
    tasks: [],
    expenses: [],
  };
  expect(confirmedNativeWork(old, bootstrap)).toEqual(bootstrap);
  expect(
    confirmedNativeWork(old, { ...bootstrap, readBasis: old.readBasis }).tasks,
  ).toEqual(old.tasks);
});
it("combines bounded native pages without workspace evidence", async () => {
  const paths: string[] = [];
  const read = async <T>(path: string) => {
    paths.push(path);
    return (
      path.includes("cursor=next")
        ? { tasks: [{ id: "b" }], hasMore: false, cursor: "" }
        : { tasks: [{ id: "a" }], hasMore: true, cursor: "next" }
    ) as T;
  };
  expect(await readWorkPages(read, "c", "tasks")).toEqual([
    { id: "a" },
    { id: "b" },
  ]);
  expect(paths).toEqual([
    "/companies/c/tasks?limit=100",
    "/companies/c/tasks?limit=100&cursor=next",
  ]);
});
it("routes outbox business hints to scoped native refreshes", async () => {
  const { nativeEventScope } = await import("./readScopes");
  expect(nativeEventScope("work_linked")).toBe("tasks");
  expect(nativeEventScope("expense_linked")).toBe("finance");
  expect(nativeEventScope("message_created")).toBe("");
});
it("preserves all selected attachments across bounded detail pages", async () => {
  const { readNativeDetail } = await import("./readScopes");
  const read = async <T>(path: string) =>
    (path.includes("/attachments?")
      ? { attachments: [{ id: "last" }], hasMore: false, cursor: "" }
      : {
          task: { attachments: [{ id: "first" }] },
          evidence: { attachments: { hasMore: true, cursor: "tail" } },
        }) as T;
  const result = await readNativeDetail<{
    task: { attachments: { id: string }[] };
  }>(read, "/companies/c/tasks/t", "task");
  expect(result.task.attachments).toEqual([{ id: "first" }, { id: "last" }]);
});
