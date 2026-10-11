// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import IntelligencePanel from './IntelligencePanel';
import IntelligenceResult from './IntelligenceResult';
import {
  intelligenceReviewRequest,
  emptyIntelligenceAuthored,
} from '../../../shared/intelligence/publication';
import { clearAllDrafts } from '../communication/drafts';
import { clearAllBusinessAttempts } from '../../../shared/business/attempts';
const state = vi.hoisted(() => ({ mutate: vi.fn(), company: 'co', user: 'actor' }));
vi.mock('../store', () => ({
  useWorkspace: () => ({
    mode: 'api',
    companyId: state.company,
    session: { user: { id: state.user } },
    mutate: state.mutate,
    data: {
      readBasis: 'stable',
      me: { id: 'actor', role: 'founder', memberAccessEpoch: 1, departmentId: '', managerId: '' },
      people: [
        { id: 'actor', name: 'Human owner', active: true },
        { id: 'reviewer', name: 'Independent reviewer', active: true },
      ],
      departments: [],
      expenseCategories: [],
    },
  }),
}));
const job = {
  jobId: 'job',
  state: 'ready',
  resultHash: 'result',
  sourceSetHash: 'set',
  sources: [{ sourceKey: 'source', kind: 'task_fields', id: 'task', label: 'Authorized source' }],
  publication: { allowed: true, sources: [] },
  result: {
    operation: 'action_draft',
    limitations: ['Review against the selected source.'],
    candidates: [
      {
        kind: 'task',
        title: 'Generated seed',
        description: 'Selected source suggestion',
        sourceKeys: ['source'],
        unresolved: ['owner', 'dueDate', 'reviewer'],
      },
    ],
  },
};
let held: Promise<Response> | undefined;
let release: (r: Response) => void;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  clearAllDrafts();
  clearAllBusinessAttempts();
  state.company = 'co';
  state.user = 'actor';
  state.mutate.mockReset();
  held = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo) => {
      const path = String(input);
      if (path.endsWith('/publication-access')) return response({ current: true, committed: true });
      if (path.endsWith('/jobs/job')) return held ?? response(job);
      if (path.endsWith('/task-preview'))
        return response({
          audienceUserIds: ['actor', 'reviewer'],
          notice: 'Publish to the reviewed audience.',
          intelligenceReviewHash: 'audience',
        });
      if (path.endsWith('/capabilities'))
        return response({ operations: { summary: true }, notice: 'Local only' });
      return response({ jobs: [] });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <IntelligencePanel initialJob="job" />
    </QueryClientProvider>,
  );
}
async function edit(candidateIndex = 0) {
  await screen.findByText('Generated seed');
  fireEvent.click(screen.getAllByText('Review task draft')[candidateIndex]);
  expect(screen.getByLabelText('Intelligence owner')).toHaveProperty('value', '');
  expect(screen.getByLabelText('Intelligence reviewer')).toHaveProperty('value', '');
  expect(screen.getByLabelText('Intelligence deadline')).toHaveProperty('value', '');
  fireEvent.change(screen.getByLabelText('Reviewed intelligence title'), {
    target: { value: 'Authored title' },
  });
  fireEvent.change(screen.getByLabelText('Intelligence owner'), { target: { value: 'actor' } });
  fireEvent.change(screen.getByLabelText('Intelligence reviewer'), {
    target: { value: 'reviewer' },
  });
  fireEvent.change(screen.getByLabelText('Intelligence deadline'), {
    target: { value: '2026-11-15' },
  });
}
it('submits reviewed exact audience and retries original frozen payload after lost acknowledgement', async () => {
  state.mutate
    .mockRejectedValueOnce(Error('Lost response'))
    .mockImplementationOnce(async (_p, body, _m, committed) => {
      const r = { id: 'created' };
      committed(r);
      throw Error('Refresh failed');
    });
  mount();
  await edit();
  fireEvent.click(screen.getByText('Preview content and audience'));
  await screen.findByText('Publish to the reviewed audience.');
  fireEvent.click(screen.getByLabelText('I reviewed these fields and this audience.'));
  fireEvent.click(screen.getByText('Confirm reviewed creation'));
  await screen.findByText('Retry original submitted draft');
  const original = state.mutate.mock.calls[0][1];
  expect(original).toMatchObject({
    title: 'Authored title',
    ownerId: 'actor',
    reviewerId: 'reviewer',
    intelligenceBasis: { reviewHash: 'audience' },
  });
  fireEvent.change(screen.getByLabelText('Reviewed intelligence title'), {
    target: { value: 'Later authored edit' },
  });
  fireEvent.click(screen.getByText('Retry original submitted draft'));
  await screen.findByText('Created work successfully.');
  expect(state.mutate.mock.calls[1][1]).toEqual(original);
});
it('withholds same-key source output while keeping the actual authored editor mounted, then clears on denial', async () => {
  mount();
  await edit();
  const editor = screen.getByLabelText('Reviewed intelligence title');
  editor.focus();
  held = new Promise((r) => (release = r));
  fireEvent.click(screen.getByText('Recheck current result'));
  await waitFor(() => expect(screen.queryByText('Selected source suggestion')).toBeNull());
  expect(screen.getByLabelText('Reviewed intelligence title')).toBe(editor);
  expect(editor).toHaveProperty('value', 'Authored title');
  expect(document.activeElement).toBe(editor);
  expect(screen.getByText('Confirm reviewed creation')).toHaveProperty('disabled', true);
  release(response({ error: { code: 'not_found', message: 'Source unavailable' } }, 404));
  await waitFor(() => expect(editor).toHaveProperty('value', ''));
  expect(screen.queryByText('Authorized source')).toBeNull();
});
it('never renders model markup as links or auto-enqueues on opening', async () => {
  mount();
  await screen.findByText('Generated seed');
  expect(state.mutate).not.toHaveBeenCalled();
  expect(document.querySelector('a[href]')).toBeNull();
});

