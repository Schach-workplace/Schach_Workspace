// @vitest-environment happy-dom
import { useLayoutEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceProvider, useWorkspace } from '../store';
import { ReportsPage } from './GoalsReports';
import IntelligencePanel from '../components/IntelligencePanel';
import sample from '../data/sample.json';
import { clearAllBusinessAttempts } from '../../../shared/business/attempts';
import { clearAllDrafts } from '../communication/drafts';

// Actual store, task/report queries, launcher, Modal, panel and job readers.
// The only substitute is HTTP; a changed task version comes from Store.refresh.
let workspace: ReturnType<typeof useWorkspace>, queries: QueryClient;
let data: (typeof sample.workspaces)[number], holdReport: boolean, holdRaw: boolean;
let reportWaiters: ((r: Response) => void)[], rawWaiters: ((r: Response) => void)[];
let enqueues: any[], job: any, snapshot: string;
let holdPreview: boolean, reportDenied: boolean;
let previewWaiters: ((r: Response) => void)[];
let inspections: any[], reportSequence: number, latestSnapshot: string;
let originalProof: 'current' | 'hash' | 'policy' | 'source' | 'expired' | 'removed' | 'acl';
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const preview = {
  selectionHash: 'selection-one',
  policyVersion: 1,
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  sources: [{ label: 'Inspected original report facts' }],
};
const originalJob = {
  jobId: 'job',
  state: 'running',
  operation: 'report_explanation',
  sourceSetHash: 'original-report',
  sources: [
    {
      sourceKey: 'report',
      kind: 'report_current',
      id: 'snapshot-one',
      label: 'Original report citation',
    },
  ],
};
function Probe({ privateFlow = false }: { privateFlow?: boolean }) {
  const w = useWorkspace(),
    q = useQueryClient();
  useLayoutEffect(() => {
    workspace = w;
    queries = q;
  });
  return w.data ? (
    privateFlow ? (
      <IntelligencePanel initialJob="job" />
    ) : (
      <ReportsPage onTask={() => {}} />
    )
  ) : (
    <p>Authorizing workspace</p>
  );
}
const summary = () => ({
  snapshot: (latestSnapshot =
    ++reportSequence === 1 ? snapshot : `${snapshot}-nonce-${reportSequence}`),
  generatedAt: '2026-10-12T06:00:00Z',
  timezone: 'Asia/Kolkata',
  basis: 'snapshot_current_state',
});
function selectedPreview(body: any) {
  if (body.sources[0]?.id !== 'snapshot-one')
    return response({
      ...preview,
      selectionHash: body.sources[0]?.id,
      sources: [{ label: 'Inspected latest report facts' }],
    });
  if (['source', 'expired', 'removed', 'acl'].includes(originalProof))
    return new Response(
      JSON.stringify({
        error: { code: 'source_unavailable', message: 'Selected report unavailable' },
      }),
      { status: originalProof === 'removed' ? 404 : originalProof === 'acl' ? 403 : 409 },
    );
  return response({
    ...preview,
    selectionHash: originalProof === 'hash' ? 'changed-selection' : preview.selectionHash,
    policyVersion: originalProof === 'policy' ? 2 : preview.policyVersion,
  });
}
beforeEach(() => {
  clearAllBusinessAttempts();
  clearAllDrafts();
  localStorage.clear();
  window.location.hash = '';
  data = structuredClone(sample.workspaces[0]);
  data.tasks = data.tasks.slice(0, 1);
  snapshot = 'snapshot-one';
  reportSequence = 0;
  originalProof = 'current';
  inspections = [];
  holdReport = holdRaw = false;
  reportWaiters = [];
  rawWaiters = [];
  enqueues = [];
  holdPreview = reportDenied = false;
  previewWaiters = [];
  job = structuredClone(originalJob);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/auth/session'))
        return response({
          user: { id: data.me.id, name: data.me.name },
          companies: [{ id: data.company.id, name: data.company.name }],
        });
      if (path.endsWith('/bootstrap')) return response(data);
      if (path.includes('/reports/tasks/summary?')) {
        if (reportDenied)
          return new Response(
            JSON.stringify({ error: { code: 'forbidden', message: 'Report access changed' } }),
            { status: 403 },
          );
        return holdReport
          ? new Promise<Response>((r) => reportWaiters.push(r))
          : response(summary());
      }
      if (path.includes('/reports/tasks/rows?'))
        return response({ tasks: data.tasks, cursor: '', hasMore: false });
      if (path.includes('/tasks?'))
        return response({ tasks: data.tasks, cursor: '', hasMore: false });
      if (path.includes('/expenses?'))
        return response({ expenses: [], cursor: '', hasMore: false });
      if (path.endsWith('/finance/events')) return response({ financeEvents: [] });
      if (path.endsWith('/intelligence/capabilities'))
        return response({ operations: { report_explanation: true } });
      if (path.endsWith('/selection-preview')) {
        const body = JSON.parse(String(init?.body));
        inspections.push(body);
        return holdPreview
          ? new Promise<Response>((r) => previewWaiters.push(r))
          : selectedPreview(body);
      }
      if (path.endsWith('/intelligence/jobs') && init?.method === 'POST') {
        enqueues.push(JSON.parse(String(init.body)));
        return response({ jobId: 'job' });
      }
      if (path.endsWith('/intelligence/jobs')) return response({ jobs: [] });
      if (path.endsWith('/intelligence/jobs/job'))
        return holdRaw ? new Promise<Response>((r) => rawWaiters.push(r)) : response(job);
      throw Error('Unexpected synthetic route: ' + path);
    }),
  );
});

