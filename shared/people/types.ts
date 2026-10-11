export interface PeoplePerson {
  id: string;
  membershipId: string;
  name: string;
  email: string;
  role: string;
  departmentId: string;
  managerId: string;
  title: string;
  capacityHours: number;
  active: boolean;
  membershipVersion: number;
  memberAccessEpoch: number;
  companyPermissionEpoch: number;
}
export interface PeopleDepartment {
  id: string;
  name: string;
  version: number;
}
export interface PeopleContext {
  people: PeoplePerson[];
  departments: PeopleDepartment[];
  roles: string[];
  readBasis: string;
  companyPermissionEpoch: number;
}
export interface MembershipDefaults {
  role: string;
  departmentId: string;
  managerId: string;
  title: string;
  capacityHours: number;
}
export interface SessionEffect {
  reauthenticate: boolean;
  scope: "account_sessions";
  devicesMustReregister: boolean;
  callsMustRejoin: boolean;
  otherCompanyMembershipsPreserved: boolean;
}
export interface PeoplePreset {
  id: string;
  version: number;
  name: string;
  description: string;
  archived: boolean;
  membership: MembershipDefaults;
  templateIds: string[];
}
export interface OnboardingTask {
  templateId: string;
  expectedTemplateVersion: number;
  projectId?: string;
  expectedProjectVersion?: number;
  anchorDate: string;
  fields: Record<string, unknown>;
}
export interface OnboardingIntent {
  name: string;
  email: string;
  presetId?: string;
  expectedPresetVersion?: number;
  membership: MembershipDefaults;
  tasks: OnboardingTask[];
}
export interface OnboardingPreview {
  id: string;
  version: number;
  expiresAt: string;
  graphFingerprint: string;
  accountMode: "new_account" | "existing_account";
  person: { name: string; email: string };
  membershipAfter: MembershipDefaults;
  grants: { area: string; summary: string }[];
  taskPreviews: {
    templateId: string;
    templateVersion: number;
    projectVersion: number;
    fields: Record<string, unknown>;
  }[];
  unresolved: { field: string; message: string }[];
  sessionEffect: SessionEffect;
}
export interface PeopleResult {
  ok?: boolean;
  id: string;
  userId?: string;
  membershipId?: string;
  taskIds?: string[];
  sessionEffect: SessionEffect;
  companyPermissionEpoch: number;
}
export interface ReviewDecision {
  userId: string;
  expectedMembershipVersion: number;
  action: "keep" | "change" | "revoke_access" | "departure_required";
  fields?: Partial<MembershipDefaults>;
  reason?: string;
  handoverStatus?: string;
  accessOutcome?: string;
}
export interface AccessReviewView extends PeopleResult {
  previewId: string;
  version: number;
  state: "draft" | "completed" | "superseded";
  reason: string;
  decisions: ReviewDecision[];
  graphFingerprint: string;
  reviewerId: string;
  createdAt: string;
  completedAt: string;
}
export interface DepartureReplacement {
  kind: string;
  sourceId: string;
  expectedVersion: number;
  action: "transfer" | "clear_reporting_manager" | "retain_current_reviewer";
  newUserId: string;
}
export interface DepartureItem {
  kind: string;
  sourceId: string;
  version: number;
  title: string;
  state: string;
  allowsNoManager: boolean;
  candidates: {
    id: string;
    name: string;
    role: string;
    departmentId: string;
    eligibility: string;
  }[];
  replacement?: DepartureReplacement;
}
export interface DeparturePreview {
  id: string;
  version: number;
  expiresAt: string;
  graphFingerprint: string;
  target: { id: string; name: string; role: string; membershipVersion: number };
  liveItems: DepartureItem[];
  retainedHistory: Record<string, number>;
  unresolved: {
    code: string;
    message: string;
    sourcePath?: string;
    projectId?: string;
  }[];
  sessionEffect: SessionEffect;
  readyToApply: boolean;
}