it('treats terminal invalidated metadata as source loss without reviving a candidate', async () => {
  mount();
  await edit();
  const editor = screen.getByLabelText('Reviewed intelligence title');
  held = Promise.resolve(
    response({ jobId: 'job', state: 'invalidated', reasonCode: 'source_unavailable' }),
  );
  fireEvent.click(screen.getByText('Recheck current result'));
  await waitFor(() => expect(editor).toHaveProperty('value', ''));
  expect(screen.queryByText('Generated seed')).toBeNull();
  expect(screen.getByText('Confirm reviewed creation')).toHaveProperty('disabled', true);
});

it('recovers the selected authored review and frozen attempt after remount with expired raw output', async () => {
  state.mutate
    .mockRejectedValueOnce(Error('Lost response'))
    .mockImplementationOnce(async (_p, _body, _m, committed) => {
      committed({ id: 'created' });
      return { id: 'created' };
    });
  const first = mount();
  await edit();
  fireEvent.click(screen.getByText('Preview content and audience'));
  await screen.findByText('Publish to the reviewed audience.');
  fireEvent.click(screen.getByLabelText('I reviewed these fields and this audience.'));
  fireEvent.click(screen.getByText('Confirm reviewed creation'));
  await screen.findByText('Retry original submitted draft');
  const original = state.mutate.mock.calls[0][1];
  first.unmount();
  held = Promise.resolve(response({ jobId: 'job', state: 'expired' }));
  mount();
  const retry = await screen.findByText('Retry original submitted draft');
  await waitFor(() => expect(retry).toHaveProperty('disabled', false));
  expect(screen.getByLabelText('Reviewed intelligence title')).toHaveProperty(
    'value',
    'Authored title',
  );
  expect(screen.queryByText('Generated seed')).toBeNull();
  fireEvent.click(retry);
  await screen.findByText('Created work successfully.');
  expect(state.mutate.mock.calls[1][1]).toEqual(original);
});

