import { expect, it } from "vitest";
import { tabBadge, unreadNotificationCount } from "./tabBadges";
it("counts unread bootstrap notifications like the web Inbox badge", () => {
  expect(unreadNotificationCount(null)).toBe(0);
  expect(unreadNotificationCount({ tasks: [] })).toBe(0);
  expect(
    unreadNotificationCount({
      notifications: [
        { id: "a", read: false },
        { id: "b", read: true },
        { id: "c", read: false },
        null,
      ],
    }),
  ).toBe(2);
});
it("hides an empty badge and caps large counts", () => {
  expect(tabBadge(0)).toBeUndefined();
  expect(tabBadge(3)).toBe(3);
  expect(tabBadge(250)).toBe("99+");
});
