export * from '../../../shared/people/types';
export * from '../../../shared/people/flow';
export {
  useExecutionRead as usePeopleRead,
  useExecutionMutation as usePeopleMutation,
} from './execution';

import { useState } from 'react';
import { businessAttemptGeneration } from './businessAttempts';
// Results can outlive a refetch, but never an authorization reset.
export function usePeopleResult<T>(): [T | undefined, (value: T | undefined) => void] {
  const [stored, setStored] = useState<{ generation: number; value: T }>();
  return [
    stored?.generation === businessAttemptGeneration() ? stored.value : undefined,
    (value) =>
      setStored(
        value === undefined ? undefined : { generation: businessAttemptGeneration(), value },
      ),
  ];
}

// A missing current read during reauthorization is not a new graph identity.
// This basis scopes authored layout only; ready/current reads still gate sends.
export function usePeopleEditorBasis(current: string | undefined) {
  const [last, setLast] = useState(current ?? '');
  if (current !== undefined && current !== last) setLast(current);
  return current ?? last;
}
// Row IDs alone keep authored editor placement; no source DTO or label is cached.
export function usePeopleRowIDs(current: string[] | undefined, basis: string) {
  const scope = businessAttemptGeneration() + ':' + basis;
  const encoded = JSON.stringify(current);
  const [last, setLast] = useState({ scope, encoded, ids: current });
  if (last.scope !== scope || (current !== undefined && last.encoded !== encoded))
    setLast({ scope, encoded, ids: current });
  return current ?? (last.scope === scope ? last.ids : undefined) ?? [];
}