it('preserves expense fields and focused authored amount during current-source reauthorization', async () => {
  const expenseJob = {
    ...job,
    publication: {
      allowed: true,
      conversationId: 'conversation',
      sources: [{ messageId: 'message', revision: 1 }],
      policyVersion: 1,
    },
    result: { ...job.result, candidates: [{ ...job.result.candidates[0], kind: 'expense' }] },
  };
  held = Promise.resolve(response(expenseJob));
  mount();
  await screen.findByText('Generated seed');
  fireEvent.click(screen.getByText('Review expense draft'));
  const amount = screen.getByLabelText('amount');
  fireEvent.change(amount, { target: { value: '1300.50' } });
  amount.focus();
  held = new Promise((r) => (release = r));
  fireEvent.click(screen.getByText('Recheck current result'));
  await waitFor(() => expect(screen.queryByText('Selected source suggestion')).toBeNull());
  expect(screen.getByLabelText('amount')).toBe(amount);
  expect(amount).toHaveProperty('value', '1300.50');
  expect(document.activeElement).toBe(amount);
  expect(screen.getByText('Confirm reviewed creation')).toHaveProperty('disabled', true);
  release(response(expenseJob));
});
it('builds company-currency expense input accepted by the existing field contract', () => {
  const expenseJob: any = {
    ...job,
    publication: {
      allowed: true,
      conversationId: 'conversation',
      policyVersion: 1,
      sources: [{ messageId: 'message', revision: 1 }],
    },
  };
  const candidate: any = { ...job.result.candidates[0], kind: 'expense' };
  const authored = {
    ...emptyIntelligenceAuthored,
    title: 'Human review',
    amount: '1300.50',
    currency: 'INR',
    anchorMessageId: 'message',
    categoryId: 'category',
    expenseDate: '2026-10-11',
  };
  const plan = intelligenceReviewRequest(expenseJob, candidate, authored, '', 'INR');
  expect(plan.payload.expense).toMatchObject({ amountMinor: 130050 });
  expect(plan.payload.expense).not.toHaveProperty('currency');
  expect(() =>
    intelligenceReviewRequest(expenseJob, candidate, { ...authored, currency: 'USD' }, '', 'INR'),
  ).toThrow('company currency');
});

it('keeps the actual frozen canonical attempt across first raw expiry403 then terminal200 while independent proof is pending', async () => {
  let releaseProof: (r: Response) => void = () => {};
  const originalFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo) =>
      String(input).endsWith('/publication-access')
        ? new Promise<Response>((r) => {
            releaseProof = r;
          })
        : originalFetch(input),
    ),
  );
  state.mutate
    .mockRejectedValueOnce(Error('Lost response'))
    .mockImplementationOnce(async (_p, _body, _m, committed) => {
      committed({ id: 'created' });
      return { id: 'created' };
    });
  mount();
  await edit();
  fireEvent.click(screen.getByText('Preview content and audience'));
  await screen.findByText('Publish to the reviewed audience.');
  fireEvent.click(screen.getByLabelText('I reviewed these fields and this audience.'));
  fireEvent.click(screen.getByText('Confirm reviewed creation'));
  const retry = await screen.findByText('Retry original submitted draft');
  const original = state.mutate.mock.calls[0][1];
  held = Promise.resolve(response({ error: { code: 'expired', message: 'Expired' } }, 403));
  fireEvent.click(screen.getByText('Recheck current result'));
  await waitFor(() => expect(screen.queryByText('Generated seed')).toBeNull());
  await waitFor(() => expect(screen.getByText('Retry original submitted draft')).toBe(retry));
  expect(retry).toHaveProperty('disabled', true);
  held = Promise.resolve(response({ jobId: 'job', state: 'expired' }));
  fireEvent.click(screen.getByText('Recheck current result'));
  releaseProof(response({ current: true, committed: true }));
  await waitFor(() => expect(retry).toHaveProperty('disabled', false));
  fireEvent.click(retry);
  await screen.findByText('Created work successfully.');
  expect(state.mutate.mock.calls[1][1]).toEqual(original);
});
it('merges21plus jobs by jobId through the actual owner history consumer', async () => {
  const jobs = Array.from({ length: 23 }, (_, i) => ({
    jobId: 'history-' + i,
    operation: 'summary',
    state: 'ready',
  }));
  const originalFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo) =>
      String(input).endsWith('/intelligence/jobs')
        ? Promise.resolve(response({ jobs: jobs.slice(0, 20), cursor: 'next' }))
        : String(input).includes('/intelligence/jobs?cursor=next')
          ? Promise.resolve(response({ jobs: jobs.slice(19), cursor: '' }))
          : originalFetch(input),
    ),
  );
  mount();
  await waitFor(() => expect(screen.getAllByText(/summary request \d+ · ready/)).toHaveLength(23));
});

