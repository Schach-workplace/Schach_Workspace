import { expect, it } from "vitest";
import { AuthorizedNotificationTarget } from "./notificationTarget";
it("deduplicates body-free hints and refuses foreign companies or denied private targets", async () => {
  let opened: any[] = [];
  let authorized = 0;
  const session = async () => ({ user: { id: "u" }, companies: [{ id: "c" }] });
  const n = new AuthorizedNotificationTarget(
    session,
    async () => {
      authorized++;
    },
    (target) => opened.push(target),
    () => 0,
  );
  await Promise.all([
    n.open({
      eventId: "e",
      companyId: "c",
      conversationId: "a",
      url: "https://evil",
    }),
    n.open({ eventId: "e", companyId: "c", conversationId: "a" }),
  ]);
  expect(opened).toEqual([{ companyId: "c", conversationId: "a" }]);
  await expect(
    n.open({ eventId: "f", companyId: "foreign", conversationId: "a" }),
  ).rejects.toThrow();
  expect(authorized).toBe(1);
  const denied = new AuthorizedNotificationTarget(
    session,
    async () => {
      throw Error("Unavailable");
    },
    (target) => opened.push(target),
    () => 0,
  );
  await expect(
    denied.open({ eventId: "d", companyId: "c", conversationId: "private" }),
  ).rejects.toThrow();
  expect(opened).toHaveLength(1);
});
