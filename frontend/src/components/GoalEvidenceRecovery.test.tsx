// @vitest-environment happy-dom
import { act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import GoalMeasurementForm from './GoalMeasurementForm';
import { ApiError } from '../data/api';
import { clearAllDrafts, writeDraft } from '../communication/drafts';
import { beginAttempt, clearAllBusinessAttempts, readAttempt } from '../data/businessAttempts';
const s = vi.hoisted(() => ({ w: {} as any }));
vi.mock('../store', () => ({ useWorkspace: () => s.w }));
const goal: any = { id: 'quality', version: 7, current: 4.8, baseline: 8, target: 3, unit: '%' };
const bindings = ['first', 'second source'].map((sourceId) => ({
  kind: 'message',
  sourceId,
  parentId: 'private',
  revision: 'r1',
  contentHash: 'fixture-binding',
}));
const scope = {
  serverOrigin: window.location.origin + ':api',
  companyId: 'co',
  userId: 'actor',
  formId: '$goal-measure:quality:new',
};
let client: QueryClient;
beforeEach(() => {
  clearAllBusinessAttempts();
  clearAllDrafts();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  s.w = {
    mode: 'api',
    companyId: 'co',
    session: { user: { id: 'actor' } },
    data: {
      readBasis: 'same',
      me: { memberAccessEpoch: 4, role: 'founder', departmentId: '', managerId: '' },
      company: { id: 'co', timezone: 'UTC' },
    },
    mutate: vi.fn(),
  };
  writeDraft(
    { ...scope, conversationId: scope.formId, threadRootId: 'input:draft' },
    {
      body: JSON.stringify({
        expectedVersion: 7,
        value: '4',
        local: '2026-10-02T09:00',
        instant: '',
        reason: 'Authored observation',
        evidence: bindings,
        authored: true,
      }),
    },
  );
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});
it.each([false, true])(
  'revalidates ALL unknown sources before retry, denial=%s',
  async (denied) => {
    let held = false;
    const releases = new Map<string, (ok: boolean) => void>();
    const reads: string[] = [],
      sent: any[] = [];
    const facts = new Map<string, string>();
    s.w.mutate.mockImplementation(async (_path: string, body: any) => {
      sent.push(body);
      facts.set(body.retryKey, 'one-canonical-fact');
      if (sent.length === 1) throw Error('Committed response dropped');
      return { id: 'quality', measurementId: 'one-canonical-fact' };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        const url = new URL(path, window.location.origin);
        if (url.pathname.endsWith('evidence-preview')) {
          const id = url.searchParams.get('sourceId')!;
          reads.push(id);
          if (held)
            return new Promise((resolve) =>
              releases.set(id, (ok) =>
                resolve(
                  new Response(
                    JSON.stringify(
                      ok
                        ? {
                            ...bindings.find((b) => b.sourceId === id),
                            revision: 'r2',
                            label: 'Private label',
                          }
                        : { error: { message: 'Source unavailable', code: 'not_found' } },
                    ),
                    { status: ok ? 200 : 404 },
                  ),
                ),
              ),
            );
          return new Response(
            JSON.stringify({ ...bindings.find((b) => b.sourceId === id), label: 'Private label' }),
          );
        }
        if (url.pathname.endsWith('/conversations'))
          return new Response(
            JSON.stringify({ conversations: [{ id: 'private', title: 'Fictional parent' }] }),
          );
        return new Response(JSON.stringify({ options: [] }));
      }),
    );
    const element = (
      <QueryClientProvider client={client}>
        <GoalMeasurementForm goal={goal} ready />
      </QueryClientProvider>
    );
    const view = render(element);
    await waitFor(() => expect([...new Set(reads)].sort()).toEqual(['first', 'second source']));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Record measurement' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText('Evidence kind'), { target: { value: 'message' } });
    await screen.findByRole('option', { name: 'Fictional parent' });
    fireEvent.change(screen.getByLabelText('Conversation'), { target: { value: 'private' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record measurement' }));
    await screen.findByRole('button', { name: 'Retry same measurement' });
    const original = readAttempt(scope)!;
    expect(original.state).toBe('unknown');
    expect(facts.size).toBe(1);
    const reason = screen.getByLabelText('Reason shared with goal audience') as HTMLTextAreaElement;
    reason.setSelectionRange(3, 8);
    const exactSource =
      '/goals/quality/evidence-preview?kind=message&sourceId=second%20source&parentId=private';
    const dependentScope = { ...scope, formId: 'another-dependent-intent' };
    beginAttempt(dependentScope, { reason: 'Dependent' }, 'dependent-key', {
      canonical: true,
      path: '/goals/other/measurements',
      method: 'POST',
      sources: [exactSource],
    });
    const unrelated = [
      'kind=task_comment&sourceId=second%20source&parentId=private',
      'kind=message&sourceId=second%20source&parentId=other',
      'kind=message&sourceId=other&parentId=private',
    ].map((tuple, i) => {
      const other = { ...scope, formId: 'unrelated-' + i };
      beginAttempt(other, { reason: 'Other' }, 'other-key-' + i, {
        canonical: true,
        path: '/goals/other/measurements',
        method: 'POST',
        sources: ['/goals/quality/evidence-preview?' + tuple],
      });
      return other;
    });
    held = true;
    reads.length = 0;
    act(() => {
      window.dispatchEvent(
        new CustomEvent('schach-work-event', { detail: { company: 'co', user: 'actor' } }),
      );
    });
    await waitFor(() => expect([...new Set(reads)].sort()).toEqual(['first', 'second source']));
    expect(
      (screen.getByRole('button', { name: 'Retry same measurement' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByLabelText('Reason shared with goal audience')).toBe(reason);
    expect(reason.selectionStart).toBe(3);
    expect(reason.selectionEnd).toBe(8);
    expect(reason.value).toBe('Authored observation');
    expect(readAttempt(scope)).toBe(original);
    await act(async () => {
      releases.get('first')!(true);
    });
    expect(
      (screen.getByRole('button', { name: 'Retry same measurement' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await act(async () => {
      releases.get('second source')!(!denied);
    });
    for (const other of unrelated) expect(readAttempt(other)?.state).toBe('unknown');
    if (denied) {
      await waitFor(() => expect(readAttempt(scope)).toBeUndefined());
      expect(readAttempt(dependentScope)).toBeUndefined();
      await screen.findByRole('option', { name: 'Fictional parent' });
      expect(screen.getByLabelText('Conversation')).toHaveProperty('value', '');
      expect(screen.queryByRole('button', { name: 'Retry same measurement' })).toBeNull();
      expect(screen.getByText('Selected evidence (0/50)')).toBeTruthy();
      expect(reason.value).toBe('');
      expect(
        (screen.getByRole('button', { name: 'Record measurement' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      held = false;
      reads.length = 0;
      await act(async () => {
        await client.invalidateQueries();
      });
      expect(reads).toEqual([]);
      view.unmount();
      render(element);
      expect(screen.getByLabelText('Reason shared with goal audience')).toHaveProperty('value', '');
      expect(sent).toHaveLength(1);
    } else {
      await waitFor(() =>
        expect(
          (screen.getByRole('button', { name: 'Retry same measurement' }) as HTMLButtonElement)
            .disabled,
        ).toBe(false),
      );
      expect(readAttempt(scope)).toBe(original);
      fireEvent.click(screen.getByRole('button', { name: 'Retry same measurement' }));
      await screen.findByText('Measurement recorded.');
      expect(sent).toHaveLength(2);
      expect(sent[1]).toEqual(sent[0]);
      expect(facts.size).toBe(1);
    }
  },
);
it.each([false, true])(
  'ignores a late ACK after exact source denial without retiring the newer intent, rejected=%s',
  async (rejected) => {
    let denied = false,
      release!: (value: any) => void,
      rejectOld!: (error: Error) => void;
    s.w.mutate.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          release = resolve;
          rejectOld = reject;
        }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path.includes('evidence-preview'))
          return new Response(
            JSON.stringify(
              denied
                ? { error: { message: 'Source unavailable', code: 'not_found' } }
                : { ...bindings[0], label: 'Private label' },
            ),
            { status: denied ? 404 : 200 },
          );
        return new Response(JSON.stringify({ options: [] }));
      }),
    );
    render(
      <QueryClientProvider client={client}>
        <GoalMeasurementForm goal={goal} ready />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Record measurement' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Record measurement' }));
    expect(readAttempt(scope)).toBeTruthy();
    denied = true;
    await act(async () => {
      await client.invalidateQueries();
    });
    await waitFor(() => expect(readAttempt(scope)).toBeUndefined());
    expect(screen.getByLabelText('Reason shared with goal audience')).toHaveProperty('value', '');
    await act(async () => {
      beginAttempt(
        scope,
        {
          expectedVersion: 7,
          value: 3,
          effectiveAt: '2026-10-02T09:00:00Z',
          reason: 'New intent',
          evidence: [],
        },
        'new-key',
        { canonical: true, path: '/goals/quality/measurements', method: 'POST' },
        s.w.data.me,
      );
      if (rejected) rejectOld(new ApiError('Old source denial', 404, 'not_found'));
      else release({ id: 'quality', measurementId: 'old-fact' });
    });
    expect(readAttempt(scope)?.retryKey).toBe('new-key');
    expect(screen.queryByText('Measurement recorded.')).toBeNull();
    expect(screen.getByLabelText('Reason shared with goal audience')).toHaveProperty(
      'value',
      'New intent',
    );
  },
);
