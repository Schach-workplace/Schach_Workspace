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