it('requires a human-selected supported anchor/action and preserves them in the reviewed request', () => {
  const sourceJob: any = {
    ...job,
    publication: {
      allowed: true,
      conversationId: 'conversation',
      policyVersion: 2,
      sources: [
        { messageId: 'first', revision: 1 },
        { messageId: 'second', revision: 2 },
      ],
    },
  };
  const authored: any = {
    ...emptyIntelligenceAuthored,
    title: 'Chosen candidate',
    ownerId: 'actor',
    reviewerId: 'reviewer',
    dueDate: '2026-11-15',
    anchorMessageId: 'second',
    actionId: 'supported-alternate',
  };
  expect(
    intelligenceReviewRequest(sourceJob, job.result.candidates[0] as any, authored).payload,
  ).toMatchObject({ anchorMessageId: 'second', actionId: 'supported-alternate' });
  expect(() =>
    intelligenceReviewRequest(sourceJob, job.result.candidates[0] as any, {
      ...authored,
      actionId: '',
    }),
  ).toThrow('instruction action');
});

it('binds record citation navigation to registered exact200 and denies navigation on current404', async () => {
  const recordJob: any = {
    ...job,
    sources: [
      {
        sourceKey: 'source',
        kind: 'record',
        id: 'record',
        parentId: 'message',
        conversationId: 'conversation',
        label: 'Exact poll',
      },
    ],
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response({ record: { id: 'record' }, responses: [] }))
    .mockResolvedValueOnce(response({ error: { code: 'not_found' } }, 404));
  vi.stubGlobal('fetch', fetcher);
  render(
    <IntelligenceResult
      job={recordJob}
      onReview={() => {}}
      onTranscript={() => {}}
      onOpenJob={() => {}}
    />,
  );
  fireEvent.click(screen.getByText('Open Exact poll'));
  await waitFor(() => expect(window.location.hash).toContain('record=record'));
  expect(String(fetcher.mock.calls[0][0])).toContain('/conversations/conversation/records/record');
  window.location.hash = 'unchanged';
  fireEvent.click(screen.getByText('Open Exact poll'));
  await screen.findByText('This source is unavailable. Reselect current sources.');
  expect(window.location.hash).toBe('#unchanged');
});
it('selects supported private actions for multiple candidates and recovers actual existing work after lostACK', async () => {
  const privateJob = {
    ...job,
    publication: {
      allowed: true,
      conversationId: 'conversation',
      policyVersion: 2,
      sources: [
        { messageId: 'first', revision: 1 },
        { messageId: 'second', revision: 2 },
      ],
    },
    result: {
      ...job.result,
      candidates: [
        job.result.candidates[0],
        { ...job.result.candidates[0], title: 'Second candidate' },
      ],
    },
  };
  const baseFetch = globalThis.fetch;
  const previews: any[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/jobs/job')) return response(privateJob);
      if (path.includes('/work-actions?'))
        return response({
          actions: [
            { id: 'alternate', title: 'Human alternate action', sourceRevision: 2 },
            { id: 'stale', title: 'Stale action', sourceRevision: 1 },
          ],
        });
      if (path.endsWith('/task-conversions/preview')) {
        const body = JSON.parse(init?.body as string);
        previews.push(body);
        return response({
          audienceUserIds: ['actor'],
          notice: 'Existing reviewed audience',
          intelligenceReviewHash: 'existing-review',
          outcome: body.actionId === 'primary' ? 'existing' : 'created',
          existingTaskId: 'actual-existing',
          existingTaskTitle: 'Actual existing title',
        });
      }
      return baseFetch(input, init);
    }),
  );
  state.mutate
    .mockRejectedValueOnce(Error('Lost response'))
    .mockImplementationOnce(async (_p, _b, _m, committed) => {
      const r = { id: 'actual-existing', outcome: 'existing' };
      committed(r);
      return r;
    });
  mount();
  await screen.findByText('Second candidate');
  fireEvent.click(screen.getAllByText('Review task draft')[1]);
  fireEvent.change(screen.getByLabelText('Source anchor'), { target: { value: 'second' } });
  await waitFor(() => expect(screen.getByText('Human alternate action')).toBeDefined());
  expect(screen.queryByText('Stale action')).toBeNull();
  fireEvent.change(screen.getByLabelText('Instruction action'), { target: { value: 'primary' } });
  fireEvent.change(screen.getByLabelText('Intelligence owner'), { target: { value: 'actor' } });
  fireEvent.change(screen.getByLabelText('Intelligence reviewer'), {
    target: { value: 'reviewer' },
  });
  fireEvent.change(screen.getByLabelText('Intelligence deadline'), {
    target: { value: '2026-11-15' },
  });
  fireEvent.click(screen.getByText('Preview content and audience'));
  await screen.findByText(/Existing work: Actual existing title/);
  expect(previews[0]).toMatchObject({
    anchorMessageId: 'second',
    actionId: 'primary',
    task: { title: 'Second candidate' },
  });
  fireEvent.click(screen.getByLabelText('I reviewed these fields and this audience.'));
  fireEvent.click(screen.getByText('Confirm existing work'));
  const retry = await screen.findByText('Retry original submitted draft');
  await waitFor(() => expect(retry).toHaveProperty('disabled', false));
  const original = state.mutate.mock.calls[0][1];
  fireEvent.click(screen.getAllByText('Review task draft')[0]);
  expect(screen.getByLabelText('Source anchor')).toHaveProperty('value', '');
  expect(screen.queryByText('Retry original submitted draft')).toBeNull();
  fireEvent.click(screen.getAllByText('Review task draft')[1]);
  const restoredRetry = await screen.findByText('Retry original submitted draft');
  await waitFor(() => expect(restoredRetry).toHaveProperty('disabled', false));
  fireEvent.change(screen.getByLabelText('Instruction action'), { target: { value: 'alternate' } });
  fireEvent.click(restoredRetry);
  await screen.findByText('This action already has work. Reviewed fields were not applied.');
  expect(state.mutate.mock.calls[1][1]).toEqual(original);
  expect(screen.queryByText('Created work successfully.')).toBeNull();
  const opened = vi.fn();
  window.addEventListener('schach-open-task', opened);
  fireEvent.click(screen.getByText('Open existing work'));
  expect(opened.mock.calls[0][0].detail.id).toBe('actual-existing');
  window.removeEventListener('schach-open-task', opened);
  fireEvent.click(screen.getAllByText('Review task draft')[0]);
  expect(
    screen.queryByText('This action already has work. Reviewed fields were not applied.'),
  ).toBeNull();
  expect(screen.getByLabelText('Source anchor')).toHaveProperty('value', '');
});
it.each([403, 404, 401])(
  'hard clears actual unknown form when independent publication proof denies %s',
  async (status) => {
    let deny = false;
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo) =>
        String(input).endsWith('/publication-access')
          ? Promise.resolve(
              response(
                deny
                  ? { error: { code: 'not_found', message: 'Unavailable' } }
                  : { current: true, committed: true },
                deny ? status : 200,
              ),
            )
          : originalFetch(input),
      ),
    );
    state.mutate.mockRejectedValue(Error('Lost response'));
    const first = mount();
    await edit();
    fireEvent.click(screen.getByText('Preview content and audience'));
    await screen.findByText('Publish to the reviewed audience.');
    fireEvent.click(screen.getByLabelText('I reviewed these fields and this audience.'));
    fireEvent.click(screen.getByText('Confirm reviewed creation'));
    await screen.findByText('Retry original submitted draft');
    first.unmount();
    deny = true;
    held = Promise.resolve(response({ jobId: 'job', state: 'expired' }));
    mount();
    await waitFor(() => expect(screen.queryByText('Retry original submitted draft')).toBeNull());
    expect(state.mutate).toHaveBeenCalledTimes(1);
  },
);

