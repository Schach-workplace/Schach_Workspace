// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import sample from './data/sample.json';
import { WorkspaceProvider, useWorkspace } from './store';
import type { WorkspaceData } from './types';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});
it('withholds a cached manager list after the membership graph read basis changes', async () => {
  const data = structuredClone(sample.workspaces[0]) as WorkspaceData;
  data.me.role = 'manager';
  data.tasks = [{ ...data.tasks[0], title: 'Previously authorized subordinate task' }];
  let basis = 'one';
  let pause = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const path = String(input);
      let value: unknown;
      if (path.endsWith('/auth/session'))
        value = {
          user: { id: data.me.id, name: data.me.name, email: data.me.email },
          companies: [data.company],
        };
      else if (path.endsWith('/bootstrap'))
        value = { ...data, tasks: [], expenses: [], financeEvents: [], readBasis: basis };
      else if (path.includes('/tasks?')) {
        if (pause) return new Promise<Response>(() => {});
        value = { tasks: data.tasks, cursor: '', hasMore: false };
      } else if (path.includes('/expenses?')) value = { expenses: [], cursor: '', hasMore: false };
      else value = { financeEvents: [] };
      return new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  function Probe() {
    const w = useWorkspace();
    return (
      <>
        <button onClick={() => void w.refresh()}>Refresh scope</button>
        {w.data?.tasks.map((t) => (
          <p key={t.id}>{t.title}</p>
        ))}
      </>
    );
  }
  render(
    <WorkspaceProvider>
      <Probe />
    </WorkspaceProvider>,
  );
  await screen.findByText('Previously authorized subordinate task');
  basis = 'two';
  pause = true;
  fireEvent.click(screen.getByText('Refresh scope'));
  await waitFor(() =>
    expect(screen.queryByText('Previously authorized subordinate task')).toBeNull(),
  );
});

it('preserves only a frozen canonical unknown request through a graph-only refresh', async () => {
  const { beginAttempt, readAttempt, clearAllBusinessAttempts } =
    await import('../../shared/business/attempts');
  clearAllBusinessAttempts();
  const data = structuredClone(sample.workspaces[0]) as WorkspaceData;
  data.company.id = 'graph-test-company';
  data.me.id = 'graph-test-actor';
  data.me.memberAccessEpoch = 7;
  let basis = 'graph-a';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const path = String(input);
      const value = path.endsWith('/auth/session')
        ? {
            user: { id: data.me.id, name: data.me.name, email: data.me.email },
            companies: [data.company],
          }
        : path.endsWith('/bootstrap')
          ? { ...data, readBasis: basis, tasks: [], expenses: [], financeEvents: [] }
          : path.includes('/tasks?')
            ? { tasks: [], cursor: '', hasMore: false }
            : path.includes('/expenses?')
              ? { expenses: [], cursor: '', hasMore: false }
              : { financeEvents: [] };
      return new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  function Probe() {
    const w = useWorkspace();
    return (
      <>
        <button onClick={() => void w.refresh()}>Refresh graph</button>
        <p>{w.data?.readBasis}</p>
      </>
    );
  }
  render(
    <WorkspaceProvider>
      <Probe />
    </WorkspaceProvider>,
  );
  await screen.findByText('graph-a');
  const scope = {
    serverOrigin: window.location.origin + ':api',
    companyId: data.company.id,
    userId: data.me.id,
    formId: 'unknown-graph',
  };
  const original = beginAttempt(
    scope,
    { previewId: 'p', expectedPreviewVersion: 1, password: 'fictional-only' },
    'frozen',
    { path: '/people/onboarding/apply', method: 'POST', canonical: true },
    data.me,
  );
  basis = 'graph-b';
  fireEvent.click(screen.getByText('Refresh graph'));
  await screen.findByText('graph-b');
  expect(readAttempt(scope)).toBe(original);
  data.me.memberAccessEpoch = 8;
  basis = 'graph-c';
  fireEvent.click(screen.getByText('Refresh graph'));
  await screen.findByText('graph-c');
  expect(readAttempt(scope)).toBeUndefined();
  clearAllBusinessAttempts();
});

it('finishes unauthenticated startup after the initial session401', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: 'unauthenticated', message: 'Sign in required.' } }),
          { status: 401 },
        ),
    ),
  );
  function Probe() {
    const w = useWorkspace();
    return <p>{w.loading ? 'Checking session' : w.session ? 'Signed in' : 'Ready to sign in'}</p>;
  }
  render(
    <WorkspaceProvider>
      <Probe />
    </WorkspaceProvider>,
  );
  await screen.findByText('Ready to sign in');
});
