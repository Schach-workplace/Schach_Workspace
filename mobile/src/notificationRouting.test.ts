import { expect, it } from "vitest";
import {
  AuthorizedNotificationTarget,
  type NotificationDestination,
} from "./notificationTarget";
const session = async () => ({
  user: { id: "u" },
  companies: [{ id: "c" }, { id: "d" }],
});
function target(authorize = async () => {}, generation = () => 0) {
  const opened: NotificationDestination[] = [];
  const n = new AuthorizedNotificationTarget(
    session,
    authorize,
    (t) => opened.push(t),
    generation,
  );
  return { n, opened };
}
it("opens Inbox for unknown or malformed payloads instead of doing nothing", async () => {
  const { n, opened } = target();
  await n.open(undefined, "r1");
  await n.open({ taskId: "t" }, "r2");
  await n.open({ eventId: 4, companyId: "c" }, "r3");
  expect(opened).toEqual([{ inbox: true }, { inbox: true }, { inbox: true }]);
  // The same delivered notification (cold start + listener) opens once.
  await n.open({ taskId: "t" }, "r2");
  expect(opened).toHaveLength(3);
});
it("routes company hints without a conversation to that company's Inbox", async () => {
  const { n, opened } = target();
  await n.open({ eventId: "e1", companyId: "d" });
  expect(opened).toEqual([{ companyId: "d", inbox: true }]);
  await expect(n.open({ eventId: "e2", companyId: "foreign" })).rejects.toThrow(
    "Notification company unavailable.",
  );
  expect(opened).toHaveLength(1);
});
it("still requires authorization for conversation hints and drops stale ones", async () => {
  let generation = 0;
  let release: () => void = () => {};
  const { n, opened } = target(
    () => new Promise<void>((r) => (release = r)),
    () => generation,
  );
  const pending = n.open({ eventId: "e", companyId: "c", conversationId: "a" });
  await Promise.resolve();
  await Promise.resolve();
  generation++;
  release();
  await pending;
  expect(opened).toEqual([]);
  const ok = target();
  await ok.n.open({ eventId: "e4", companyId: "c", conversationId: "b" });
  expect(ok.opened).toEqual([{ companyId: "c", conversationId: "b" }]);
});