it.each([
  ['ack', false],
  ['error', false],
  ['ack', true],
  ['error', true],
] as const)(
  'late old %s cannot retire or resurrect a new actual canonical attempt (candidate switch %s)',
  async (mode, candidateSwitch) => {
    if (candidateSwitch) {
      const baseFetch = globalThis.fetch;
      vi.stubGlobal(
        'fetch',
        vi.fn((input: RequestInfo) =>
          String(input).endsWith('/jobs/job')
            ? Promise.resolve(
                response({
                  ...job,
                  result: {
                    ...job.result,
                    candidates: [
                      ...job.result.candidates,
                      { ...job.result.candidates[0], title: 'Second candidate' },
                    ],
                  },
                }),
              )
            : baseFetch(input),
        ),
      );
    }
    let finish: (v: any) => void = () => {},
      fail: (e: unknown) => void = () => {},
      oldACK: (v: any) => void = () => {};
    state.mutate
      .mockImplementationOnce((_p, _b, _m, commit) => {
        oldACK = commit;
        return new Promise((r, j) => {
          finish = r;
          fail = j;
        });
      })
      .mockRejectedValueOnce(Error('New response lost'))
      .mockImplementationOnce(async (_p, _b, _m, commit) => {
        commit({ id: 'new' });
        return { id: 'new' };
      });
    const submit = async (candidateIndex = 0) => {
      await edit(candidateIndex);
      fireEvent.click(screen.getByText('Preview content and audience'));
      await screen.findByText('Publish to the reviewed audience.');
      fireEvent.click(screen.getByLabelText('I reviewed these fields and this audience.'));
      fireEvent.click(screen.getByText('Confirm reviewed creation'));
    };
    const first = mount();
    await submit();
    await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(1));
    if (!candidateSwitch) {
      act(() => {
        clearAllBusinessAttempts();
        clearAllDrafts();
      });
      first.unmount();
      mount();
    }
    await submit(candidateSwitch ? 1 : 0);
    const retry = await screen.findByText('Retry original submitted draft');
    await waitFor(() => expect(retry).toHaveProperty('disabled', false));
    const newer = state.mutate.mock.calls[1][1];
    await act(async () => {
      if (mode === 'ack') {
        oldACK({ id: 'old' });
        finish({ id: 'old' });
      } else fail(Error('Late old error'));
    });
    expect(screen.queryByText('Created work successfully.')).toBeNull();
    expect(screen.getByText('Retry original submitted draft')).toBe(retry);
    fireEvent.click(retry);
    await screen.findByText('Created work successfully.');
    expect(state.mutate.mock.calls[2][1]).toEqual(newer);
    expect(newer.retryKey).not.toBe(state.mutate.mock.calls[0][1].retryKey);
  },
);
it.each(['company', 'session'])(
  'discards old cursor page after %s switch in the actual history consumer',
  async (kind) => {
    let finish: (v: Response) => void = () => {};
    let switched = false;
    const baseFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo) => {
        const path = String(input);
        if (path.includes('/intelligence/jobs?cursor=held'))
          return new Promise<Response>((r) => {
            finish = r;
          });
        if (path.endsWith('/intelligence/jobs'))
          return Promise.resolve(
            response(
              switched
                ? { jobs: [] }
                : {
                    jobs: Array.from({ length: 20 }, (_, i) => ({
                      jobId: 'old-' + i,
                      operation: 'summary',
                      state: 'ready',
                    })),
                    cursor: 'held',
                  },
            ),
          );
        return baseFetch(input);
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const node = () => (
      <QueryClientProvider client={client}>
        <IntelligencePanel initialJob="job" />
      </QueryClientProvider>
    );
    const view = render(node());
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some((c) => String(c[0]).includes('cursor=held'))).toBe(
        true,
      ),
    );
    switched = true;
    if (kind === 'company') state.company = 'new-company';
    else state.user = 'new-user';
    view.rerender(node());
    await act(async () =>
      finish(response({ jobs: [{ jobId: 'old-20', operation: 'summary', state: 'ready' }] })),
    );
    await waitFor(() =>
      expect(screen.queryAllByText(/summary request \d+ · ready/)).toHaveLength(0),
    );
  },
);