it.each(
  [
    'source',
    'hash',
    'proofPolicy',
    'expired',
    'removed',
    'acl',
    'basis',
    'selection',
    'denial',
    'hard',
    'unmount',
    'notification',
  ].flatMap((change) => [false, true].map((error) => ({ change, error }))),
)(
  'N2 web: actual $change retires late report inspection (error=$error)',
  async ({ change, error }) => {
    await inspect();
    holdPreview = true;
    fireEvent.click(screen.getByRole('button', { name: 'Review selected sources' }));
    await waitFor(() => expect(previewWaiters).toHaveLength(1));
    if (['source', 'hash', 'proofPolicy', 'expired', 'removed', 'acl', 'basis'].includes(change)) {
      if (change !== 'basis') {
        snapshot = 'changed-report';
        data.tasks[0].version++;
        originalProof = (change === 'proofPolicy' ? 'policy' : change) as typeof originalProof;
        holdPreview = false;
      } else (data as any).readBasis = 'changed-authority';
      await act(async () => {
        void workspace.refresh();
      });
      await waitFor(() => expect(screen.queryByText('Inspected original report facts')).toBeNull());
      if (change === 'hash' || change === 'proofPolicy')
        await waitFor(() =>
          expect(
            (screen.getByRole('button', { name: 'Review selected sources' }) as HTMLButtonElement)
              .disabled,
          ).toBe(false),
        );
    }
    if (change === 'selection')
      fireEvent.change(screen.getByLabelText('Operation'), { target: { value: 'summary' } });
    if (change === 'denial') {
      reportDenied = true;
      await act(async () => {
        void queries.refetchQueries({ queryKey: ['task-report'], type: 'active' });
      });
      await waitFor(() => expect(screen.queryByText('Inspected original report facts')).toBeNull());
    }
    if (change === 'hard') act(() => clearAllBusinessAttempts());
    if (change === 'notification') {
      // The late manual response is obsolete. The event's separate current
      // source-proof read succeeds, so Review must become usable again.
      holdPreview = false;
      await act(async () =>
        window.dispatchEvent(
          new CustomEvent('schach-work-event', {
            detail: { company: data.company.id, user: data.me.id, kind: 'task_updated' },
          }),
        ),
      );
    }
    if (change === 'unmount') cleanup();
    await act(async () =>
      previewWaiters
        .splice(0)
        .forEach((r) =>
          r(
            error
              ? new Response(
                  JSON.stringify({ error: { message: 'Obsolete inspection failure' } }),
                  { status: 500 },
                )
              : response(preview),
          ),
        ),
    );
    expect(screen.queryByText('Inspected original report facts')).toBeNull();
    expect(screen.queryByText('Obsolete inspection failure')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Generate local result' })).toBeNull();
    expect(enqueues).toHaveLength(0);
    if (change === 'notification')
      await waitFor(() =>
        expect(
          (screen.getByRole('button', { name: 'Review selected sources' }) as HTMLButtonElement)
            .disabled,
        ).toBe(false),
      );
  },
);

it('N2b web counterpart: first private anchor selector remains mounted under actual raw-job pending', async () => {
  job = {
    jobId: 'job',
    state: 'ready',
    resultHash: 'result',
    sourceSetHash: 'private-set',
    sources: [
      {
        sourceKey: 'private',
        kind: 'record',
        id: 'record',
        revision: 1,
        label: 'Private source label',
      },
    ],
    publication: {
      allowed: true,
      conversationId: 'conversation',
      policyVersion: 2,
      sources: [{ messageId: 'message', revision: 1 }],
    },
    result: {
      operation: 'action_draft',
      sourceSetHash: 'private-set',
      limitations: [],
      candidates: [
        {
          kind: 'expense',
          title: 'Generated expense',
          description: 'Private generated suggestion',
          sourceKeys: ['private'],
          unresolved: [],
        },
      ],
    },
  };
  render(
    <WorkspaceProvider>
      <Probe privateFlow />
    </WorkspaceProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Review expense draft' }));
  const anchor = screen.getByLabelText('Source anchor') as HTMLSelectElement;
  anchor.focus();
  holdRaw = true;
  fireEvent.click(screen.getByRole('button', { name: 'Recheck current result' }));
  await waitFor(() => expect(rawWaiters.length).toBeGreaterThan(0));
  expect(screen.queryByLabelText('Source anchor')).toBe(anchor);
  expect(anchor.disabled).toBe(true);
  expect(anchor.textContent).not.toContain('Selected message 1');
  expect(screen.queryByText('Private generated suggestion')).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Preview content and audience' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  holdRaw = false;
  await act(async () => rawWaiters.splice(0).forEach((r) => r(response(job))));
  await waitFor(() => expect(anchor.disabled).toBe(false));
  expect(screen.getByLabelText('Source anchor')).toBe(anchor);
  expect(anchor.value).toBe('');
  expect(anchor.textContent).toContain('Selected message 1');
  expect(enqueues).toHaveLength(0);
  // Equivalent current proof retains the element; genuinely changed binding
  // and a standalone hard clear each retire its interaction owner.
  job.publication.sources[0].revision = 2;
  fireEvent.click(screen.getByRole('button', { name: 'Recheck current result' }));
  await waitFor(() => expect(anchor.isConnected).toBe(false));
  const replacement = await screen.findByLabelText('Source anchor');
  expect(replacement.textContent).toContain('revision 2');
  act(() => clearAllBusinessAttempts());
  expect(replacement.isConnected).toBe(false);
});
afterEach(() => {
  cleanup();
  queries?.clear();
  vi.unstubAllGlobals();
  clearAllBusinessAttempts();
  clearAllDrafts();
});
async function inspect() {
  render(
    <WorkspaceProvider>
      <Probe />
    </WorkspaceProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Local assistance' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Selected current report facts' }));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Review selected sources' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Review selected sources' }));
  const consent = await screen.findByRole('checkbox', { name: /I agree to process/ });
  expect(
    (screen.getByRole('button', { name: 'Generate local result' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(consent);
}
async function releaseReport() {
  holdReport = false;
  await act(async () => reportWaiters.splice(0).forEach((r) => r(response(summary()))));
}
it('N2 web counterpart: same-query pending withholds inspected choices while retaining consent and Modal', async () => {
  await inspect();
  const modal = screen.getByRole('dialog');
  holdReport = true;
  await act(async () => {
    void queries.refetchQueries({ queryKey: ['task-report'], type: 'active' });
  });
  await waitFor(() => expect(reportWaiters.length).toBeGreaterThan(0));
  expect(screen.getByRole('dialog')).toBe(modal);
  expect(screen.queryByText('Inspected original report facts')).toBeNull();
  expect(screen.queryByRole('checkbox', { name: 'Selected current report facts' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Generate local result' })).toBeNull();
  await releaseReport();
  const consent = await screen.findByRole('checkbox', { name: /I agree to process/ });
  expect((consent as HTMLInputElement).checked).toBe(true);
  expect(screen.getByRole('dialog')).toBe(modal);
  expect(enqueues).toHaveLength(0);
});

it('N2 web: rotating latest report handles reauthorize the same human-selected snapshot', async () => {
  await inspect();
  const modal = screen.getByRole('dialog');
  holdReport = true;
  await act(async () => {
    void queries.refetchQueries({ queryKey: ['task-report'], type: 'active' });
  });
  await waitFor(() => expect(reportWaiters.length).toBeGreaterThan(0));
  const before = inspections.length;
  holdPreview = true;
  await releaseReport();
  await waitFor(() => expect(inspections.length).toBeGreaterThan(before));
  expect(latestSnapshot).not.toBe('snapshot-one');
  expect(screen.queryByText('Inspected original report facts')).toBeNull();
  expect(screen.queryByRole('checkbox', { name: 'Selected report facts' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Generate local result' })).toBeNull();
  expect(inspections.at(-1).sources).toEqual([
    { kind: 'report_current', id: 'snapshot-one', selectedFieldSet: 'metrics' },
  ]);
  holdPreview = false;
  await act(async () => previewWaiters.splice(0).forEach((r) => r(response(preview))));
  await waitFor(() =>
    expect(
      (screen.queryByRole('button', { name: 'Generate local result' }) as HTMLButtonElement)
        ?.disabled,
    ).toBe(false),
  );
  expect(screen.getByRole('dialog')).toBe(modal);
  fireEvent.click(screen.getByRole('button', { name: 'Generate local result' }));
  await screen.findByText('running');
  expect(enqueues).toHaveLength(1);
  expect(enqueues[0].sources).toEqual([
    { kind: 'report_current', id: 'snapshot-one', selectedFieldSet: 'metrics' },
  ]);
});
it.each(['hash', 'policy', 'expired', 'removed', 'acl'] as const)(
  'N2 web: exact original %s change requires renewed explicit latest selection and inspection',
  async (change) => {
    await inspect();
    const modal = screen.getByRole('dialog');
    holdReport = true;
    await act(async () => {
      void queries.refetchQueries({ queryKey: ['task-report'], type: 'active' });
    });
    await waitFor(() => expect(reportWaiters.length).toBeGreaterThan(0));
    originalProof = change;
    await releaseReport();
    await waitFor(() => expect(inspections.length).toBeGreaterThan(2));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Generate local result' })).toBeNull(),
    );
    expect(screen.getByRole('dialog')).toBe(modal);
    expect(screen.queryByText('Inspected original report facts')).toBeNull();
    expect(inspections.at(-1).sources[0].id).toBe('snapshot-one');
    fireEvent.click(screen.getByRole('button', { name: 'Choose latest report facts' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Review selected sources' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(screen.queryByRole('button', { name: 'Generate local result' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review selected sources' }));
    await screen.findByText('Inspected latest report facts');
    expect(inspections.at(-1).sources[0].id).toBe(latestSnapshot);
    const consent = screen.getByRole('checkbox', {
      name: /I agree to process/,
    }) as HTMLInputElement;
    expect(consent.checked).toBe(false);
    expect(
      (screen.getByRole('button', { name: 'Generate local result' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(enqueues).toHaveLength(0);
    const chosenSnapshot = latestSnapshot;
    fireEvent.click(consent);
    fireEvent.click(screen.getByRole('button', { name: 'Generate local result' }));
    await waitFor(() => expect(enqueues).toHaveLength(1));
    expect(enqueues[0].sources[0].id).toBe(chosenSnapshot);
  },
);
it('N2 web counterpart: actual task-version refresh retains the Modal and original running job', async () => {
  await inspect();
  fireEvent.click(screen.getByRole('button', { name: 'Generate local result' }));
  await screen.findByText('running');
  const modal = screen.getByRole('dialog');
  const submitted = structuredClone(enqueues[0]);
  holdReport = true;
  holdRaw = true;
  data.tasks[0].version++;
  await act(async () => {
    void workspace.refresh();
  });
  await waitFor(() => expect(reportWaiters.length).toBeGreaterThan(0));
  expect(screen.queryByRole('dialog')).toBe(modal);
  expect(screen.getByRole('button', { name: 'Recheck current result' })).toBeTruthy();
  expect(screen.queryByRole('checkbox', { name: 'Selected current report facts' })).toBeNull();
  job = {
    ...originalJob,
    state: 'ready',
    result: {
      operation: 'report_explanation',
      limitations: [],
      items: [{ text: 'Original period facts: 2 of 3', sourceKeys: ['report'] }],
    },
  };
  holdRaw = false;
  await act(async () => rawWaiters.splice(0).forEach((r) => r(response(job))));
  fireEvent.click(screen.getByRole('button', { name: 'Recheck current result' }));
  await screen.findByText('Original period facts: 2 of 3');
  snapshot = 'replacement-report-facts';
  originalProof = 'source';
  await releaseReport();
  await screen.findByText(
    'Selected report facts are unavailable. Choose the latest facts and review again.',
  );
  expect(screen.getByRole('dialog')).toBe(modal);
  expect(screen.queryByRole('button', { name: 'Generate local result' })).toBeNull();
  expect(enqueues).toEqual([submitted]);
  expect(submitted.sources).toEqual([
    { kind: 'report_current', id: 'snapshot-one', selectedFieldSet: 'metrics' },
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Choose latest report facts' }));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Review selected sources' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  expect(screen.queryByRole('button', { name: 'Generate local result' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Review selected sources' }));
  await screen.findByText('Inspected latest report facts');
  expect(inspections.at(-1).sources[0].id).toBe(latestSnapshot);
  expect(
    (screen.getByRole('checkbox', { name: /I agree to process/ }) as HTMLInputElement).checked,
  ).toBe(false);
  expect(enqueues).toEqual([submitted]);
});
