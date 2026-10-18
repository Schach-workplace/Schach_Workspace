import type {
  DevelopmentFields,
  DevelopmentPilot,
  DevelopmentPlan,
} from "./types";
export function developmentDraft(
  pilot: DevelopmentPilot,
  plan?: DevelopmentPlan,
): DevelopmentFields {
  return plan
    ? {
        pilot: plan.pilot,
        title: plan.title,
        careerRole: plan.careerRole,
        careerLevel: plan.careerLevel,
        competencyIds: [...plan.competencyIds],
        objective: plan.objective,
        learningActions: [...plan.learningActions],
        evidenceNote: plan.evidenceNote,
        mentorId: plan.mentorId,
        state: plan.state,
      }
    : {
        pilot: pilot.id,
        title: "",
        careerRole: pilot.careerRoles[0] ?? "",
        careerLevel: pilot.levels[0],
        competencyIds: [],
        objective: "",
        learningActions: [],
        evidenceNote: "",
        mentorId: "",
        state: "active",
      };
}
/** Show the immutable submitted body during uncertain retries, including audience. */
export function developmentSubmission(
  draft: DevelopmentFields,
  attempt?: { payload: Record<string, unknown> } | null,
): DevelopmentFields {
  return attempt
    ? ({ ...draft, ...attempt.payload } as DevelopmentFields)
    : draft;
}
export function learningLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
