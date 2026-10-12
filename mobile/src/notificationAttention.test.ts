import { expect, it } from "vitest";
import {
  AuthorizedNotificationTarget,
  type AttentionTarget,
  type NotificationDestination,
} from "./notificationTarget";
const session = async () => ({
  user: { id: "u" },
  companies: [{ id: "c" }, { id: "d" }],
});
function target(
  resolve: (company: string, id: string) => Promise<AttentionTarget>,
  generation = () => 0,
) {
  const opened: NotificationDestination[] = [];
  const fetched: string[] = [];
  const authorized: string[] = [];
  const n = new AuthorizedNotificationTarget(
    session,
    async (company, id) => {
      authorized.push(company + "/" + id);
    },
    (t) => opened.push(t),
    generation,
    (company, id) => {
      fetched.push(company + "/" + id);
      return resolve(company, id);
    },
  );
  return { n, opened, fetched, authorized };
}
const item = (sourceKind: string, sourceId = "s1", companyId = "d") => ({
  id: "a1",
  companyId,
  sourceKind,
  sourceId,
});
it("opens the task detail for a task attention hint after authenticated lookup", async () => {
  const { n, opened, fetched } = target(async () => item("task", "t9"));
  await n.open({ eventId: "e1", companyId: "d", attentionId: "a1" });
  expect(fetched).toEqual(["d/a1"]);
  expect(opened).toEqual([{ companyId: "d", taskId: "t9" }]);
});
it("opens the expense detail for an expense attention hint", async () => {
  const { n, opened } = target(async () => item("expense", "x4"));
  await n.open({ eventId: "e2", companyId: "d", attentionId: "a1" });
  expect(opened).toEqual([{ companyId: "d", expenseId: "x4" }]);
});
it("falls back to the company Inbox for other kinds, denial, or mismatched items", async () => {
  const other = target(async () => item("goal"));
  await other.n.open({ eventId: "e3", companyId: "d", attentionId: "a1" });
  expect(other.opened).toEqual([{ companyId: "d", inbox: true }]);
  const denied = target(async () => {
    throw Error("This resource was not found in your accessible workspace.");
  });
  await denied.n.open({ eventId: "e4", companyId: "d", attentionId: "a1" });
  expect(denied.opened).toEqual([{ companyId: "d", inbox: true }]);
  const foreignItem = target(async () => item("task", "t", "c"));
  await foreignItem.n.open({
    eventId: "e5",
    companyId: "d",
    attentionId: "a1",
  });
  expect(foreignItem.opened).toEqual([{ companyId: "d", inbox: true }]);
  const malformed = target(async () => ({ sourceKind: "task" }) as never);
  await malformed.n.open({ eventId: "e6", companyId: "d", attentionId: "a1" });
  expect(malformed.opened).toEqual([{ companyId: "d", inbox: true }]);
});
it("refuses attention hints for companies outside the session without fetching", async () => {
  const { n, opened, fetched } = target(async () => item("task"));
  await expect(
    n.open({ eventId: "e7", companyId: "foreign", attentionId: "a1" }),
  ).rejects.toThrow("Notification company unavailable.");
  expect(fetched).toEqual([]);
  expect(opened).toEqual([]);
});
it("drops navigation when the session or company generation changes during lookup", async () => {
  let generation = 0;
  let release: (v: AttentionTarget) => void = () => {};
  const { n, opened } = target(
    () => new Promise<AttentionTarget>((r) => (release = r)),
    () => generation,
  );
  const pending = n.open({ eventId: "e8", companyId: "d", attentionId: "a1" });
  await Promise.resolve();
  await Promise.resolve();
  generation++;
  release(item("task"));
  await pending;
  expect(opened).toEqual([]);
  let fail: (e: Error) => void = () => {};
  const failing = target(
    () => new Promise<AttentionTarget>((_, r) => (fail = r)),
    () => generation,
  );
  const lost = failing.n.open({
    eventId: "e9",
    companyId: "d",
    attentionId: "a1",
  });
  await Promise.resolve();
  await Promise.resolve();
  generation++;
  fail(Error("gone"));
  await lost;
  expect(failing.opened).toEqual([]);
});
it("keeps conversation routing and deduplicates attention hints", async () => {
  const { n, opened, fetched, authorized } = target(async () =>
    item("task", "t1", "c"),
  );
  await Promise.all([
    n.open({ eventId: "e10", companyId: "c", attentionId: "a1" }),
    n.open({ eventId: "e10", companyId: "c", attentionId: "a1" }),
  ]);
  expect(fetched).toEqual(["c/a1"]);
  await n.open({ eventId: "e11", companyId: "c", conversationId: "conv" });
  expect(authorized).toEqual(["c/conv"]);
  // A hint naming both prefers the conversation path; attention is never fetched.
  await n.open({
    eventId: "e12",
    companyId: "c",
    conversationId: "conv",
    attentionId: "a1",
  });
  expect(fetched).toEqual(["c/a1"]);
  expect(opened).toEqual([
    { companyId: "c", taskId: "t1" },
    { companyId: "c", conversationId: "conv" },
    { companyId: "c", conversationId: "conv" },
  ]);
});
