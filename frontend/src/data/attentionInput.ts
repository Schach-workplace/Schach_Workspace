import { useState, useSyncExternalStore } from 'react';
import { readDraft, writeDraft, clearDraft, subscribeDraft } from '../communication/drafts';
import type { AttentionTransitionInput } from '../types';
export interface AttentionDraft {
  reason: string;
  recipient: string;
  local: string;
  instant: string;
  reviewed: boolean;
  reviewVersion: number;
  attempt: AttentionTransitionInput | null;
}
const empty = (): AttentionDraft => ({
  reason: '',
  recipient: '',
  local: '',
  instant: '',
  reviewed: false,
  reviewVersion: 0,
  attempt: null,
});
export function useAttentionInput(
  companyId: string,
  userId: string,
  itemId: string,
  action: string,
) {
  const scope = {
    serverOrigin: import.meta.env.VITE_API_URL || window.location.origin,
    companyId,
    userId,
    conversationId: '$attention:' + itemId,
    threadRootId: action,
  };
  const stored = useSyncExternalStore(subscribeDraft, () => readDraft(scope));
  const [base] = useState(empty);
  const value: AttentionDraft = stored.body ? JSON.parse(stored.body) : base;
  const set = (patch: Partial<AttentionDraft>) => {
    const current = readDraft(scope);
    const value = current.body ? JSON.parse(current.body) : empty();
    writeDraft(scope, { body: JSON.stringify({ ...value, ...patch }) });
  };
  return [value, set, () => clearDraft(scope)] as const;
}
