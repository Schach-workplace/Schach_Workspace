import { useLayoutEffect, useState, useRef } from "react";
import { client } from "./client";
import { useWorkspace } from "./Workspace";
import { readDraft, writeDraft } from "./conversationDrafts";
/** Only setters copy explicitly authored input to RAM. Initial fetched values are not cached. */
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
  const cached = readDraft(scope).body;
  const [value, setValue] = useState<T>(() =>
    cached
      ? JSON.parse(cached)
      : typeof initial === "function"
        ? (initial as () => T)()
        : initial,
  );
  const current = useRef(value);
  useLayoutEffect(() => {
    current.current = value;
  }, [value]);
  const set = (next: T | ((old: T) => T)) => {
    const value =
      typeof next === "function"
        ? (next as (old: T) => T)(current.current)
        : next;
    current.current = value;
    writeDraft(scope, { body: JSON.stringify(value) });
    setValue(value);
  };
  return [value, set] as const;
}
