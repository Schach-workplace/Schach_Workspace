import type { FrozenBusinessAttempt } from "../business/attempts";
// Authored controls for an unknown canonical request come from its captured
// body, even after ordinary graph draft invalidation. This never updates CAS.
export function frozenGoalDraft<T extends Record<string, unknown>>(
  draft: T,
  attempt: FrozenBusinessAttempt<Record<string, unknown>> | undefined,
  kind: "measurement" | "metadata" | "reminder",
  time: (instant: string) => Record<string, string>,
): T {
  if (attempt?.state !== "unknown" || !attempt.payload) return draft;
  const p = attempt.payload;
  if (kind === "reminder") return { ...draft, ...p, authored: true };
  if (kind === "measurement")
    return {
      ...draft,
      expectedVersion: p.expectedVersion,
      value: String(p.value),
      reason: p.reason,
      evidence: p.evidence,
      authored: true,
      ...(typeof p.effectiveAt === "string" ? time(p.effectiveAt) : {}),
    };
  const observation =
    (p.initialMeasurement as Record<string, unknown> | undefined) ??
    ("current" in p
      ? {
          value: p.current,
          effectiveAt: p.effectiveAt,
          reason: p.measurementReason,
        }
      : undefined);
  return {
    ...draft,
    ...p,
    baseline: String(p.baseline),
    target: String(p.target),
    withMeasurement: !!observation,
    authored: true,
    ...(observation
      ? {
          value: String(observation.value),
          measurementReason: observation.reason,
          ...(typeof observation.effectiveAt === "string"
            ? time(observation.effectiveAt)
            : {}),
        }
      : {}),
  };
}
