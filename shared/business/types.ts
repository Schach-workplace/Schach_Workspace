export interface Commitment {
  startDate?: string;
  dueDate: string;
  deadlineMode: "all_day" | "timed";
  dueAt: string;
  dueTimezone: string;
}
export interface TemplateDefaults {
  title?: string;
  description?: string;
  priority?: string;
  estimatedHours?: number;
  tags?: string[];
  checklist: string[];
  status?: "todo" | "backlog";
  ownerPolicy?: "actor" | "fixed" | "project_owner" | "project_default";
  fixedOwnerId?: string;
  reviewerId?: string;
  requiresApproval?: boolean;
  relativeDueDays?: number;
}
export interface TaskTemplateView {
  id: string;
  companyId: string;
  version: number;
  kind: "task" | "checklist";
  name: string;
  description: string;
  scopeOwnerId: string;
  scopeDepartmentId: string;
  archived: boolean;
  defaults: TemplateDefaults;
}
export interface ExecutionProject {
  id: string;
  companyId: string;
  version: number;
  name: string;
  description: string;
  ownerId: string;
  departmentId: string;
  taskOwnerPolicy: "actor" | "project_owner" | "fixed";
  defaultTaskOwnerId: string;
  defaultReviewerId: string;
  defaultRequiresApproval: boolean;
  dueDate: string;
  color: string;
  status: "active" | "on_hold" | "completed" | "archived";
}
export interface ProjectDetail {
  project: ExecutionProject;
  canEdit: boolean;
  summary: { label: "authorized tasks"; total: number; accepted: number };
}
export interface Criterion {
  id: string;
  text: string;
}
export interface TaskBasis {
  taskId: string;
  version: number;
}
export interface Assertion {
  criterionId: string;
  statement: string;
}
export interface MilestoneAcceptance {
  id: string;
  milestoneVersion: number;
  criteriaVersion: number;
  projectVersion: number;
  tasks: TaskBasis[];
  assertions: Assertion[];
  actorId: string;
  createdAt: string;
  note: string;
}
export interface MilestoneView extends Commitment {
  id: string;
  projectId: string;
  version: number;
  ownerId: string;
  reviewerId: string;
  title: string;
  description: string;
  criteria: Criterion[];
  criteriaVersion: number;
  taskIds: string[];
  state: "draft" | "in_review" | "accepted";
  submittedTasks: TaskBasis[];
  assertions: Assertion[];
  basisCurrent: boolean;
  basisNotice?: string;
  acceptances: MilestoneAcceptance[];
  canEdit: boolean;
  canSubmit: boolean;
  canReview: boolean;
  canReopen: boolean;
  originalDueDate: string;
  originalDueAt: string;
  originalDeadlineMode: string;
  originalDueTimezone: string;
}
export interface ImpactNode {
  id: string;
  code: string;
  title: string;
  ownerId: string;
  version: number;
  projectId: string;
  currentCommitment: Commitment;
  originalCommitment: Commitment;
  status: string;
}
export interface TaskImpactView {
  rootId: string;
  nodes: ImpactNode[];
  edges: { from: string; to: string }[];
  paths: string[][];
  notice: string;
  nextCursor: string;
}
export interface ScheduleChange extends Commitment {
  taskId: string;
  version: number;
  startDate: string;
  reason: string;
}
export interface ScheduleContext {
  projects: { id: string; version: number }[];
  milestones: { id: string; version: number }[];
}
export interface ScheduleProposalView {
  id: string;
  version: number;
  method: "manual" | "calendar_day_shift";
  dayOffset?: number;
  expiresAt: string;
  expired: boolean;
  rows: {
    taskId: string;
    code: string;
    title: string;
    version: number;
    before: Commitment;
    current: Commitment;
    original: Commitment;
    after: Commitment;
    reason: string;
  }[];
  context: ScheduleContext;
  advisories: string[];
  notice: string;
}
export interface TemplatePreview {
  fields: Record<string, unknown>;
  unresolved: string[];
  templateVersion: number;
  projectVersion: number;
}
export function commitmentLabel(c: Partial<Commitment>) {
  return c.deadlineMode === "timed" && c.dueAt
    ? `${c.dueDate} · ${c.dueAt} · ${c.dueTimezone}`
    : c.dueDate || "No deadline";
}
