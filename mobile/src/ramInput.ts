import { useState, useSyncExternalStore } from "react";
import { client } from "./client";
import { useWorkspace } from "./Workspace";
import {
  readDraft,
  writeDraft,
  clearDraft,
  subscribeDraft,
} from "./conversationDrafts";
/** Only setters cache authored values; fetched initial defaults never enter RAM. */
export function useRamInput<T>(
  form: string,
  field: string,
  initial: T | (() => T),
) {
  const w = useWorkspace();
  const scope = {
    serverOrigin: client.endpoint,
    companyId: w.company,
    userId: w.session?.user.id ?? "",
    conversationId: form,
    threadRootId: "input:" + field,
  };
  const owner = JSON.stringify(scope);
  const initialize = () =>
    typeof initial === "function" ? (initial as () => T)() : initial;
  const [base, setBase] = useState(() => ({ owner, value: initialize() }));
  if (base.owner !== owner) setBase({ owner, value: initialize() });
  const stored = useSyncExternalStore(subscribeDraft, () => readDraft(scope));
  const value: T = stored.body ? JSON.parse(stored.body) : base.value;
  const current = (): T => {
    const s = readDraft(scope).body;
    return s ? JSON.parse(s) : base.value;
  };
  const set = (next: T | ((old: T) => T)) =>
    writeDraft(scope, {
      body: JSON.stringify(
        typeof next === "function" ? (next as (old: T) => T)(current()) : next,
      ),
    });
  const retire = (submitted: T = value) => {
    if (JSON.stringify(current()) !== JSON.stringify(submitted)) return false;
    clearDraft(scope);
    setBase({ owner, value: initialize() });
    return true;
  };
  const matches = (submitted: T = value) =>
    JSON.stringify(current()) === JSON.stringify(submitted);
  return [value, set, retire, matches] as const;
}
