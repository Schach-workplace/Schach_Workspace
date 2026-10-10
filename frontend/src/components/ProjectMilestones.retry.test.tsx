// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import Projects from '../pages/Projects';
import sample from '../data/sample.json';
import { clearAllBusinessAttempts } from '../../../shared/business/attempts';
import { clearAllDrafts } from '../communication/drafts';
const s = vi.hoisted(() => ({ store: {} as any }));
vi.mock('../store', () => ({ useWorkspace: () => s.store }));
const project = {
  ...sample.workspaces[0].projects[0],
  version: 1,
  taskOwnerPolicy: 'actor',
  defaultTaskOwnerId: '',
  defaultReviewerId: '',
  defaultRequiresApproval: false,
};
beforeEach(() => {
  clearAllDrafts();
  clearAllBusinessAttempts();
  s.store = {
    data: {
      ...sample.workspaces[0],
      tasks: [{ ...sample.workspaces[0].tasks[0], projectId: project.id }],
    },
    mode: 'api',
    companyId: sample.workspaces[0].company.id,
    session: { user: { id: sample.workspaces[0].me.id } },
    mutate: vi.fn().mockRejectedValue(Error('Lost milestone response')),
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('restores authored project milestone fields/basis and reachable frozen retry after source recheck unmount and drawer remount', async () => {
  let pause = false,
    denied = false,
    release!: () => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/projects/' + project.id)) {
        if (pause) await new Promise<void>((r) => (release = r));
        if (denied)
          return new Response(
            JSON.stringify({ error: { message: 'Project unavailable', code: 'not_found' } }),
            { status: 404 },
          );
        return new Response(
          JSON.stringify({ project, canEdit: true, summary: { total: 1, accepted: 0 } }),
        );
      }
      return new Response(JSON.stringify({ milestones: [] }));
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => (
    <QueryClientProvider client={qc}>
      <Projects selectedId={project.id} onSelect={() => {}} onTask={() => {}} />
    </QueryClientProvider>
  );
  let v = render(view());
  fireEvent.click(await screen.findByText('New project milestone'));
  fireEvent.change(screen.getByLabelText('Milestone title'), {
    target: { value: 'Authored release' },
  });
  fireEvent.change(screen.getByLabelText('Acceptance criteria, one per line'), {
    target: { value: 'Inspect release' },
  });
  const reviewer = s.store.data.people.find(
    (p: any) => p.active && p.role !== 'viewer' && p.id !== s.store.data.me.id,
  )!;
  fireEvent.change(screen.getByLabelText('Independent milestone reviewer'), {
    target: { value: reviewer.id },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(s.store.data.tasks[0].title) }));
  fireEvent.click(screen.getByText('Save milestone criteria'));
  await screen.findByText('Lost milestone response');
  const original = s.store.mutate.mock.calls[0][1];
  pause = true;
  await act(() => {
    window.dispatchEvent(
      new CustomEvent('schach-work-event', {
        detail: { company: s.store.companyId, user: s.store.session.user.id },
      }),
    );
  });
  await waitFor(() => expect(screen.queryByRole('heading', { name: project.name })).toBeNull());
  release();
  pause = false;
  await screen.findByRole('heading', { name: project.name });
  expect((screen.getByLabelText('Milestone title') as HTMLInputElement).value).toBe(
    'Authored release',
  );
  v.unmount();
  v = render(view());
  await screen.findByText('Retry same milestone save');
  fireEvent.click(screen.getByText('Retry same milestone save'));
  await waitFor(() => expect(s.store.mutate).toHaveBeenCalledTimes(2));
  expect(s.store.mutate.mock.calls[1][1]).toEqual(original);
  denied = true;
  await act(() =>
    window.dispatchEvent(
      new CustomEvent('schach-work-event', {
        detail: { company: s.store.companyId, user: s.store.session.user.id },
      }),
    ),
  );
  await waitFor(() => expect(screen.queryByLabelText('Milestone title')).toBeNull());
  await waitFor(() =>
    expect(
      qc
        .getQueryCache()
        .findAll()
        .some((q) => q.state.error),
    ).toBe(true),
  );
  denied = false;
  await act(() => qc.invalidateQueries());
  fireEvent.click(await screen.findByText('New project milestone'));
  expect((screen.getByLabelText('Milestone title') as HTMLInputElement).value).toBe('');
  expect(screen.queryByText('Retry same milestone save')).toBeNull();
});
