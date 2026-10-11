export interface AttentionPerson {
  id: string;
  name: string;
  active: boolean;
  role: string;
  departmentId?: string;
}
export interface AttentionView {
  id: string;
  companyId: string;
  recipientId: string;
  sourceKind:
    | "goal"
    | "task"
    | "expense"
    | "record"
    | "intake"
    | "bookmark"
    | "report_export"
    | "finance_extraction"
    | "finance_duplicate"
    | "finance_reconciliation";
  sourceId: string;
  kind:
    | "task_review"
    | "expense_review"
    | "decision"
    | "intake_triage"
    | "deadline"
    | "saved_reminder"
    | "blocker"
    | "update"
    | "report_ready"
    | "receipt_review"
    | "duplicate_review"
    | "reconciliation_review";
  state: "open" | "resolved" | "routed" | "superseded";
  version: number;
  sourceVersion: number;
  title: string;
  summary: string;
  link: string;
  ownerName: string;
  canDecide: boolean;
  canRoute: boolean;
  actions: string[];
  routePeople: AttentionPerson[];
  snoozedUntil: string | null;
  dueAt: string | null;
  reminderState: string;
}
export interface AttentionTransitionInput {
  expectedVersion: number;
  retryKey: string;
  action: "resolve" | "snooze" | "unsnooze" | "route";
  reason?: string;
  snoozedUntil?: string;
  recipientId?: string;
}
export interface AttentionPreference {
  version: number;
  workingHoursEnabled: boolean;
  workingDays: number[];
  workingStart: string;
  workingEnd: string;
  quietStart: string;
  quietEnd: string;
  escalationEnabled: boolean;
  escalationAfterMinutes: number;
  escalationUserId: string;
}
export const defaultAttentionPreference = (): AttentionPreference => ({
  version: 1,
  workingHoursEnabled: false,
  workingDays: [],
  workingStart: "",
  workingEnd: "",
  quietStart: "",
  quietEnd: "",
  escalationEnabled: false,
  escalationAfterMinutes: 0,
  escalationUserId: "",
});
export function attentionIntent(
  item: Pick<AttentionView, "version">,
  action: AttentionTransitionInput["action"],
  draft: { reason?: string; recipientId?: string; snoozedUntil?: string },
  retryKey: string,
): AttentionTransitionInput {
  return {
    expectedVersion: item.version,
    retryKey,
    action,
    ...(action === "resolve" || action === "route"
      ? { reason: draft.reason ?? "" }
      : {}),
    ...(action === "route" ? { recipientId: draft.recipientId ?? "" } : {}),
    ...(action === "snooze" ? { snoozedUntil: draft.snoozedUntil ?? "" } : {}),
  };
}