it.each([false, true])(
  'retains inspected web review across cloned pending refresh (preview overlaps=%s)',
  async (overlap) => {
    let previewDone: (v: Response) => void = () => {};
    const prior = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo, init?: RequestInit) =>
        String(input).endsWith('/task-preview') && overlap
          ? new Promise<Response>((r) => {
              previewDone = r;
            })
          : prior(input, init),
      ),
    );
    state.mutate.mockResolvedValue({ id: 'created' });
    mount();
    await edit();
    fireEvent.click(screen.getByText('Preview content and audience'));
    if (!overlap) {
      await screen.findByText('Publish to the reviewed audience.');
      fireEvent.click(screen.getByLabelText('I reviewed these fields and this audience.'));
    }
    const editor = screen.getByLabelText('Reviewed intelligence title');
    held = new Promise((r) => {
      release = r;
    });
    fireEvent.click(screen.getByText('Recheck current result'));
    await waitFor(() => expect(screen.queryByText('Authorized source')).toBeNull());
    expect(screen.queryByText('Publish to the reviewed audience.')).toBeNull();
    expect(screen.getByLabelText('Reviewed intelligence title')).toBe(editor);
    expect(screen.getByText('Confirm reviewed creation')).toHaveProperty('disabled', true);
    if (overlap)
      await act(async () =>
        previewDone(
          response({
            audienceUserIds: ['actor', 'reviewer'],
            notice: 'Publish to the reviewed audience.',
            intelligenceReviewHash: 'audience',
          }),
        ),
      );
    expect(screen.queryByText('Publish to the reviewed audience.')).toBeNull();
    await act(async () => release(response(JSON.parse(JSON.stringify(job)))));
    await screen.findByText('Publish to the reviewed audience.');
    if (overlap)
      fireEvent.click(screen.getByLabelText('I reviewed these fields and this audience.'));
    fireEvent.click(screen.getByText('Confirm reviewed creation'));
    await screen.findByText('Created work successfully.');
  },
);

