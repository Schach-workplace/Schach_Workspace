// @vitest-environment happy-dom
import { useState } from 'react';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi, afterEach, beforeEach } from 'vitest';
import { useExecutionRead, useExecutionMutation } from './execution';
const state = vi.hoisted(() => ({ mutate: vi.fn(), company: 'c' }));
vi.mock('../store', () => ({
  useWorkspace: () => ({
    mode: 'api',
    companyId: state.company,
    session: { user: { id: 'u' } },
    data: { readBasis: 'unchanged' },
    mutate: state.mutate,
  }),
}));
import { clearAllBusinessAttempts } from '../../../shared/business/attempts';
import { ApiError } from './api';
import { useExecutionInput } from './executionInput';
import { clearAllDrafts } from '../communication/drafts';
beforeEach(() => {
  clearAllBusinessAttempts();
  clearAllDrafts();
  state.mutate.mockReset();
  state.company = 'c';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('hides fetched source during same-basis reauthorization and after audience revocation', async () => {
  let denied = false;
  let release!: () => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (denied) {
        await new Promise<void>((r) => (release = r));
        return new Response(
          JSON.stringify({ error: { message: 'Source unavailable', code: 'not_found' } }),
          { status: 404 },
        );
      }
      return new Response(JSON.stringify({ title: 'Previously authorized template' }), {
        status: 200,
      });
    }),
  );
  function Probe() {
    const q = useExecutionRead<{ title: string }>('/task-templates/source');
    return (
      <>
        {q.data && <p>{q.data.title}</p>}
        {q.error && <p>Unavailable</p>}
      </>
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Probe />
    </QueryClientProvider>,
  );
  await screen.findByText('Previously authorized template');
  denied = true;
  window.dispatchEvent(
    new CustomEvent('schach-work-event', {
      detail: { company: 'c', user: 'u', kind: 'policy_changed' },
    }),
  );
  await waitFor(() => expect(screen.queryByText('Previously authorized template')).toBeNull());
  release();
  await screen.findByText('Unavailable');
  expect(screen.queryByText('Previously authorized template')).toBeNull();
});

