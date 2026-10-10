import { useState, useSyncExternalStore } from 'react';
import { useWorkspace } from '../store';
import {
  readDraft,
  writeDraft,
  clearDraft,
  subscribeDraft,
  clearConversationDrafts,
} from '../communication/drafts';
/** Fetched prefill stays component-local. Only explicit authored setters enter accepted scoped RAM. */
export function useExecutionInput<T>(
  form: string,
  field: string,
  initial: T | (() => T),
  onWrite?: () => void,
) {
  const w = useWorkspace();
  const scope = {
    serverOrigin: (import.meta.env.VITE_API_URL ?? window.location.origin) + ':' + w.mode,
    companyId: w.companyId ?? w.data?.company.id ?? '',
    userId: w.session?.user.id ?? w.data?.me.id ?? '',
    conversationId: form,
    threadRootId: 'input:' + field,
  };
  const owner = JSON.stringify(scope);
  const initialize = () => (typeof initial === 'function' ? (initial as () => T)() : initial);
  const [base, setBase] = useState(() => ({ owner, value: initialize() }));
  if (base.owner !== owner) setBase({ owner, value: initialize() });
  const stored = useSyncExternalStore(subscribeDraft, () => readDraft(scope));
  const value: T = stored.body ? JSON.parse(stored.body) : base.value;
  const current = (): T => {
    const s = readDraft(scope).body;
    return s ? JSON.parse(s) : base.value;
  };
  const set = (next: T | ((v: T) => T)) => {
    onWrite?.();
    writeDraft(scope, {
      body: JSON.stringify(typeof next === 'function' ? (next as (v: T) => T)(current()) : next),
    });
  };
  const prefill = (value: T) => setBase({ owner, value });
  const retire = (submitted: T = value) => {
    if (JSON.stringify(current()) !== JSON.stringify(submitted)) return false;
    clearDraft(scope);
    setBase({ owner, value: initialize() });
    return true;
  };
  return [value, set, prefill, retire] as const;
}
export function useExecutionBasis<T>(form: string, initial: T) {
  const [basis, set] = useExecutionInput(form, 'expectedBasis', initial);
  return { basis, freeze: () => set(basis) };
}
export function clearExecutionForm(company: string, user: string, form: string) {
  clearConversationDrafts(company, user, form);
}