it.each([
  [403, 'expired'],
  [403, 'access_changed'],
  [401, 'expired'],
  [404, 'expired'],
] as const)(
  'keeps web held canonical ACK only for exact raw expiry %s/%s',
  async (status, code) => {
    let finish: (v: unknown) => void = () => {};
    state.mutate.mockImplementation(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    mount();
    await edit();
    fireEvent.click(screen.getByText('Preview content and audience'));
    await screen.findByText('Publish to the reviewed audience.');
    fireEvent.click(screen.getByLabelText('I reviewed these fields and this audience.'));
    fireEvent.click(screen.getByText('Confirm reviewed creation'));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(1));
    held = Promise.resolve(response({ code, message: 'Unavailable' }, status));
    fireEvent.click(screen.getByText('Recheck current result'));
    await waitFor(() => expect(screen.queryByText('Authorized source')).toBeNull());
    await act(async () => finish({ id: 'created' }));
    if (status === 403 && code === 'expired') await screen.findByText('Created work successfully.');
    else expect(screen.queryByText('Created work successfully.')).toBeNull();
  },
);

it.each([
  'result',
  'source',
  'edit',
  'authority',
  'foreground',
  'denied',
  'candidate',
  'unmount',
  'retirement',
])('rejects late web inspected preview across %s change', async (change) => {
  let previewDone: (v: Response) => void = () => {};
  const initial = {
    ...job,
    result: {
      ...job.result,
      candidates: [
        job.result.candidates[0],
        { ...job.result.candidates[0], title: 'Second candidate' },
      ],
    },
  };
  const prior = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo, init?: RequestInit) =>
      String(input).endsWith('/task-preview')
        ? new Promise<Response>((r) => {
            previewDone = r;
          })
        : String(input).endsWith('/jobs/job')
          ? (held ?? Promise.resolve(response(initial)))
          : prior(input, init),
    ),
  );
  const mounted = mount();
  await edit();
  fireEvent.click(screen.getByText('Preview content and audience'));
  if (change === 'candidate') fireEvent.click(screen.getAllByText('Review task draft')[1]);
  held = new Promise((r) => {
    release = r;
  });
  fireEvent.click(screen.getByText('Recheck current result'));
  await waitFor(() => expect(screen.queryByText('Authorized source')).toBeNull());
  if (change === 'edit')
    fireEvent.change(screen.getByLabelText('Reviewed intelligence title'), {
      target: { value: 'Changed human intent' },
    });
  if (change === 'authority') {
    state.user = 'new-actor';
    mounted.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <IntelligencePanel initialJob="job" />
      </QueryClientProvider>,
    );
  }
  if (change === 'foreground') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
  }
  if (change === 'retirement') await act(async () => clearAllBusinessAttempts());
  if (change === 'unmount') {
    mounted.unmount();
    mount();
  }
  const changed = JSON.parse(JSON.stringify(initial));
  if (change === 'result') changed.resultHash = 'new-result';
  if (change === 'source') changed.publication.sources = [{ messageId: 'message', revision: 2 }];
  await act(async () =>
    release(
      change === 'denied'
        ? response({ code: 'not_found', message: 'Removed' }, 404)
        : response(changed),
    ),
  );
  await act(async () =>
    previewDone(
      response({
        audienceUserIds: ['actor'],
        notice: 'Obsolete private audience',
        intelligenceReviewHash: 'old-review',
      }),
    ),
  );
  expect(screen.queryByText('Obsolete private audience')).toBeNull();
  expect(screen.queryByText('Confirm reviewed creation')?.getAttribute('disabled')).not.toBeNull();
  if (change === 'foreground')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

