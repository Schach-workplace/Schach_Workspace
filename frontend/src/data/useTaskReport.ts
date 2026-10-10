import { useQuery } from '@tanstack/react-query';
import type { Task, WorkspaceData } from '../types';
import { request } from './api';
import { validDate } from './imports';
import type { ReportFilters } from './reports';
interface ReportInput {
  tasks: Task[];
  generatedAt: string;
  timezone: string;
  basis: 'current_state';
}
export function useTaskReport(data: WorkspaceData, mode: 'api' | 'demo', filters: ReportFilters) {
  const valid = validDate(filters.from) && validDate(filters.to) && filters.from <= filters.to;
  // Visible IDs/versions change when the refreshed workspace scope changes. Never
  // carry a report across an identity, role or authorized-task-set transition.
  const scope = data.tasks
    .map((t) => t.id + ':' + t.version)
    .sort()
    .join('|');
  const result = useQuery({
    queryKey: ['task-report', data.company.id, data.me.id, data.me.role, scope, filters],
    enabled: mode === 'api' && valid && data.me.active,
    staleTime: 0,
    retry: false,
    refetchInterval: mode === 'api' ? 30_000 : false,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ from: filters.from, to: filters.to });
      for (const key of ['departmentId', 'ownerId', 'projectId'] as const)
        if (filters[key]) params.set(key, filters[key]);
      return request<ReportInput>(
        `/companies/${encodeURIComponent(data.company.id)}/reports/tasks?${params}`,
        { signal },
      );
    },
  });
  const available =
    mode === 'demo' || (valid && data.me.active && !!result.data && !result.isError);
  return {
    tasks: mode === 'demo' ? data.tasks : available ? result.data!.tasks : [],
    generatedAt: mode === 'api' && available ? result.data!.generatedAt : '',
    loading: mode === 'api' && valid && result.isPending,
    error: mode === 'api' ? (result.error?.message ?? '') : '',
    available,
    retry: () => void result.refetch(),
  };
}
