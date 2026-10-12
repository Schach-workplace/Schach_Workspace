// The web shell (frontend/src/App.tsx) badges Inbox with the unread count of
// the bootstrap `notifications` projection. The native bootstrap carries the
// same server field, so the tab reads it from the current workspace data.
export function unreadNotificationCount(work: unknown): number {
  const notifications = (work as { notifications?: unknown } | null)
    ?.notifications;
  if (!Array.isArray(notifications)) return 0;
  return notifications.filter(
    (n) => !!n && typeof n === "object" && !(n as { read?: unknown }).read,
  ).length;
}
export function tabBadge(count: number): string | number | undefined {
  if (count <= 0) return undefined;
  return count > 99 ? "99+" : count;
}
