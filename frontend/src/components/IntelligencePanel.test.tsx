// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import IntelligencePanel from './IntelligencePanel';
import { clearAllDrafts } from '../communication/drafts';
import { clearAllBusinessAttempts } from '../../../shared/business/attempts';
const state = vi.hoisted(() => ({ mutate: vi.fn(), company: 'co' }));
vi.mock('../store', () => ({
  useWorkspace: () => ({
    mode: 'api',
    companyId: state.company,
    session: { user: { id: 'actor' } },
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
async function edit() {
  await screen.findByText('Generated seed');
  fireEvent.click(screen.getByText('Review task draft'));
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
