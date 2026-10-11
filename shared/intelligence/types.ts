export type IntelligenceOperation = 'transcript' | 'summary' | 'action_draft' | 'report_explanation';
export type IntelligenceSourceKind = 'message' | 'voice_media' | 'record' | 'task_fields' | 'task_comment' | 'expense_fields' | 'goal_fields' | 'goal_measurement' | 'planning_projection' | 'report_current' | 'report_snapshot' | 'transcript';
export interface IntelligenceSourceRequest {
  kind: IntelligenceSourceKind; id: string; parentId?: string; conversationId?: string;
  expectedRevision?: number; expectedVersion?: number; expectedContentHash?: string;
  selectedFieldSet: string;
  filters?: { from: string; to: string; ownerId: string; departmentId: string; projectId: string };
}
export interface IntelligenceSelection { operation: IntelligenceOperation; sources: IntelligenceSourceRequest[]; language?: string }
export interface IntelligenceSource extends IntelligenceSourceRequest { sourceKey: string; label: string; revision: number; version: number; contentHash: string }
export interface IntelligencePreview { selectionHash: string; sources: IntelligenceSource[]; expiresAt: string; policyVersion: string; notice: string }
export interface IntelligenceEnqueue extends IntelligenceSelection { retryKey: string; selectionHash: string; optIn: { accepted: true; policyVersion: string } }
export interface IntelligenceProvider { name: string; version: string; digest: string; configHash: string }
export interface IntelligenceCandidate { kind: 'task' | 'expense' | 'intake'; title: string; description: string; sourceKeys: string[]; ownerId: null; dueDate: null; reviewerId: null; amountMinor: null; currency: null; unresolved: string[] }
interface ResultBase { schemaVersion: 1; sourceSetHash: string; providerIdentity: IntelligenceProvider; limitations: string[] }
export type IntelligenceResult = ResultBase & (
  { operation: 'transcript'; language: string; uncertain: true; segments: { startMs: number; endMs: number; text: string; sourceKey: string }[] } |
  { operation: 'summary'; claims: { text: string; sourceKeys: string[]; confidence: 'supported' | 'uncertain' }[] } |
  { operation: 'action_draft'; candidates: IntelligenceCandidate[] } |
  { operation: 'report_explanation'; items: { factKey: string; relation: string; explanationCode: string; sourceKeys: string[]; text: string }[] }
);
export interface IntelligenceBasis { jobId: string; resultHash: string; sourceSetHash: string }
export interface IntelligenceJob { jobId: string; state: 'queued' | 'running' | 'retry_wait' | 'ready' | 'failed' | 'cancelled' | 'invalidated' | 'expired'; reasonCode?: string; expiresAt: string; resultHash?: string; sourceSetHash?: string; result?: IntelligenceResult; sources?: IntelligenceSource[] }
export interface IntelligenceCapabilities { operations: Record<IntelligenceOperation, boolean>; policyVersion: string; notice: string; reasonCode?: string; limits: { selectedSources: number; expandedSources: number; textBytes: number; textScalars: number; audioBytes: number; audioSeconds: number }; provider?: IntelligenceProvider }
