import { companyDate } from "./workDates";
/** Explainable recorded facts only; no employee score or decision authority. */
export function workFocusReasons(
  task: {
    status: string;
    ownerId?: string;
    dueDate?: string;
    deadlineMode?: string;
    dueAt?: string;
  },
  actorId: string,
  zone: string,
  now = new Date(),
) {
  if (["done", "cancelled"].includes(task.status)) return [];
  const reasons: string[] = [];
  if (task.ownerId === actorId) reasons.push("Your open work");
  if (task.status === "blocked") reasons.push("Blocked");
  if (task.status === "in_review") reasons.push("Awaiting review");
  const date = companyDate(now, zone);
  if (task.deadlineMode === "timed") {
    const due = Date.parse(task.dueAt ?? "");
    if (Number.isFinite(due)) {
      if (now.getTime() > due) reasons.push("Deadline passed");
      else if (companyDate(new Date(due), zone) === date)
        reasons.push("Due today");
    }
  } else if (task.dueDate) {
    if (task.dueDate < date) reasons.push("Overdue");
    else if (task.dueDate === date) reasons.push("Due today");
  }
  return reasons;
}
