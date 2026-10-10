import { useEffect } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Task, WorkspaceData } from '../types';
import { ApiError, request, fetchReportCSV } from './api';
import { validDate } from './imports';
import type { ReportFilters } from './reports';
export interface ReportCounts {
  rows: number;
  cohort: number;
  accepted: number;
  originals: number;
  ontime: number;
  currents: number;
  currentOnTime: number;
  overdue: number;
  changed: number;
  done: number;
  blocked: number;
  pending: number;
  needsAttention: number;
}
export interface ReportSummary extends ReportCounts {
  buckets: { start: string; end: string; count: number }[];
  departments: Record<string, ReportCounts>;
}
interface SummaryInput {
  snapshot: string;
  summary: ReportSummary;
  generatedAt: string;
  timezone: string;
  basis: 'snapshot_current_state';
}
interface ReportPage {
  tasks: Task[];
  cursor: string;
  hasMore: boolean;
}
export function useTaskReport(
  data: WorkspaceData,
  mode: 'api' | 'demo',
  filters: ReportFilters,
  tab = 'commitments',
) {
  const client = useQueryClient();
  const valid = validDate(filters.from) && validDate(filters.to) && filters.from <= filters.to;
  const scope = data.tasks
    .map((t) => t.id + ':' + t.version)
    .sort()
    .join('|');
  const prefix = [
    'task-report',
    data.company.id,
    data.me.id,
    data.readBasis,
    data.me.role,
    data.me.departmentId,
    data.me.managerId,
    scope,
  ];
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  for (const key of ['departmentId', 'ownerId', 'projectId'] as const)
    if (filters[key]) params.set(key, filters[key]);
  const base = `/companies/${encodeURIComponent(data.company.id)}/reports/tasks`;
  const summary = useQuery({
    queryKey: [...prefix, 'summary', filters],
    enabled: mode === 'api' && valid && data.me.active,
    staleTime: 0,
    retry: false,
    refetchInterval: mode === 'api' ? 30000 : false,
    queryFn: ({ signal }) => request<SummaryInput>(`${base}/summary?${params}`, { signal }),
  });
  const authorized =
    valid && data.me.active && !!summary.data && summary.isFetchedAfterMount && !summary.isError;
  const snapshot = authorized ? summary.data!.snapshot : '';
  const pages = useInfiniteQuery({
    queryKey: [...prefix, 'rows', filters, snapshot, tab],
    enabled: mode === 'api' && authorized,
    initialPageParam: '',
    staleTime: 0,
    retry: false,
    queryFn: ({ signal, pageParam }) => {
      const query = new URLSearchParams(params);
      query.set('snapshot', snapshot);
      query.set('tab', tab);
      query.set('limit', '100');
      if (pageParam) query.set('cursor', pageParam);
      return request<ReportPage>(`${base}/rows?${query}`, { signal });
    },
    getNextPageParam: (last) => (last.hasMore ? last.cursor : undefined),
  });
  const error = summary.error ?? pages.error;
  useEffect(() => {
    if (error instanceof ApiError && [401, 403, 409].includes(error.status))
      client.removeQueries({
        queryKey: ['task-report', data.company.id, data.me.id],
        type: 'inactive',
      });
  }, [error, client, data.company.id, data.me.id]);
  const available = mode === 'demo' || (authorized && !pages.isError);
  return {
    tasks:
      mode === 'demo'
        ? data.tasks
        : available && pages.isFetchedAfterMount
          ? (pages.data?.pages.flatMap((p) => p.tasks) ?? [])
          : [],
    summary: mode === 'api' && available ? summary.data?.summary : undefined,
    snapshot,
    generatedAt: mode === 'api' && available ? summary.data!.generatedAt : '',
    loading: mode === 'api' && valid && (!summary.isFetchedAfterMount || summary.isPending),
    rowsLoading: mode === 'api' && authorized && pages.isPending,
    error: mode === 'api' ? (error?.message ?? '') : '',
    available,
    hasMore: mode === 'api' && available && pages.hasNextPage,
    loadingMore: pages.isFetchingNextPage,
    loadMore: () => void pages.fetchNextPage(),
    retry: () => void summary.refetch(),
    exportCSV: async () => {
      const query = new URLSearchParams(params);
      query.set('snapshot', snapshot);
      query.set('tab', tab);
      return fetchReportCSV(`${base}/export?${query}`);
    },
  };
}
