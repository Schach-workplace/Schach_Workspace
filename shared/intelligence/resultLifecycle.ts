import type { IntelligenceJob } from "./types";
export function intelligenceCanDisclose(
  job: IntelligenceJob | undefined,
  current: boolean,
): job is IntelligenceJob {
  return current && job?.state === "ready" && !!job.result;
}
export function intelligenceSourcePath(source: {
  kind: string;
  id: string;
  parentId?: string;
  conversationId?: string;
}): string {
  if (source.kind === "record")
    return (
      "/conversations/" +
      encodeURIComponent(source.conversationId ?? "") +
      "/records/" +
      encodeURIComponent(source.id)
    );
  if (source.conversationId)
    return (
      "/conversations/" +
      encodeURIComponent(source.conversationId) +
      "/messages/" +
      encodeURIComponent(
        source.kind === "message" ? source.id : (source.parentId ?? ""),
      ) +
      "/thread"
    );
  if (source.kind === "task_fields" || source.kind === "task_comment")
    return (
      "/tasks/" +
      encodeURIComponent(
        source.kind === "task_fields" ? source.id : (source.parentId ?? ""),
      )
    );
  if (source.kind === "report_snapshot")
    return "/reports/history/snapshots/" + encodeURIComponent(source.id);
  if (source.kind === "goal_fields" || source.kind === "goal_measurement")
    return (
      "/goals/" +
      encodeURIComponent(
        source.kind === "goal_fields" ? source.id : (source.parentId ?? ""),
      )
    );
  if (source.kind === "expense_fields")
    return "/expenses/" + encodeURIComponent(source.id);
  if (source.kind === "transcript")
    return "/intelligence/jobs/" + encodeURIComponent(source.id);
  return "/planning/summary";
}
