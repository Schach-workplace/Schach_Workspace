export interface DraftScope {
  serverOrigin: string;
  companyId: string;
  userId: string;
  conversationId: string;
  threadRootId?: string;
}
export interface SendInput {
  clientMessageId: string;
  body: string;
  replyToId: string;
  mentionIds?: string[];
  mentionAll?: boolean;
}
export interface Draft {
  body: string;
  mentionIds: string[];
  mentionAll: boolean;
  replyToId: string;
  pendingPayload: SendInput | null;
  error: string;
  busy: boolean;
}
const empty: Draft = {
  body: "",
  mentionIds: [],
  mentionAll: false,
  replyToId: "",
  pendingPayload: null,
  error: "",
  busy: false,
};
const entries = new Map<string, { scope: DraftScope; draft: Draft }>();
const key = (s: DraftScope) =>
  JSON.stringify([
    s.serverOrigin,
    s.companyId,
    s.userId,
    s.conversationId,
    s.threadRootId ?? "",
  ]);
export interface HistoryPosition {
  oldestSequence: number;
  anchorId?: string;
  offset?: number;
  atBottom?: boolean;
  policyKey?: string;
}
const positions = new Map<
  string,
  { scope: DraftScope; value: HistoryPosition }
>();
export function readHistoryPosition(scope: DraftScope) {
  return positions.get(key(scope))?.value;
}
export function writeHistoryPosition(
  scope: DraftScope,
  value: Partial<HistoryPosition>,
) {
  positions.set(key(scope), {
    scope,
    value: {
      oldestSequence: Infinity,
      ...readHistoryPosition(scope),
      ...value,
    },
  });
}
const matches = (
  scope: DraftScope,
  company: string,
  user: string,
  conversation?: string,
) =>
  scope.companyId === company &&
  scope.userId === user &&
  (!conversation ||
    scope.conversationId === conversation ||
    scope.conversationId.startsWith(conversation + ":publication:"));
const listeners = new Set<() => void>();
export function subscribeDraft(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const notify = () => listeners.forEach((l) => l());
export function readDraft(scope: DraftScope): Draft {
  return entries.get(key(scope))?.draft ?? empty;
}
export function writeDraft(scope: DraftScope, draft: Partial<Draft>) {
  entries.set(key(scope), { scope, draft: { ...readDraft(scope), ...draft } });
  notify();
}
export function clearDraft(scope: DraftScope) {
  entries.delete(key(scope));
  notify();
}
export function clearAllDrafts() {
  entries.clear();
  positions.clear();
  notify();
}
export function clearCompanyDrafts(company: string, user: string) {
  for (const [k, v] of positions)
    if (matches(v.scope, company, user)) positions.delete(k);
  for (const [k, v] of entries)
    if (v.scope.companyId === company && v.scope.userId === user)
      entries.delete(k);
  notify();
}
export function clearConversationDrafts(
  company: string,
  user: string,
  conversation: string,
) {
  for (const [k, v] of positions)
    if (
      matches(v.scope, company, user, conversation) ||
      (matches(v.scope, company, user) &&
        v.scope.conversationId === "$navigation" &&
        v.value.anchorId === conversation)
    )
      positions.delete(k);
  for (const [k, v] of entries)
    if (matches(v.scope, company, user, conversation)) entries.delete(k);
  notify();
}
/** Quote/source changes cannot mutate a frozen ambiguous send. Clear unsafe intent. */
export function clearDraftSources(
  company: string,
  user: string,
  conversation: string,
  ids: string[],
) {
  for (const [k, v] of entries) {
    if (
      v.scope.companyId !== company ||
      v.scope.userId !== user ||
      v.scope.conversationId !== conversation
    )
      continue;
    if (
      ids.includes(v.draft.replyToId) ||
      ids.includes(v.draft.pendingPayload?.replyToId ?? "")
    )
      entries.set(k, {
        ...v,
        draft: {
          ...v.draft,
          replyToId: "",
          error:
            "Reply source changed. Frozen retry retains its original identity.",
        },
      });
  }
  notify();
}
