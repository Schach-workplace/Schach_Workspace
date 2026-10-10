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
