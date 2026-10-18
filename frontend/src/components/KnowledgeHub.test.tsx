// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { clearAllDrafts } from '../communication/drafts';
import { canonicalBusinessTarget } from '../../../shared/business/attempts';
import KnowledgeHub from './KnowledgeHub';
import type { KnowledgeArticle } from '../../../shared/knowledge/types';
const h = vi.hoisted(() => ({
  execute: vi.fn(async (..._args: unknown[]) => ({ id: 'a', version: 1 })),
  download: vi.fn(),
  canReview: false,
  denied: false,
  version: 1,
  attempt: null as null | { payload: Record<string, unknown> },
}));
const originalArticle: KnowledgeArticle = {
  id: 'a',
  ownerId: 'me',
  pilot: 'engineering',
  title: 'Handover guide',
  body: 'Check the handover log.',
  reviewerId: 'r',
  audience: 'company',
  readerIds: [],
  state: 'published',
  reviewDueDate: '2027-01-01',
  version: 1,
  createdAt: '',
  updatedAt: '',
};
let article = { ...originalArticle };
vi.mock('../store', () => ({
  useWorkspace: () => ({
    companyId: 'co',
    mode: 'api',
    session: { user: { id: 'me' } },
    data: {
      readBasis: 'b',
      me: { id: 'me', role: 'member' },
      people: [
        { id: 'me', name: 'Me', active: true, role: 'member' },
        { id: 'r', name: 'Reviewer', active: true, role: 'member' },
      ],
    },
  }),
}));
vi.mock('../data/execution', () => ({
  useExecutionRead: (path: string) => ({
    ready: true,
    retry: vi.fn(),
    data: path.startsWith('/knowledge?')
      ? { articles: [article] }
      : path === '/knowledge/answers'
        ? {
            answer: 'Check the handover log.',
            citations: [{ id: 'a', title: article.title, version: 1, excerpt: article.body }],
            abstained: false,
          }
        : { article, reviews: [], canEdit: true, canReview: h.canReview },
  }),
  useExecutionMutation: () => ({
    execute: h.execute,
    busy: false,
    attempt: h.attempt,
    abandon: vi.fn(),
  }),
  executionRead: vi.fn(async () => {
    if (h.denied) throw new Error('Access denied');
    return { article: { ...article, version: h.version } };
  }),
}));
vi.mock('./UI', () => ({
  Modal: ({ children, title }: any) => (
    <div role="dialog" aria-label={title}>
      {children}
    </div>
  ),
  downloadText: h.download,
}));
afterEach(() => {
  cleanup();
  clearAllDrafts();
  vi.clearAllMocks();
  article = { ...originalArticle };
  h.canReview = false;
  h.denied = false;
  h.version = 1;
  h.attempt = null;
});
it('requires renewed audience confirmation and saves only a draft', async () => {
  render(<KnowledgeHub />);
  fireEvent.click(screen.getByText('New guidance'));
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New guide' } });
  fireEvent.click(screen.getByLabelText('I reviewed the guidance and publication audience'));
  fireEvent.change(screen.getByLabelText('Guidance'), { target: { value: 'Check logs' } });
  expect((screen.getByText('Save draft') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('I reviewed the guidance and publication audience'));
  fireEvent.click(screen.getByText('Save draft'));
  expect(h.execute.mock.calls[0]?.slice(0, 3)).toMatchObject([
    '/knowledge',
    { state: 'draft', body: 'Check logs' },
    'POST',
  ]);
});
it('shows independent review only when authorized by the server', () => {
  render(<KnowledgeHub />);
  fireEvent.click(screen.getByText('Handover guide'));
  expect(screen.queryByText('Review publication')).toBeNull();
});
it('shows cited versioned passages for selected sources', () => {
  render(<KnowledgeHub />);
  fireEvent.click(screen.getByLabelText('Use Handover guide as a source'));
  fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'handover' } });
  fireEvent.click(screen.getByText('Find cited passages'));
  expect(screen.getByText(/Handover guide · version 1/)).toBeTruthy();
});
it('blocks an export when the current version changed', async () => {
  render(<KnowledgeHub />);
  fireEvent.click(screen.getByText('Handover guide'));
  fireEvent.click(screen.getByText('Download reviewed copy'));
  fireEvent.click(screen.getByLabelText('I reviewed this external copy and its audience'));
  h.version = 2;
  fireEvent.click(screen.getByText('Download Markdown'));
  await screen.findByText(/Guidance changed/);
  expect(h.download).not.toHaveBeenCalled();
});
it('downloads the reviewed current version after explicit consent', async () => {
  render(<KnowledgeHub />);
  fireEvent.click(screen.getByText('Handover guide'));
  fireEvent.click(screen.getByText('Download reviewed copy'));
  expect((screen.getByText('Download Markdown') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('I reviewed this external copy and its audience'));
  fireEvent.click(screen.getByText('Download Markdown'));
  await vi.waitFor(() =>
    expect(h.download).toHaveBeenCalledWith(
      'workspace-guidance.md',
      expect.stringContaining('Version 1'),
      'text/markdown;charset=utf-8',
    ),
  );
});

it('keeps an unknown submission body and audience frozen for retry', () => {
  h.attempt = {
    payload: {
      pilot: 'field',
      title: 'Original guide',
      body: 'Original body',
      audience: 'company',
      readerIds: [],
      reviewerId: 'r',
      reviewDueDate: '2027-01-01',
      state: 'draft',
    },
  };
  render(<KnowledgeHub />);
  fireEvent.click(screen.getByText('New guidance'));
  expect((screen.getByLabelText('Guidance') as HTMLTextAreaElement).value).toBe('Original body');
  expect((screen.getByLabelText('Guidance') as HTMLTextAreaElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('Retry original guidance'));
  expect(h.execute.mock.calls[0]?.slice(0, 3)).toMatchObject([
    '/knowledge',
    h.attempt.payload,
    'POST',
  ]);
});
it.each(['publish', 'return'])(
  'requires explicit independent %s review on the canonical route',
  (decision) => {
    h.canReview = true;
    render(<KnowledgeHub />);
    fireEvent.click(screen.getByText('Handover guide'));
    fireEvent.click(screen.getByText('Review publication'));
    expect((screen.getByText('Submit independent review') as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(screen.getByLabelText('Decision'), { target: { value: decision } });
    fireEvent.change(screen.getByLabelText('Review reason'), {
      target: { value: 'Checked the handover steps and scope.' },
    });
    fireEvent.click(
      screen.getByLabelText('I reviewed the title, guidance and publication audience'),
    );
    fireEvent.click(screen.getByText('Submit independent review'));
    expect(canonicalBusinessTarget(h.execute.mock.calls[0]![0] as string, 'POST')).toBe(true);
    expect(canonicalBusinessTarget('/knowledge/a/reviews', 'POST')).toBe(false);
    expect(h.execute.mock.calls[0]?.slice(0, 2)).toMatchObject([
      '/knowledge/a/review',
      { expectedVersion: 1, decision },
    ]);
  },
);

it('refuses the copy when current server access is denied', async () => {
  render(<KnowledgeHub />);
  fireEvent.click(screen.getByText('Handover guide'));
  fireEvent.click(screen.getByText('Download reviewed copy'));
  fireEvent.click(screen.getByLabelText('I reviewed this external copy and its audience'));
  h.denied = true;
  fireEvent.click(screen.getByText('Download Markdown'));
  await screen.findByText(/Current access could not be confirmed/);
  expect(h.download).not.toHaveBeenCalled();
  expect(
    (screen.getByLabelText('I reviewed this external copy and its audience') as HTMLInputElement)
      .checked,
  ).toBe(false);
});
it('refuses the copy when the detail unmounts during its current access check', async () => {
  const view = render(<KnowledgeHub />);
  fireEvent.click(screen.getByText('Handover guide'));
  fireEvent.click(screen.getByText('Download reviewed copy'));
  fireEvent.click(screen.getByLabelText('I reviewed this external copy and its audience'));
  fireEvent.click(screen.getByText('Download Markdown'));
  view.unmount();
  await Promise.resolve();
  expect(h.download).not.toHaveBeenCalled();
});
it('resets external copy consent when the app goes into the background', () => {
  render(<KnowledgeHub />);
  fireEvent.click(screen.getByText('Handover guide'));
  fireEvent.click(screen.getByText('Download reviewed copy'));
  fireEvent.click(screen.getByLabelText('I reviewed this external copy and its audience'));
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  fireEvent(document, new Event('visibilitychange'));
  expect((screen.getByText('Download Markdown') as HTMLButtonElement).disabled).toBe(true);
  expect(h.download).not.toHaveBeenCalled();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

it('keeps an authored version-1 guidance draft bound across remount with version 2', () => {
  const view = render(<KnowledgeHub />);
  fireEvent.click(screen.getByText('Handover guide'));
  fireEvent.click(screen.getByText('Edit guidance'));
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My draft' } });
  view.unmount();
  article = { ...article, version: 2, body: 'Concurrent edit' };
  render(<KnowledgeHub />);
  fireEvent.click(screen.getByText('Handover guide'));
  fireEvent.click(screen.getByText('Edit guidance'));
  fireEvent.click(screen.getByLabelText('I reviewed the guidance and publication audience'));
  fireEvent.click(screen.getByText('Save draft'));
  expect(h.execute.mock.calls[0]?.slice(0, 3)).toMatchObject([
    '/knowledge/a',
    { title: 'My draft', body: 'Check the handover log.', expectedVersion: 1 },
    'PATCH',
  ]);
});
it('retains the original review source and audience across remount and unknown retries', () => {
  h.canReview = true;
  const view = render(<KnowledgeHub />);
  fireEvent.click(screen.getByText('Handover guide'));
  fireEvent.click(screen.getByText('Review publication'));
  fireEvent.change(screen.getByLabelText('Review reason'), {
    target: { value: 'Checked the original scope.' },
  });
  view.unmount();
  article = {
    ...article,
    version: 2,
    title: 'Changed guide',
    body: 'Concurrent body',
    audience: 'selected',
    readerIds: ['other'],
  };
  const next = render(<KnowledgeHub />);
  fireEvent.click(screen.getByText('Changed guide'));
  fireEvent.click(screen.getByText('Review publication'));
  expect(
    screen.getByRole('dialog', { name: 'Independent publication review' }).textContent,
  ).toContain('Handover guide · version 1');
  expect(
    screen.getByRole('dialog', { name: 'Independent publication review' }).textContent,
  ).toContain('Publication audience: Company');
  fireEvent.click(screen.getByLabelText('I reviewed the title, guidance and publication audience'));
  h.execute.mockRejectedValueOnce(new Error('Offline'));
  fireEvent.click(screen.getByText('Submit independent review'));
  expect(h.execute.mock.calls[0]?.slice(0, 2)).toMatchObject([
    '/knowledge/a/review',
    { expectedVersion: 1 },
  ]);
  next.unmount();
  h.attempt = {
    payload: { decision: 'return', reason: 'Checked the original scope.', expectedVersion: 1 },
  };
  render(<KnowledgeHub />);
  fireEvent.click(screen.getByText('Changed guide'));
  fireEvent.click(screen.getByText('Review publication'));
  const dialog = screen.getByRole('dialog', { name: 'Independent publication review' });
  expect(dialog.textContent).toContain('Handover guide · version 1');
  expect(dialog.textContent).toContain('Publication audience: Company');
  expect(dialog.textContent).toContain('Check the handover log.');
  fireEvent.click(screen.getByText('Retry original review'));
  expect(h.execute.mock.calls.at(-1)?.slice(0, 2)).toMatchObject([
    '/knowledge/a/review',
    h.attempt.payload,
  ]);
});

it.each(['edit', 'review'])(
  'retires the matching guidance %s draft after confirmed success',
  async (mode) => {
    h.canReview = true;
    const view = render(<KnowledgeHub />);
    fireEvent.click(screen.getByText('Handover guide'));
    fireEvent.click(screen.getByText(mode === 'edit' ? 'Edit guidance' : 'Review publication'));
    fireEvent.change(screen.getByLabelText(mode === 'edit' ? 'Title' : 'Review reason'), {
      target: { value: 'Authored original guidance' },
    });
    fireEvent.click(
      screen.getByLabelText(
        mode === 'edit'
          ? 'I reviewed the guidance and publication audience'
          : 'I reviewed the title, guidance and publication audience',
      ),
    );
    fireEvent.click(screen.getByText(mode === 'edit' ? 'Save draft' : 'Submit independent review'));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    article = { ...article, title: 'Latest guidance', body: 'Latest body', version: 2 };
    view.rerender(<KnowledgeHub />);
    fireEvent.click(screen.getByText(mode === 'edit' ? 'Edit guidance' : 'Review publication'));
    expect(
      (screen.getByLabelText(mode === 'edit' ? 'Title' : 'Review reason') as HTMLInputElement)
        .value,
    ).toBe(mode === 'edit' ? 'Latest guidance' : '');
    if (mode === 'review')
      expect(screen.getByRole('dialog').textContent).toContain('Latest guidance · version 2');
  },
);