it('gates inspected private audience until current supported actions return after refresh', async () => {
  const privateJob = {
    ...job,
    publication: {
      allowed: true,
      conversationId: 'conversation',
      policyVersion: 2,
      sources: [{ messageId: 'message', revision: 1 }],
    },
  };
  let holdActions = false;
  const actions: ((v: Response) => void)[] = [];
  const prior = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/jobs/job')) return held ?? Promise.resolve(response(privateJob));
      if (path.includes('/work-actions?'))
        return holdActions
          ? new Promise<Response>((r) => actions.push(r))
          : Promise.resolve(response({ actions: [] }));
      if (path.endsWith('/task-conversions/preview'))
        return Promise.resolve(
          response({
            audienceUserIds: ['actor', 'reviewer'],
            notice: 'Current private audience',
            intelligenceReviewHash: 'review',
          }),
        );
      return prior(input, init);
    }),
  );
  mount();
  await edit();
  fireEvent.change(screen.getByLabelText('Source anchor'), { target: { value: 'message' } });
  await screen.findByText('Primary instruction');
  fireEvent.change(screen.getByLabelText('Instruction action'), { target: { value: 'primary' } });
  fireEvent.click(screen.getByText('Preview content and audience'));
  await screen.findByText('Current private audience');
  fireEvent.click(screen.getByLabelText('I reviewed these fields and this audience.'));
  holdActions = true;
  held = new Promise((r) => {
    release = r;
  });
  fireEvent.click(screen.getByText('Recheck current result'));
  await waitFor(() => expect(screen.queryByText('Authorized source')).toBeNull());
  await act(async () => release(response(privateJob)));
  await waitFor(() => expect(actions.length).toBeGreaterThan(0));
  expect(screen.queryByText('Current private audience')).toBeNull();
  expect(screen.getByText('Preview content and audience')).toHaveProperty('disabled', true);
  expect(screen.getByText('Confirm reviewed creation')).toHaveProperty('disabled', true);
  holdActions = false;
  await act(async () => actions.splice(0).forEach((r) => r(response({ actions: [] }))));
  await screen.findByText('Current private audience');
  expect(screen.getByText('Confirm reviewed creation')).toHaveProperty('disabled', false);
});
