import { useRef, useState, type SetStateAction } from 'react';

// RAM only, owned by a mounted wrapper. Store only explicit user edits; fetched
// source records remain in the independently authorized detail query.
export type RecordDraftMemory = Record<string, unknown>;
export function useRecordDraft(scope: string, excluded: boolean): RecordDraftMemory {
  const holder = useRef({ scope, values: {} as RecordDraftMemory });
  if (holder.current.scope !== scope || excluded) holder.current = { scope, values: {} };
  return holder.current.values;
}
export function useUserDraftState<T>(
  memory: RecordDraftMemory,
  key: string,
  initial: T | (() => T),
) {
  const [value, setValue] = useState<T>(() =>
    memory[key] !== undefined
      ? (memory[key] as T)
      : typeof initial === 'function'
        ? (initial as () => T)()
        : initial,
  );
  const remember = (next: SetStateAction<T>) => {
    setValue((previous) => {
      const updated = typeof next === 'function' ? (next as (v: T) => T)(previous) : next;
      memory[key] = updated;
      return updated;
    });
  };
  return [value, remember, setValue] as const;
}
