/** Career roles describe learning; they never grant application permissions. */
export type DevelopmentPilotId = "engineering" | "office" | "field";
export type DevelopmentState = "active" | "archived";
export type DevelopmentLevel = "foundation" | "practitioner" | "advanced";
export interface DevelopmentCompetency {
  id: string;
  label: string;
}
export interface DevelopmentPilot {
  id: DevelopmentPilotId;
  label: string;
  careerRoles: string[];
  levels: DevelopmentLevel[];
  competencies: DevelopmentCompetency[];
  suggestedLearning: string[];
  roleMeaning: string;
}
export interface DevelopmentFields {
  pilot: DevelopmentPilotId;
  title: string;
  careerRole: string;
  careerLevel: DevelopmentLevel;
  competencyIds: string[];
  objective: string;
  learningActions: string[];
  /** Employee-published narrative only. No task/goal IDs or source ingestion. */
  evidenceNote: string;
  mentorId: string;
  state: DevelopmentState;
}
export interface DevelopmentPlan extends DevelopmentFields {
  id: string;
  ownerId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface DevelopmentReview {
  id: string;
  planId: string;
  mentorId: string;
  feedback: string;
  nextStep: string;
  planVersion: number;
  createdAt: string;
}
export type DevelopmentCreateInput = Omit<
  DevelopmentFields,
  "state" | "mentorId"
> & { retryKey: string; mentorId?: string };
export type DevelopmentUpdateInput = Partial<DevelopmentFields> & {
  retryKey: string;
  expectedVersion: number;
};
export interface DevelopmentReviewInput {
  retryKey: string;
  expectedVersion: number;
  feedback: string;
  nextStep: string;
}
export interface DevelopmentMutationResult {
  id: string;
  version: number;
  reviewId?: string;
}
export interface DevelopmentCatalogResult {
  pilots: DevelopmentPilot[];
}
export interface DevelopmentListResult {
  plans: DevelopmentPlan[];
  hasMore: boolean;
  cursor: string;
}
export interface DevelopmentDetailResult {
  plan: DevelopmentPlan;
  reviews: DevelopmentReview[];
  canEdit: boolean;
  canReview: boolean;
}
