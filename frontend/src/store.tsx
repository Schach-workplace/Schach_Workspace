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
import type { Attachment, MutationResult, Session, WorkspaceData, WorkspaceStore } from './types';
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
  const workspace = useQuery({
    queryKey: key,
    enabled: !!session && !!companyId && !deniedCompanies.includes(companyId),
    retry: (count, error) =>
      !(error instanceof ApiError && [401, 403].includes(error.status)) && count < 1,
    queryFn: ({ signal }) =>
      MODE === 'demo'
        ? readDemoWorkspace(companyId, session!.user.id)
        : request<WorkspaceData>(`/companies/${encodeURIComponent(companyId)}/workspace`, {
            signal,
          }),
    refetchInterval: MODE === 'api' ? 30_000 : false,
  });
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
      void client.cancelQueries({ queryKey: ['workspace', MODE, userId, denied], exact: true });
      client.removeQueries({ queryKey: ['workspace', MODE, userId, denied], exact: true });
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
            : await request<Session>('/auth/login', { method: 'POST', body: { email, password, code, recoveryCode } });
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
        await client.invalidateQueries({
          queryKey: ['workspace', MODE, targetUser, targetCompany],
        });
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
    [session, companyId, client, refreshSession, notify],
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
        await client.invalidateQueries({ queryKey: ['workspace', MODE, session.user.id, target] });
        notify('Evidence attached.');
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setPending((p) => p - 1);
      }
    },
    [session, companyId, client, notify],
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
        await client.invalidateQueries({ queryKey: ['workspace', MODE, session.user.id, target] });
        notify('Receipt attached.');
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setPending((p) => p - 1);
      }
    },
    [session, companyId, client, notify],
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
      data: accessDenied ? null : (workspace.data ?? null),
      companyId,
      loading: authLoading || workspace.isLoading,
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
