export interface MeasuredGoal {
  id: string;
  companyId: string;
  version: number;
  name: string;
  description: string;
  ownerId: string;
  departmentId: string;
  unit: string;
  baseline: number;
  target: number;
  current: number;
  dueDate: string;
  taskIds: string[];
  currentMeasurementId: string;
  measurementCoverageFrom: string | null;
  legacyObservedCurrent: number | null;
  legacyObservedUnit: string;
}
export interface GoalDetail {
  goal: MeasuredGoal;
  canMeasure: boolean;
  canEdit: boolean;
  attainment: number | null;
  readBasis: string;
}
export interface GoalEvidenceInput {
  kind: "task" | "task_comment" | "message" | "report_snapshot";
  sourceId: string;
  parentId: string;
  revision?: number;
  contentHash: string;
}
export interface GoalEvidenceView {
  status: "matching" | "changed_since_measurement" | "evidence_unavailable";
  kind?: GoalEvidenceInput["kind"];
  sourceId?: string;
  parentId?: string;
  revision?: number;
  contentHash?: string;
  label?: string;
  excerpt?: string;
}
export interface GoalMeasurement {
  id: string;
  goalId: string;
  actorId: string;
  actorName: string;
  value: number;
  effectiveAt: string;
  reason: string;
  correctsId?: string;
  createdAt: string;
  goalVersionAfter: number;
  unit: string;
  baseline: number;
  target: number;
  evidence: GoalEvidenceView[];
}
export interface GoalMeasurementIntent {
  expectedVersion: number;
  value: number;
  effectiveAt: string;
  reason: string;
  evidence: GoalEvidenceInput[];
  correctsId?: string;
}
export interface GoalMutationResult {
  ok: boolean;
  id: string;
  goalVersion: number;
  measurementId: string;
  current: number;
  currentMeasurementId: string;
}
export interface GoalReminderPreference {
  goalId: string;
  userId: string;
  version: number;
  enabled: boolean;
  cadence: "weekly" | "monthly";
  weekday: number;
  monthDay: number;
  localTime: string;
  createdAt: string;
  updatedAt: string;
}
export interface GoalReportOption {
  sourceId: string;
  label: string;
  period: { from: string; to: string; zone: string };
  generatedAt: string;
  schemaVersion: number;
  contentHash: string;
}

export interface GoalReminderInput {
  expectedVersion: number;
  enabled: boolean;
  cadence: string;
  weekday: number;
  monthDay: number;
  localTime: string;
  reason: string;
}
