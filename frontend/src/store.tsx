import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { readPages, affectedScopes, eventScopes, readDetail } from './data/readScopes';
import type {
  Person,
  Expense,
  Task,
  FinanceEvent,
  Attachment,
  MutationResult,
  Session,
  WorkspaceData,
  WorkspaceStore,
} from './types';
import { ApiError, fetchAttachment, fetchExpenseReceipt, request } from './data/api';
import {
  currentDemoSession,
  demoDownload,
  demoDownloadExpenseReceipt,
  demoUploadExpenseReceipt,
  demoLogin,
  demoLogout,
  demoMutate,
  demoUpload,
  initialDemoSession,
  readDemoWorkspace,
  resetDemo as resetDemoData,
} from './data/demo';

const MODE = import.meta.env.VITE_DATA_MODE === 'demo' ? 'demo' : 'api';
const Ctx = createContext<WorkspaceStore | null>(null);
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: true } },
});
function readPreference() {
  try {
    return localStorage.getItem(`schach.workspace.${MODE}.company`) ?? '';
  } catch {
    return '';
  }
}
function rememberCompany(id: string) {
  try {
    localStorage.setItem(`schach.workspace.${MODE}.company`, id);
  } catch {
    /* An optional device preference. */
  }
}

function Store({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [session, setSession] = useState<Session | null>(() =>
    MODE === 'demo' ? initialDemoSession() : null,
  );
  const [companyId, setCompanyId] = useState(() => readPreference());
  const [authLoading, setAuthLoading] = useState(MODE === 'api');
  const [pending, setPending] = useState(0);
  const [deniedCompanies, setDeniedCompanies] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const authGeneration = useRef(0);
  const applySession = useCallback((next: Session | null) => {
    setSession(next);
    setCompanyId((old) =>
      next?.companies.some((c) => c.id === old) ? old : (next?.companies[0]?.id ?? ''),
    );
  }, []);
  useEffect(() => {
    if (MODE !== 'api') return;
    const abort = new AbortController();
    const generation = authGeneration.current;
    request<Session>('/auth/session', { signal: abort.signal })
      .then((s) => {
        if (authGeneration.current === generation) applySession(s);
      })
      .catch((e) => {
        if (e.name !== 'AbortError' && !(e instanceof ApiError && e.status === 401))
          setError(e.message);
      })
      .finally(() => {
        if (authGeneration.current === generation) setAuthLoading(false);
      });
    return () => abort.abort();
  }, [applySession]);
  useEffect(() => {
    if (session && !session.companies.some((c) => c.id === companyId))
      setCompanyId(session.companies[0]?.id ?? '');
  }, [session, companyId]);
  useEffect(() => {
    if (companyId) rememberCompany(companyId);
  }, [companyId]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const key = ['workspace', MODE, session?.user.id ?? '', companyId];
  const scopeEnabled = !!session && !!companyId && !deniedCompanies.includes(companyId);
  const workspace = useQuery({
    queryKey: [...key, 'bootstrap'],
    enabled: scopeEnabled,
    retry: (count, error) =>
      !(error instanceof ApiError && [401, 403].includes(error.status)) && count < 1,
    queryFn: ({ signal }) =>
      MODE === 'demo'
        ? readDemoWorkspace(companyId, session!.user.id)
        : request<WorkspaceData>(`/companies/${encodeURIComponent(companyId)}/bootstrap`, {
            signal,
          }),
    refetchInterval: MODE === 'api' ? 30_000 : false,
  });
  const authorized =
    scopeEnabled &&
    workspace.isFetchedAfterMount &&
    !!workspace.data &&
    !(workspace.error instanceof ApiError && [401, 403].includes(workspace.error.status));
  const roleBasis = workspace.data
    ? [
        workspace.data.readBasis,
        workspace.data.me.role,
        workspace.data.me.departmentId,
        workspace.data.me.managerId,
      ].join(':')
    : '';
  const tasks = useQuery({
    queryKey: [...key, 'tasks', roleBasis],
    enabled: MODE === 'api' && authorized,
    queryFn: ({ signal }) =>
      readPages<Task>(`/companies/${encodeURIComponent(companyId)}/tasks`, 'tasks', signal),
    refetchInterval: 30000,
  });
  const finance = useQuery({
    queryKey: [...key, 'finance', roleBasis],
    enabled: MODE === 'api' && authorized,
    queryFn: async ({ signal }) => ({
      expenses: await readPages<Expense>(
        `/companies/${encodeURIComponent(companyId)}/expenses`,
        'expenses',
        signal,
      ),
      ...(await request<{ financeEvents: FinanceEvent[]; people?: Person[] }>(
        `/companies/${encodeURIComponent(companyId)}/finance/events`,
        { signal },
      )),
    }),
    refetchInterval: 30000,
  });
  const readError = tasks.error ?? finance.error;
  useEffect(() => {
    if (readError) {
      setError(readError.message);
      if (readError instanceof ApiError && [401, 403].includes(readError.status)) {
        setDeniedCompanies((old) => (old.includes(companyId) ? old : [...old, companyId]));
        client.removeQueries({ queryKey: key });
      }
    }
  }, [readError, companyId, client]);
  const scopedData =
    authorized && workspace.data
      ? MODE === 'demo'
        ? workspace.data
        : tasks.isFetchedAfterMount && finance.isFetchedAfterMount && tasks.data && finance.data
          ? {
              ...workspace.data,
              tasks: tasks.data,
              expenses: finance.data.expenses,
              financeEvents: finance.data.financeEvents,
              people: Array.from(
                new Map(
                  [...workspace.data.people, ...(finance.data.people ?? [])].map((p) => [p.id, p]),
                ).values(),
              ),
            }
          : null
      : null;
  const invalidate = useCallback(
    async (path: string, user: string, company: string) => {
      const scopes = affectedScopes(path);
      await Promise.all([
        client.invalidateQueries({
          queryKey: ['workspace', MODE, user, company],
          predicate: (q) =>
            scopes.includes(String(q.queryKey[4])) ||
            (scopes.includes('details') && String(q.queryKey[4]).includes(':')),
        }),
        ...(scopes.includes('reports')
          ? [client.invalidateQueries({ queryKey: ['task-report', company, user] })]
          : []),
      ]);
    },
    [client],
  );
  const accessDenied =
    deniedCompanies.includes(companyId) ||
    (workspace.error instanceof ApiError && [401, 403].includes(workspace.error.status));
  useEffect(() => {
    if (!workspace.error) return;
    setError(workspace.error.message);
    if (!(workspace.error instanceof ApiError)) return;
    if (workspace.error.status === 401) {
      authGeneration.current++;
      applySession(null);
      client.clear();
    } else if (workspace.error.status === 403 && session && !deniedCompanies.includes(companyId)) {
      const denied = companyId;
      const userId = session.user.id;
      const generation = authGeneration.current;
      setDeniedCompanies((previous) => [...previous, denied]);
      // Discard the denied company's stale snapshot before any asynchronous session refresh.
      applySession({ ...session, companies: session.companies.filter((c) => c.id !== denied) });
      void client.cancelQueries({ queryKey: ['workspace', MODE, userId, denied] });
      client.removeQueries({ queryKey: ['workspace', MODE, userId, denied] });
      void request<Session>('/auth/session')
        .then((next) => {
          if (authGeneration.current !== generation || next.user.id !== userId) return;
          applySession({ ...next, companies: next.companies.filter((c) => c.id !== denied) });
        })
        .catch((error) => {
          if (authGeneration.current !== generation) return;
          if (error instanceof ApiError && error.status === 401) {
            applySession(null);
            client.clear();
          } else
            setError('Access to this company was removed. Refresh your session or sign in again.');
        });
    }
  }, [workspace.error, applySession, client, companyId, session, deniedCompanies]);
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (MODE === 'demo' && event.key === 'schach.workspace.demo.v1')
        void client.invalidateQueries({ queryKey: ['workspace', 'demo'] });
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [client]);
  useEffect(() => {
    const listener = (event: Event) => {
      const hint = (event as CustomEvent<{ company: string; user: string; kind: string }>).detail;
      if (hint.company !== companyId || hint.user !== session?.user.id) return;
      const scopes = eventScopes(hint.kind);
      if (!scopes.length) return;
      void client.invalidateQueries({
        queryKey: ['workspace', MODE, hint.user, hint.company],
        predicate: (q) =>
          scopes.includes(String(q.queryKey[4])) ||
          scopes.includes('details') ||
          (scopes.includes('task-details') && String(q.queryKey[4]).startsWith('task:')) ||
          (scopes.includes('expense-details') && String(q.queryKey[4]).startsWith('expense:')),
      });
      if (scopes.includes('reports'))
        void client.invalidateQueries({ queryKey: ['task-report', hint.company, hint.user] });
    };
    window.addEventListener('schach-work-event', listener);
    return () => window.removeEventListener('schach-work-event', listener);
  }, [companyId, session?.user.id, client]);
  const notify = useCallback((message: string) => setToast(message), []);
  const clearError = useCallback(() => setError(''), []);
  const refresh = useCallback(async () => {
    setError('');
    await client.invalidateQueries({
      queryKey: ['workspace', MODE, session?.user.id ?? '', companyId],
    });
  }, [client, session, companyId]);
  const refreshSession = useCallback(async () => {
    if (!session) return null;
    const next =
      MODE === 'demo'
        ? currentDemoSession(session.user.id)
        : await request<Session>('/auth/session');
    applySession(next);
    return next;
  }, [session, applySession]);
  const login = useCallback(
    async (email: string, password: string, code = '', recoveryCode = '') => {
      setError('');
      setAuthLoading(true);
      authGeneration.current++;
      try {
        const next =
          MODE === 'demo'
            ? await demoLogin(email, password)
            : await request<Session>('/auth/login', {
                method: 'POST',
                body: { email, password, code, recoveryCode },
              });
        client.clear();
        setDeniedCompanies([]);
        applySession(next);
        notify(`Welcome, ${next.user.name.split(' ')[0]}.`);
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setAuthLoading(false);
      }
    },
    [client, applySession, notify],
  );
  const logout = useCallback(async () => {
    try {
      if (MODE === 'demo') await demoLogout();
      else await request('/auth/logout', { method: 'POST' });
      authGeneration.current++;
      applySession(null);
      client.clear();
      setError('');
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }, [applySession, client]);
  const switchCompany = useCallback(
    async (id: string) => {
      if (!session?.companies.some((c) => c.id === id))
        throw new Error('You are not a member of this company.');
      authGeneration.current++;
      setError('');
      setCompanyId(id);
      rememberCompany(id);
    },
    [session],
  );
  const mutate = useCallback(
    async (
      path: string,
      body: unknown = {},
      method: 'POST' | 'PATCH' = 'POST',
    ): Promise<MutationResult> => {
      if (!session) throw new Error('Please sign in.');
      const targetCompany = companyId;
      const targetUser = session.user.id;
      setPending((p) => p + 1);
      setError('');
      try {
        const global = path === '/companies' || path.startsWith('/auth/');
        const endpoint = global ? path : `/companies/${encodeURIComponent(targetCompany)}${path}`;
        const result =
          MODE === 'demo'
            ? await demoMutate(targetCompany, targetUser, path, body, method)
            : await request<MutationResult>(endpoint, { method, body });
        await invalidate(path, targetUser, targetCompany);
        if (path === '/companies') {
          const next = await refreshSession();
          if (result.id && next?.companies.some((c) => c.id === result.id)) {
            setCompanyId(result.id);
            rememberCompany(result.id);
          }
        } else if (path === '' || path.startsWith('/people')) await refreshSession();
        notify(
          path === '/tasks/import'
            ? `${result.created ?? (body as { rows?: unknown[] })?.rows?.length ?? 0} tasks imported.`
            : path === '/automations/run'
              ? `${result.created ?? 0} recurring tasks and ${result.reminders ?? 0} reminders created.`
              : path.endsWith('/nudge')
                ? 'Update requested in the owner’s inbox.'
                : 'Changes saved.',
        );
        return result;
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setPending((p) => p - 1);
      }
    },
    [session, companyId, client, refreshSession, notify, invalidate],
  );
  const upload = useCallback(
    async (taskId: string, file: File) => {
      if (!session) throw new Error('Please sign in.');
      const target = companyId;
      setPending((p) => p + 1);
      setError('');
      try {
        if (MODE === 'demo') await demoUpload(target, session.user.id, taskId, file);
        else {
          const form = new FormData();
          form.append('file', file);
          await request(
            `/companies/${encodeURIComponent(target)}/tasks/${encodeURIComponent(taskId)}/attachments`,
            { method: 'POST', body: form },
          );
        }
        await invalidate(`/tasks/${taskId}/attachments`, session.user.id, target);
        notify('Evidence attached.');
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setPending((p) => p - 1);
      }
    },
    [session, companyId, client, notify, invalidate],
  );
  const downloadAttachment = useCallback(
    async (attachment: Attachment) => {
      if (!session) return;
      try {
        const blob =
          MODE === 'demo'
            ? await demoDownload(companyId, session.user.id, attachment)
            : await fetchAttachment(companyId, attachment.id);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = attachment.fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) {
        setError((e as Error).message);
        throw e;
      }
    },
    [session, companyId],
  );
  const uploadExpenseReceipt = useCallback(
    async (expenseId: string, file: File) => {
      if (!session) throw new Error('Please sign in.');
      const target = companyId;
      setPending((p) => p + 1);
      setError('');
      try {
        if (MODE === 'demo')
          await demoUploadExpenseReceipt(target, session.user.id, expenseId, file);
        else {
          const form = new FormData();
          form.append('file', file);
          await request(
            `/companies/${encodeURIComponent(target)}/expenses/${encodeURIComponent(expenseId)}/receipts`,
            { method: 'POST', body: form },
          );
        }
        await invalidate(`/expenses/${expenseId}/receipts`, session.user.id, target);
        notify('Receipt attached.');
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setPending((p) => p - 1);
      }
    },
    [session, companyId, client, notify, invalidate],
  );
  const downloadExpenseReceipt = useCallback(
    async (attachment: Attachment) => {
      if (!session) return;
      try {
        const blob =
          MODE === 'demo'
            ? await demoDownloadExpenseReceipt(companyId, session.user.id, attachment)
            : await fetchExpenseReceipt(companyId, attachment.id);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = attachment.fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) {
        setError((e as Error).message);
        throw e;
      }
    },
    [session, companyId],
  );
  const resetDemo = useCallback(async () => {
    if (MODE !== 'demo') throw new Error('Demo reset is unavailable in the server edition.');
    const next = await resetDemoData();
    client.clear();
    applySession(next);
    setCompanyId(next.companies[0].id);
    setError('');
    notify('Sample workspace reset.');
  }, [client, applySession, notify]);
  const value = useMemo<WorkspaceStore>(
    () => ({
      mode: MODE,
      session,
      data: accessDenied ? null : scopedData,
      companyId,
      loading: authLoading || workspace.isLoading || (MODE === 'api' && authorized && !scopedData),
      saving: pending > 0,
      error,
      toast,
      login,
      logout,
      switchCompany,
      refresh,
      mutate,
      upload,
      downloadAttachment,
      uploadExpenseReceipt,
      downloadExpenseReceipt,
      notify,
      clearError,
      resetDemo,
    }),
    [
      session,
      scopedData,
      authorized,
      workspace.data,
      accessDenied,
      workspace.isLoading,
      companyId,
      authLoading,
      pending,
      error,
      toast,
      login,
      logout,
      switchCompany,
      refresh,
      mutate,
      upload,
      downloadAttachment,
      uploadExpenseReceipt,
      downloadExpenseReceipt,
      notify,
      clearError,
      resetDemo,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <Store>{children}</Store>
    </QueryClientProvider>
  );
}
export function useWorkspace(): WorkspaceStore {
  const value = useContext(Ctx);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider.');
  return value;
}

// Details are independent read scopes. Mounting must reauthorize before a cached
// record can be displayed, including when returning to the same company/role.
export function useTaskDetail(id: string) {
  const store = useWorkspace();
  const data = store.data;
  const result = useQuery({
    queryKey: [
      'workspace',
      store.mode,
      store.session?.user.id ?? '',
      store.companyId,
      'task:' + id,
      data?.readBasis,
      data?.me.role,
      data?.me.departmentId,
    ],
    enabled: store.mode === 'api' && !!data && id !== '' && id !== 'new',
    staleTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      readDetail<{ task: Task; people?: Person[] }>(
        `/companies/${encodeURIComponent(store.companyId)}/tasks/${encodeURIComponent(id)}`,
        'task',
        signal,
      ),
  });
  return {
    task:
      store.mode === 'demo'
        ? data?.tasks.find((t) => t.id === id)
        : result.isFetchedAfterMount && !result.isError
          ? result.data?.task
          : undefined,
    loading:
      store.mode === 'api' && id !== 'new' && (!result.isFetchedAfterMount || result.isPending),
    people: result.isFetchedAfterMount && !result.isError ? (result.data?.people ?? []) : [],
    error: result.error?.message ?? '',
  };
}
export function useExpenseDetail(id: string) {
  const store = useWorkspace();
  const data = store.data;
  const result = useQuery({
    queryKey: [
      'workspace',
      store.mode,
      store.session?.user.id ?? '',
      store.companyId,
      'expense:' + id,
      data?.readBasis,
      data?.me.role,
      data?.me.departmentId,
    ],
    enabled: store.mode === 'api' && !!data && !!id,
    staleTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      readDetail<{ expense: Expense; people?: Person[]; financeEvents: FinanceEvent[] }>(
        `/companies/${encodeURIComponent(store.companyId)}/expenses/${encodeURIComponent(id)}`,
        'expense',
        signal,
      ),
  });
  return {
    expense:
      store.mode === 'demo'
        ? data?.expenses.find((t) => t.id === id)
        : result.isFetchedAfterMount && !result.isError
          ? result.data?.expense
          : undefined,
    loading: store.mode === 'api' && (!result.isFetchedAfterMount || result.isPending),
    people: result.isFetchedAfterMount && !result.isError ? (result.data?.people ?? []) : [],
    error: result.error?.message ?? '',
  };
}
