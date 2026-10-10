import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '../store';
import { request, ApiError } from './api';
import { readPages } from './readScopes';
import { demoAttentionRead, demoAttentionDetail } from './demo';
import type { AttentionView } from '../types';
export function useAttention({
  state = 'open',
  decisionsOnly = false,
  sourceTaskId = '',
}: { state?: string; decisionsOnly?: boolean; sourceTaskId?: string } = {}) {
  const store = useWorkspace();
  const queryClient = useQueryClient();
  const [foreground, setForeground] = useState(document.visibilityState !== 'hidden');
  const user = store.session?.user.id ?? store.data?.me.id ?? '';
  const company = store.companyId ?? store.data?.company.id ?? '';
  const prefix = ['workspace', store.mode, user, company, 'attention'];
  useEffect(() => {
    const changed = () => {
      const active = document.visibilityState !== 'hidden';
      setForeground(active);
      if (!active) {
        void queryClient.cancelQueries({ queryKey: prefix });
        queryClient.removeQueries({ queryKey: prefix });
      } else void queryClient.invalidateQueries({ queryKey: prefix });
    };
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, [queryClient, store.mode, user, company]);
  const query = useQuery({
    queryKey: [...prefix, store.data?.readBasis, state, decisionsOnly, sourceTaskId],
    enabled: !!store.data && foreground,
    staleTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      store.mode === 'demo'
        ? demoAttentionRead(company, user, state, decisionsOnly)
        : readPages<AttentionView>(
            `/companies/${encodeURIComponent(company)}/attention?state=${state}&decisionsOnly=${decisionsOnly}${sourceTaskId ? `&sourceKind=task&sourceId=${encodeURIComponent(sourceTaskId)}&kind=blocker` : ''}`,
            'items',
            signal,
          ),
  });
  return {
    items:
      foreground && store.data && query.isFetchedAfterMount && !query.isFetching && !query.error
        ? (query.data ?? [])
        : [],
    ready:
      foreground && !!store.data && query.isFetchedAfterMount && !query.isFetching && !query.error,
    loading: foreground && !!store.data && (query.isPending || query.isFetching),
    error: query.error,
    denied: query.error instanceof ApiError && [401, 403, 404].includes(query.error.status),
    retry: () => query.refetch(),
    prefix,
    foreground,
  };
}
export async function attentionDetail(
  mode: 'api' | 'demo',
  company: string,
  user: string,
  id: string,
  signal?: AbortSignal,
) {
  return mode === 'demo'
    ? { item: await demoAttentionDetail(company, user, id) }
    : request<{ item: AttentionView }>(
        `/companies/${encodeURIComponent(company)}/attention/${encodeURIComponent(id)}`,
        { signal },
      );
}
