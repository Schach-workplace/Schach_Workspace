import { isIntelligenceRawExpiry } from '../../../shared/intelligence/rawExpiry';
import { clearExecutionForm } from './executionInput';
import { clearFormPrefix, readDraft } from '../communication/drafts';
import { mergeExecutionPage } from '../../../shared/business/pagination';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '../store';
import { ApiError, request } from './api';
import { readDemoWorkspace, readDemoPeopleWorkflow } from './demo';
import {
  useBusinessAttempt,
  beginAttempt,
  businessKey,
  markAttemptCommitted,
  retireAttempt,
  clearAttemptScope,
  clearAttemptsForSource,
  businessAttemptGeneration,
  canonicalBusinessTarget,
  sameBusinessActorBasis,
  readAttempt,
} from './businessAttempts';
export * from '../../../shared/business/types';
// Demo mode keeps fictional workspace data in the browser. Server-only tools
// explain themselves in the words of the feature the person actually opened.
export function demoUnavailableMessage(path: string) {
  if (path.startsWith('/finance/') || path.startsWith('/expense-receipts/'))
    return 'Receipt extraction, bank statement import, duplicate review and reconciliation require a connected company server. Manual expense entry works in this demo.';
  if (/^\/(task-templates|project-milestones|projects\/|planning|schedule)/.test(path))
    return 'Templates, milestones and reviewed schedules are available on a connected company server.';
  if (path.startsWith('/goals'))
    return 'Measured goal history, evidence and reminders require a connected company server.';
  if (path.startsWith('/reports'))
    return 'Saved and historical reports require a connected company server.';
  return 'This tool requires a connected company server. The demo keeps only fictional workspace data in this browser.';
}
// Same-origin cookie download for a private finance file. The response is a
// sandboxed attachment; only the bytes are kept and handed to the browser.
export async function downloadFinanceFile(
  company: string,
  path: string,
  fileName: string,
  signal?: AbortSignal,
) {
  const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
  const response = await fetch(`${base}/api/companies/${encodeURIComponent(company)}${path}`, {
    credentials: 'include',
    signal,
  });
  if (!response.ok) {
    let message = 'This file is no longer available to you. Refresh and check your access.';
    try {
      message = (await response.json()).error?.message || message;
    } catch {
      /* proxy response */
    }
    throw new ApiError(message, response.status, 'download_failed');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function executionRead<T>(
  mode: 'api' | 'demo',
  company: string,
  user: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (mode === 'demo') {
    if (path.startsWith('/people/'))
      return (await readDemoPeopleWorkflow(company, user, path)) as T;
    if (path === '/task-templates') return { templates: [], nextCursor: '' } as T;
    if (path === '/projects')
      return { projects: (await readDemoWorkspace(company, user)).projects, nextCursor: '' } as T;
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
    throw new ApiError(demoUnavailableMessage(path), 503, 'demo_unavailable');
  }
  const result = await request<T>(`/companies/${encodeURIComponent(company)}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    body,
    signal,
  });
  if (
    body === undefined &&
    result &&
    typeof result === 'object' &&
    ('nextCursor' in result || 'cursor' in result)
  ) {
    let cursor =
      (result as { nextCursor?: string; cursor?: string }).nextCursor ??
      (result as { cursor?: string }).cursor;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const page = await request<Record<string, unknown>>(
        `/companies/${encodeURIComponent(company)}${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`,
        { signal },
      );
      const rows = result as Record<string, unknown>;
      mergeExecutionPage(rows, page);
      cursor = String(page.nextCursor ?? page.cursor ?? '');
    }
  }
  return result;
}
export function useExecutionRead<T>(path: string, enabled = true, body?: unknown) {
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
    queryKey:
      body === undefined
        ? [...prefix, store.data?.readBasis, path]
        : [...prefix, store.data?.readBasis, path, JSON.stringify(body)],
    enabled: enabled && foreground && !!store.data,
    staleTime: 0,
    retry: false,
    queryFn: ({ signal }) => executionRead<T>(store.mode, company, user, path, body, signal),
  });
  const ready =
    enabled &&
    foreground &&
    !!store.data &&
    !store.authorizing &&
    query.isFetchedAfterMount &&
    !query.isFetching &&
    !query.error;
  const denied =
    enabled &&
    foreground &&
    !!store.data &&
    !query.isFetching &&
    query.error instanceof ApiError &&
    ([401, 403, 404].includes(query.error.status) ||
      ((path.startsWith('/reports/') || path.includes('/evidence-')) &&
        query.error.status === 409 &&
        query.error.code === 'access_changed'));
  useEffect(() => {
    if (!denied) return;
    if (
      query.error instanceof ApiError &&
      isIntelligenceRawExpiry(
        `/companies/${encodeURIComponent(company)}${path}`,
        body === undefined ? 'GET' : 'POST',
        query.error.status,
        query.error.code,
      )
    )
      return;
    clearAttemptsForSource(
      (import.meta.env.VITE_API_URL ?? window.location.origin) + ':' + store.mode,
      company,
      user,
      path.startsWith('/reports/') ? path.split('/rows')[0] : path,
    );
    const goal = path.match(/^\/goals\/([^/?]+)$/);
    if (goal)
      for (const prefix of [
        '$goal-measure:' + goal[1] + ':',
        '$goal-metadata:' + goal[1],
        '$goal-reminder:' + goal[1],
      ])
        clearFormPrefix(company, user, prefix);
    const finance = path.match(
      /^\/finance\/(receipt-extractions|intakes|duplicate-candidates|statement-previews)\/([^/?]+)/,
    );
    if (finance) {
      const family = finance[1],
        id = finance[2];
      for (const form of family === 'receipt-extractions'
        ? ['$receipt-review:', '$receipt-accept:']
        : family === 'intakes'
          ? ['$intake:', '$statement-map:']
          : family === 'duplicate-candidates'
            ? ['$duplicate:']
            : ['$statement-map:'])
        clearExecutionForm(company, user, form + id);
    }
    const project = path.match(/^\/projects\/([^/?]+)$/),
      milestone = path.match(/^\/project-milestones\/([^/?]+)$/),
      template = path.match(/^\/task-templates\/([^/?]+)$/);
    if (project) {
      const body = readDraft({
        serverOrigin: (import.meta.env.VITE_API_URL ?? window.location.origin) + ':' + store.mode,
        companyId: company,
        userId: user,
        conversationId: '$project:' + project[1],
        threadRootId: 'input:selected',
      }).body;
      const selected = body ? JSON.parse(body) : '';
      if (typeof selected === 'string' && selected)
        clearExecutionForm(company, user, '$milestone:' + selected);
      clearExecutionForm(company, user, '$project:' + project[1]);
      clearExecutionForm(company, user, '$milestone:' + project[1]);
    }
    if (milestone) clearExecutionForm(company, user, '$milestone:' + milestone[1]);
    if (template) clearExecutionForm(company, user, '$template-manage:' + template[1]);
  }, [denied, company, user, path]);
  return {
    data: ready ? query.data : undefined,
    ready,
    loading: enabled && foreground && (query.isFetching || query.isPending),
    error: query.error,
    denied,
    retry: query.refetch,
  };
}
export function useExecutionMutation(formId: string, sources: string[] = []) {
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
    onCommitted?: (result: T) => void,
  ): Promise<T> {
    // Pre-flight refusals are shown on the control's own error line. An
    // in-flight submission is already visible through `busy`, so a second
    // click is refused without replacing that submission's eventual outcome.
    if (pending.current) throw Error('This action is already being submitted.');
    const refuse = (message: string) => {
      setError(message);
      return Error(message);
    };
    if (store.authorizing || !store.data)
      throw refuse(
        'Company access is still being confirmed. Wait a moment, then submit again; nothing was sent.',
      );
    if (store.mode === 'demo' && path !== '/expenses' && !path.startsWith('/people/'))
      throw refuse(demoUnavailableMessage(path));
    pending.current = true;
    setBusy(true);
    setError('');
    const captured = owner;
    const hardGeneration = businessAttemptGeneration();
    const currentACK = () =>
      current.current === captured && businessAttemptGeneration() === hardGeneration;
    let committedResult: T | undefined;
    try {
      const dependencies = [
        ...sources,
        ...(typeof payload.projectId === 'string' && payload.projectId
          ? ['/projects/' + payload.projectId]
          : []),
      ];
      const existing = readAttempt<Record<string, unknown>>(business.scope);
      if (existing?.actorBasis && !sameBusinessActorBasis(existing.actorBasis, store.data?.me))
        throw Error('Restore current company authority before retrying.');
      const target = existing?.target ?? {
        path,
        method,
        ...(canonicalBusinessTarget(path, method) ? { canonical: true as const } : {}),
        ...(dependencies.length ? { sources: dependencies } : {}),
      };
      if (target.path !== path || target.method !== method)
        throw Error('Retry the original submitted target.');
      const attempt = beginAttempt(business.scope, payload, businessKey(), target, store.data?.me);
      const committed = (r: Record<string, unknown>) => {
        if (!currentACK()) return;
        const matching = markAttemptCommitted(business.scope, attempt.retryKey, {
          ids: (r.ids as string[]) ?? (r.id ? [String(r.id)] : []),
        });
        if (matching) {
          committedResult = r as T;
          retireAttempt(business.scope, attempt.retryKey);
          if (current.current === captured) onCommitted?.(r as T);
        }
      };
      const result =
        store.mode !== 'demo' && path.endsWith('/preview')
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
              (r) => committed(r as unknown as Record<string, unknown>),
            );
      if (committedResult === undefined) committed(result as Record<string, unknown>);
      if (!currentACK() || committedResult === undefined)
        throw Error('Access changed. Open the current workspace.');
      return committedResult;
    } catch (e) {
      if (committedResult !== undefined && currentACK()) return committedResult;
      if (
        currentACK() &&
        e instanceof ApiError &&
        ([401, 403, 404].includes(e.status) || (e.status === 409 && e.code === 'access_changed'))
      )
        clearAttemptScope(business.scope);
      if (current.current === captured) setError((e as Error).message);
      throw e;
    } finally {
      pending.current = false;
      if (current.current === captured) setBusy(false);
    }
  }
  return {
    ...business,
    execute,
    busy,
    error,
    abandon: () => {
      if (!pending.current) {
        clearAttemptScope(business.scope);
        setError('');
      }
    },
  };
}
