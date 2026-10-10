import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '../store';
import { ApiError, request } from './api';
import { readDemoWorkspace } from './demo';
import {
  useBusinessAttempt,
  beginAttempt,
  businessKey,
  markAttemptCommitted,
  retireAttempt,
  clearAttemptScope,
} from './businessAttempts';
export * from '../../../shared/business/types';
export async function executionRead<T>(
  mode: 'api' | 'demo',
  company: string,
  user: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (mode === 'demo') {
    if (/^\/projects\/[^/]+$/.test(path)) {
      const w = await readDemoWorkspace(company, user);
      const p = w.projects.find((p) => p.id === path.split('/')[2]);
      if (!p) throw new ApiError('Project unavailable.', 404, 'not_found');
      const tasks = w.tasks.filter((t) => t.projectId === p.id);
      return {
        project: { ...p, version: p.version ?? 1 },
        canEdit: ['founder', 'ceo', 'admin', 'head', 'manager'].includes(w.me.role),
        summary: {
          label: 'authorized tasks',
          total: tasks.length,
          accepted: tasks.filter((t) => t.status === 'done').length,
        },
      } as T;
    }
    throw new ApiError(
      'Templates, milestones and reviewed schedules are available on a connected company server.',
      503,
      'demo_unavailable',
    );
  }
  const result = await request<T>(`/companies/${encodeURIComponent(company)}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    body,
    signal,
  });
  if (body === undefined && result && typeof result === 'object' && 'nextCursor' in result) {
    let cursor = (result as { nextCursor?: string }).nextCursor;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const page = await request<Record<string, unknown>>(
        `/companies/${encodeURIComponent(company)}${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`,
        { signal },
      );
      const rows = result as Record<string, unknown>;
      for (const key of ['templates', 'projects', 'milestones', 'nodes'])
        if (Array.isArray(rows[key]) && Array.isArray(page[key]))
          rows[key] = [...(rows[key] as unknown[]), ...(page[key] as unknown[])];
      cursor = String(page.nextCursor ?? '');
    }
  }
  return result;
}
export function useExecutionRead<T>(path: string, enabled = true) {
  const store = useWorkspace();
  const queryClient = useQueryClient();
  const [foreground, setForeground] = useState(document.visibilityState !== 'hidden');
  const user = store.session?.user.id ?? store.data?.me.id ?? '';
  const company = store.companyId ?? store.data?.company.id ?? '';
  const prefix = ['workspace', store.mode, user, company, 'execution'];
  useEffect(() => {
    const changed = () => {
      const visible = document.visibilityState !== 'hidden';
      setForeground(visible);
      if (!visible) {
        void queryClient.cancelQueries({ queryKey: prefix });
        queryClient.removeQueries({ queryKey: prefix });
      } else void queryClient.invalidateQueries({ queryKey: prefix });
    };
    const event = (e: Event) => {
      const h = (e as CustomEvent).detail;
      if (!h || (h.company === company && h.user === user))
        void queryClient.invalidateQueries({ queryKey: prefix });
    };
    document.addEventListener('visibilitychange', changed);
    window.addEventListener('schach-work-event', event);
    return () => {
      document.removeEventListener('visibilitychange', changed);
      window.removeEventListener('schach-work-event', event);
    };
  }, [company, user, store.mode, queryClient]);
  const query = useQuery({
    queryKey: [...prefix, store.data?.readBasis, path],
    enabled: enabled && foreground && !!store.data,
    staleTime: 0,
    retry: false,
    queryFn: ({ signal }) => executionRead<T>(store.mode, company, user, path, undefined, signal),
  });
  const ready =
    enabled &&
    foreground &&
    !!store.data &&
    query.isFetchedAfterMount &&
    !query.isFetching &&
    !query.error;
  return {
    data: ready ? query.data : undefined,
    ready,
    loading: enabled && foreground && (query.isFetching || query.isPending),
    error: query.error,
    denied: query.error instanceof ApiError && [401, 403, 404].includes(query.error.status),
    retry: query.refetch,
  };
}
export function useExecutionMutation(formId: string) {
  const store = useWorkspace();
  const business = useBusinessAttempt<Record<string, unknown>>(formId);
  const pending = useRef(false);
  const owner = JSON.stringify(business.scope);
  const current = useRef(owner);
  current.current = owner;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function execute<T = Record<string, unknown>>(
    path: string,
    payload: Record<string, unknown>,
    method: 'POST' | 'PATCH' = 'POST',
  ): Promise<T> {
    if (pending.current) throw Error('This action is already being submitted.');
    if (store.mode === 'demo')
      throw Error('This execution tool is available on a connected company server.');
    pending.current = true;
    setBusy(true);
    setError('');
    const captured = owner;
    try {
      const attempt = business.attempt ?? beginAttempt(business.scope, payload, businessKey());
      const committed = (r: Record<string, unknown>) =>
        markAttemptCommitted(business.scope, attempt.retryKey, {
          ids: (r.ids as string[]) ?? (r.id ? [String(r.id)] : []),
        });
      const result = path.endsWith('/preview')
        ? await request<T>(`/companies/${encodeURIComponent(business.scope.companyId)}${path}`, {
            method,
            body: { ...attempt.payload, retryKey: attempt.retryKey },
          }).then((r) => {
            committed(r as Record<string, unknown>);
            return r;
          })
        : await store.mutate(
            path,
            { ...attempt.payload, retryKey: attempt.retryKey },
            method,
            (r) =>
              markAttemptCommitted(business.scope, attempt.retryKey, {
                ids: r.ids ?? (r.id ? [r.id] : []),
              }),
          );
      if (current.current !== captured) throw Error('Company changed. Open the current workspace.');
      retireAttempt(business.scope, attempt.retryKey);
      return result as T;
    } catch (e) {
      if (e instanceof ApiError && [401, 403, 404].includes(e.status))
        clearAttemptScope(business.scope);
      if (current.current === captured) setError((e as Error).message);
      throw e;
    } finally {
      pending.current = false;
      if (current.current === captured) setBusy(false);
    }
  }
  return { ...business, execute, busy, error };
}