it.each([409, 422])(
  'requires deliberate warned reconciliation after HTTP%s and permits a corrected new action',
  async (status) => {
    state.mutate
      .mockRejectedValueOnce(new ApiError('Inspect and correct', status, 'rejected'))
      .mockResolvedValue({ id: 'saved' });
    function Probe() {
      const a = useExecutionMutation('recover');
      return (
        <>
          <button
            disabled={!!a.attempt}
            onClick={() =>
              void a
                .execute('/task-templates/t', { version: 1, name: 'Original' }, 'PATCH')
                .catch(() => {})
            }
          >
            Save original
          </button>
          {a.attempt && <p>Prior result may exist. Inspect before abandoning.</p>}
          {'abandon' in a && a.attempt && (
            <button onClick={() => (a as any).abandon()}>Abandon after inspection</button>
          )}
          <button
            disabled={!!a.attempt}
            onClick={() =>
              void a
                .execute('/task-templates/t', { version: 2, name: 'Corrected' }, 'PATCH')
                .catch(() => {})
            }
          >
            Save corrected
          </button>
        </>
      );
    }
    render(<Probe />);
    fireEvent.click(screen.getByText('Save original'));
    await screen.findByText(/Prior result may exist/);
    const first = state.mutate.mock.calls[0][1];
    expect(screen.getByText('Save corrected').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByText('Abandon after inspection'));
    fireEvent.click(screen.getByText('Save corrected'));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(2));
    expect(state.mutate.mock.calls[1][1]).toMatchObject({ version: 2, name: 'Corrected' });
    expect(state.mutate.mock.calls[1][1].retryKey).not.toBe(first.retryKey);
  },
);
it('rejects changed displayed intent or target instead of silently replaying a different frozen request', async () => {
  state.mutate.mockRejectedValue(Error('Lost acknowledgement'));
  function Probe() {
    const a = useExecutionMutation('identity');
    return (
      <>
        <button
          onClick={() =>
            void a
              .execute('/task-schedule/apply', { proposalId: 'old', expectedProposalVersion: 1 })
              .catch(() => {})
          }
        >
          Original
        </button>
        <button
          onClick={() =>
            void a
              .execute('/task-schedule/apply', { proposalId: 'new', expectedProposalVersion: 1 })
              .catch(() => {})
          }
        >
          Changed
        </button>
        <button
          onClick={() =>
            void a
              .execute('/different-target', { proposalId: 'old', expectedProposalVersion: 1 })
              .catch(() => {})
          }
        >
          Other target
        </button>
        <p>{a.error}</p>
      </>
    );
  }
  render(<Probe />);
  fireEvent.click(screen.getByText('Original'));
  await screen.findByText('Lost acknowledgement');
  fireEvent.click(screen.getByText('Changed'));
  await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByText('Other target'));
  await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(1));
});
it('merges and deduplicates later-page graph nodes, edges and paths', async () => {
  const pages = [
    {
      nodes: [{ id: 'a' }],
      edges: [{ from: 'a', to: 'b' }],
      paths: [['a', 'b']],
      nextCursor: 'next',
    },
    {
      nodes: [{ id: 'b' }],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
      paths: [
        ['a', 'b'],
        ['b', 'c'],
      ],
      nextCursor: '',
    },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(pages.shift()), { status: 200 })),
  );
  const { executionRead } = await import('./execution');
  const graph = await executionRead<any>('api', 'c', 'u', '/tasks/a/impact');
  expect(graph.nodes).toHaveLength(2);
  expect(graph.edges).toEqual([
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ]);
  expect(graph.paths).toEqual([
    ['a', 'b'],
    ['b', 'c'],
  ]);
});
it('retires a known successful canonical result before a later refresh failure', async () => {
  state.mutate.mockImplementation(async (_p, _b, _m, committed) => {
    committed({ id: 'known' });
    throw Error('Later refresh unavailable');
  });
  function Probe() {
    const a = useExecutionMutation('known');
    const [result, setResult] = useState('');
    return (
      <>
        <button
          onClick={() =>
            void a
              .execute('/task-templates', { name: 'Known' })
              .then((r) => setResult(String(r.id)))
              .catch(() => setResult('failed'))
          }
        >
          Save
        </button>
        <p>{result}</p>
        <p>{a.attempt ? 'frozen' : 'retired'}</p>
      </>
    );
  }
  render(<Probe />);
  fireEvent.click(screen.getByText('Save'));
  await screen.findByText('known');
  expect(screen.getByText('retired')).toBeTruthy();
});
it('purges authored existing milestone RAM and its frozen decision when the parent project is denied', async () => {
  let denied = false;
  state.mutate.mockRejectedValue(Error('Lost response'));
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify(
            denied
              ? { error: { message: 'Project unavailable', code: 'not_found' } }
              : { project: { id: 'p' } },
          ),
          { status: denied ? 404 : 200 },
        ),
    ),
  );
  function Probe() {
    const q = useExecutionRead('/projects/p');
    const [, setSelected] = useExecutionInput('$project:p', 'selected', '');
    const [title, setTitle] = useExecutionInput('$milestone:m', 'title', '');
    const a = useExecutionMutation('milestone-transition:m', ['/projects/p']);
    return (
      <>
        <button
          onClick={() => {
            setSelected('m');
            setTitle('Authored milestone');
            void a
              .execute('/project-milestones/m/transition', {
                action: 'request_changes',
                version: 2,
              })
              .catch(() => {});
          }}
        >
          Submit
        </button>
        <p>{title || 'empty authored form'}</p>
        <p>{a.attempt ? 'frozen' : 'retired'}</p>
        <p>{q.denied ? 'denied' : 'authorized'}</p>
      </>
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Probe />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText('Submit'));
  await screen.findByText('frozen');
  denied = true;
  window.dispatchEvent(
    new CustomEvent('schach-work-event', { detail: { company: 'c', user: 'u' } }),
  );
  await screen.findByText('denied');
  await screen.findByText('retired');
  expect(screen.getByText('empty authored form')).toBeTruthy();
});
it('keeps a delayed known commit from invoking current-flow callbacks after a company switch', async () => {
  let release!: () => void;
  const committed = vi.fn();
  state.mutate.mockImplementation(async (_p, _b, _m, ack) => {
    await new Promise<void>((r) => (release = r));
    ack({ id: 'old-company-result' });
    return { id: 'old-company-result' };
  });
  function Probe() {
    const a = useExecutionMutation('delayed');
    const [result, setResult] = useState('');
    return (
      <>
        <button
          onClick={() =>
            void a
              .execute('/task-templates', { name: 'Original' }, 'POST', committed)
              .then(() => setResult('opened stale result'))
              .catch(() => setResult('Company changed'))
          }
        >
          Save delayed
        </button>
        <p>{result}</p>
      </>
    );
  }
  const v = render(<Probe />);
  fireEvent.click(screen.getByText('Save delayed'));
  state.company = 'other';
  v.rerender(<Probe />);
  release();
  await screen.findByText('Company changed');
  expect(committed).not.toHaveBeenCalled();
});

it('drops a late canonical ACK after a hard reset before callback or returned IDs', async () => {
  let resolve!: (value: { id: string }) => void;
  let acknowledge!: (value: { id: string }) => void;
  const saved = vi.fn(),
    returned = vi.fn();
  state.mutate.mockImplementation((_path, _body, _method, callback) => {
    acknowledge = callback;
    return new Promise((r) => {
      resolve = r;
    });
  });
  function Probe() {
    const action = useExecutionMutation('late-ack');
    return (
      <button
        onClick={() =>
          void action
            .execute(
              '/people/onboarding/apply',
              { previewId: 'p', expectedPreviewVersion: 1, password: 'fictional-only' },
              'POST',
              saved,
            )
            .then(returned)
            .catch(() => {})
        }
      >
        Submit
      </button>
    );
  }
  render(<Probe />);
  fireEvent.click(screen.getByText('Submit'));
  await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(1));
  clearAllBusinessAttempts();
  acknowledge({ id: 'must-not-disclose' });
  resolve({ id: 'must-not-disclose' });
  await new Promise((r) => setTimeout(r, 0));
  expect(saved).not.toHaveBeenCalled();
  expect(returned).not.toHaveBeenCalled();
});
