import { useExecutionRead, useExecutionMutation } from './execution';
export * from '../../../shared/goals/types';
export const useGoalRead = useExecutionRead;
export const useGoalMutation = useExecutionMutation;
