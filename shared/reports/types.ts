export interface ReportFilters {
  ownerId: string;
  departmentId: string;
  projectId: string;
}
export interface HistoricalRequest {
  from: string;
  to: string;
  reportZone: string;
  filters: ReportFilters;
  basis: "task_history_v1";
}
export interface ReportDeadline {
  mode: string;
  date: string;
  at: string;
  zone: string;
}
export interface HistoricalMetric {
  code: string;
  value: number;
  unit: string;
  numerator?: number;
  denominator?: number;
  rate: number | null;
  coverage: string[];
  contributingRows: string[];
  numeratorRows: string[];
  denominatorRows: string[];
}
export interface HistoricalSnapshot {
  id: string;
  companyId: string;
  requesterId: string;
  schemaVersion: number;
  metricVersion: number;
  basis: "task_history_v1";
  request: HistoricalRequest;
  generatedAt: string;
  contentHash: string;
  serializedBytes: number;
  rowCount: number;
  summary: { metrics: Record<string, HistoricalMetric>; coverage: string[] };
}
export interface HistoricalRow {
  rowId: string;
  kind: "state" | "acceptance" | "time" | "coverage";
  taskId: string;
  factId: string;
  taskVersion: number;
  acceptanceId?: string;
  timeFactId?: string;
  acceptedAtRaw?: string;
  acceptanceKind?: string;
  entryDate?: string;
  hours?: number;
  reason?: string;
  provenance: string;
  labelBasis: "generation_time";
  ownerLabel: string;
  departmentLabel: string;
  projectLabel: string;
  state: {
    code: string;
    title: string;
    status: string;
    ownerId: string;
    original: ReportDeadline;
    current: ReportDeadline;
    companyPolicyZone: string;
    actualHours: number;
  };
}
export interface HistoricalRows {
  code: string;
  value: number;
  unit: string;
  numerator: number | null;
  denominator: number | null;
  rate: number | null;
  coverage: string[];
  rows: HistoricalRow[];
  cursor: string;
}
export interface SavedConfiguration {
  name: string;
  basis: "task_history_v1";
  filters: ReportFilters;
  periodRule: "fixed" | "previous_week" | "previous_month";
  from: string;
  to: string;
  timezonePolicy: "explicit" | "company_at_resolution";
  reportZone: string;
  recipientIds: string[];
}
export interface SavedDefinition {
  id: string;
  companyId: string;
  ownerId: string;
  version: number;
  state: "active" | "paused" | "deleted";
  configuration: SavedConfiguration;
}
export interface ReportSchedule {
  id: string;
  version: number;
  definitionRevision: number;
  weekdays: number[];
  localMinute: string;
  scheduleZone: string;
  nextOccurrenceUTC: string;
  state: "active" | "paused" | "deleted";
}
export interface ExportJob {
  id: string;
  snapshotId: string;
  state: "queued" | "running" | "ready" | "failed" | "cancelled" | "expired";
  artifactId: string;
  failureCode: string;
  attemptCount: number;
  definitionRevision: number;
}
export interface ReportArtifact {
  id: string;
  length: number;
  sha256: string;
  expiresAt: string;
}
export interface ReportComparison {
  comparisons: Record<
    string,
    {
      left: HistoricalMetric;
      right: HistoricalMetric;
      delta: number;
      percentagePoints: number | null;
    }
  >;
}
export const metricLabels: Record<string, string> = {
  "state.cohort": "Tasks due as of period end",
  "state.done": "Done as of period end",
  "state.blocked": "Blocked as of period end",
  "state.pending_review": "Pending review as of period end",
  "state.overdue": "Overdue at period end",
  "state.deadline_changed": "Changed commitments",
  "state.actual_hours": "Accumulated hours as of period end",
  "acceptance.episodes": "Acceptance episodes",
  "acceptance.unique_tasks": "Unique accepted tasks",
  "acceptance.original_on_time": "Original commitment on time",
  "acceptance.current_on_time": "Current commitment on time",
  "effort.logged_hours": "Dated logged hours",
  "effort.observed_hours": "Observed imported hours",
  "coverage.unknown_before": "Unknown earlier state",
  "coverage.gaps": "Unknown history gaps",
  "coverage.observed_time": "Observed time coverage",
  "coverage.invalid_deadline": "Missing or invalid commitment",
};
export function validHistoricalRequest(request: HistoricalRequest): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(request.from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(request.to) ||
    request.from > request.to ||
    !request.reportZone
  )
    return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: request.reportZone });
    return request.basis === "task_history_v1";
  } catch {
    return false;
  }
}
export function metricValue(metric: HistoricalMetric): string {
  return metric.unit === "percent"
    ? metric.rate === null
      ? "Unavailable"
      : `${metric.rate.toFixed(1)}% (${metric.numerator}/${metric.denominator})`
    : `${metric.value} ${metric.unit === "hours" ? "hours" : ""}`.trim();
}
