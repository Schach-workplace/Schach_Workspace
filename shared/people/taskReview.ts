import type { PeopleContext, OnboardingPreview } from "./types";
// Only the authorized captured preview supplies task facts. Current choices
// supply human labels; an unavailable label never turns into a technical ID.
export function onboardingTaskReview(
  task: OnboardingPreview["taskPreviews"][number],
  context: PeopleContext | undefined,
  projects: { id: string; name: string }[] = [],
): string[] {
  const f = task.fields;
  const person = (id: unknown) =>
    id
      ? (context?.people.find((p) => p.id === id)?.name ?? "Unavailable person")
      : "None";
  const list = (v: unknown) =>
    Array.isArray(v)
      ? v
          .map((x) =>
            typeof x === "string"
              ? x
              : typeof x === "object" && x !== null && "text" in x
                ? String(x.text)
                : "",
          )
          .filter(Boolean)
      : [];
  return [
    String(f.description ?? ""),
    `Owner: ${person(f.ownerId)} · Independent reviewer: ${person(f.reviewerId)}`,
    `Project: ${f.projectId ? (projects.find((p) => p.id === f.projectId)?.name ?? "Unavailable project") : "No project"} · Project version: ${task.projectVersion}`,
    `Status: ${String(f.status ?? "todo")} · Priority: ${String(f.priority ?? "medium")} · Estimated hours: ${String(f.estimatedHours ?? 0)}`,
    `Start: ${String(f.startDate || "Not set")} · Due: ${String(f.dueDate || "No deadline")}`,
    f.deadlineMode === "timed"
      ? `Timed commitment: ${String(f.dueAt)} · ${String(f.dueTimezone)}`
      : "All-day commitment",
    f.requiresApproval
      ? "Independent acceptance required; evidence and review policy are preserved."
      : "Existing task evidence and review policy applies.",
    ...(Array.isArray(task.checklist)
      ? task.checklist.map((text) => "Checklist: " + text)
      : ["Checklist requirements unavailable. Review onboarding again."]),
    ...(list(f.tags).length ? ["Tags: " + list(f.tags).join(", ")] : []),
  ].filter(Boolean);
}
