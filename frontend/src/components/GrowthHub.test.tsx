// @vitest-environment happy-dom
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import GrowthHub from './GrowthHub';
import { clearAllDrafts } from '../communication/drafts';
const h = vi.hoisted(() => ({
  execute: vi.fn(async () => ({ id: 'p', version: 1 })),
  company: 'co',
  existing: false,
  version: 1,
  attempt: null as null | { payload: Record<string, unknown> },
}));
function plan() {
  return {
    id: 'p',
    ownerId: 'me',
    pilot: 'engineering',
    version: h.version,
    title: 'Created plan',
    careerRole: 'Learner',
    careerLevel: 'foundation',
    competencyIds: ['engineering.one'],
    learningActions: ['Practice'],
    objective: h.version === 1 ? 'Original objective' : 'Concurrent objective',
    evidenceNote: '',
    mentorId: 'mentor',
    state: 'active',
  };
}
vi.mock('../store', () => ({
  useWorkspace: () => ({
    companyId: h.company,
    session: { user: { id: 'me' } },
    mode: 'api',
    data: {
      readBasis: 'b',
      company: { id: h.company },
      me: { id: 'me', role: 'member' },
      people: [{ id: 'mentor', name: 'Fictional mentor', active: true, role: 'member' }],
    },
  }),
}));
vi.mock('../data/execution', () => ({
  useExecutionRead: (path: string) => ({
    ready: true,
    retry: vi.fn(),
    data: path.endsWith('catalog')
      ? {
          pilots: ['engineering', 'office', 'field'].map((id) => ({
            id,
            label: id,
            careerRoles: ['Learner'],
            levels: ['foundation'],
            competencies: [{ id: id + '.one', label: id + ' competency' }],
            suggestedLearning: ['Practice'],
          })),
        }
      : path.endsWith('/plans')
        ? { plans: h.existing ? [plan()] : [] }
        : {
            plan: plan(),
            reviews: [],
            canEdit: h.existing,
            canReview: h.existing,
          },
  }),
  useExecutionMutation: () => ({
    execute: h.execute,
    busy: false,
    error: '',
    abandon: vi.fn(),
    attempt: h.attempt,
  }),
}));
afterEach(() => {
  cleanup();
  clearAllDrafts();
  h.existing = false;
  h.version = 1;
  h.attempt = null;
  h.execute.mockClear();
});
it.each(['engineering', 'office', 'field'])(
  'reviews %s plan audience before publishing, with editable multiline learning',
  async (pilot) => {
    render(<GrowthHub />);
    fireEvent.click(screen.getByRole('button', { name: 'New development plan' }));
    fireEvent.change(screen.getByLabelText('Development pilot'), { target: { value: pilot } });
    fireEvent.change(screen.getByLabelText('Plan title'), { target: { value: 'Learn together' } });
    fireEvent.change(screen.getByLabelText('Development objective'), {
      target: { value: 'Practice handover' },
    });
    fireEvent.click(screen.getByLabelText(pilot + ' competency'));
    fireEvent.change(screen.getByLabelText('Learning actions (one per line)'), {
      target: { value: 'First action\nSecond action' },
    });
    fireEvent.change(screen.getByLabelText('Development mentor'), { target: { value: 'mentor' } });
    expect(
      (screen.getByRole('button', { name: 'Save development plan' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByLabelText('I reviewed this plan and audience'));
    fireEvent.click(screen.getByRole('button', { name: 'Save development plan' }));
    await screen.findByText('Created plan');
    expect(h.execute.mock.calls[0]?.slice(0, 3)).toMatchObject([
      '/growth/plans',
      {
        pilot,
        title: 'Learn together',
        mentorId: 'mentor',
        learningActions: ['First action', 'Second action'],
      },
      'POST',
    ]);
  },
);

it('binds an edited v1 plan and raw learning draft to v1 after a v2 remount', () => {
  h.existing = true;
  const view = render(<GrowthHub />);
  fireEvent.click(screen.getByText('Created plan'));
  fireEvent.click(screen.getByText('Edit development plan'));
  fireEvent.change(screen.getByLabelText('Learning actions (one per line)'), {
    target: { value: 'Authored practice\n' },
  });
  view.unmount();
  h.version = 2;
  render(<GrowthHub />);
  fireEvent.click(screen.getByText('Created plan'));
  fireEvent.click(screen.getByText('Edit development plan'));
  expect(
    (screen.getByLabelText('Learning actions (one per line)') as HTMLTextAreaElement).value,
  ).toBe('Authored practice\n');
  fireEvent.click(screen.getByLabelText('I reviewed this plan and audience'));
  fireEvent.click(screen.getByText('Save development plan'));
  expect(h.execute.mock.calls[0]?.slice(0, 3)).toMatchObject([
    '/growth/plans/p',
    { objective: 'Original objective', expectedVersion: 1, learningActions: ['Authored practice'] },
    'PATCH',
  ]);
});
it('retains original mentor review version and source across a v2 remount', () => {
  h.existing = true;
  const view = render(<GrowthHub />);
  fireEvent.click(screen.getByText('Created plan'));
  fireEvent.click(screen.getByText('Add mentor feedback'));
  fireEvent.change(screen.getByLabelText('Mentor observations'), {
    target: { value: 'Original review' },
  });
  view.unmount();
  h.version = 2;
  render(<GrowthHub />);
  fireEvent.click(screen.getByText('Created plan'));
  fireEvent.click(screen.getByText('Add mentor feedback'));
  expect(screen.getByRole('dialog').textContent).toContain('reviewed version 1');
  expect(screen.getByRole('dialog').textContent).toContain('Original objective');
  fireEvent.change(screen.getByLabelText('Next development step'), {
    target: { value: 'Practice again' },
  });
  fireEvent.click(screen.getByText('Publish mentor feedback'));
  expect(h.execute.mock.calls[0]?.slice(0, 2)).toMatchObject([
    '/growth/plans/p/reviews',
    { expectedVersion: 1, feedback: 'Original review' },
  ]);
});

it.each(['edit', 'review'])(
  'retires the matching growth %s draft after confirmed success',
  async (mode) => {
    h.existing = true;
    const view = render(<GrowthHub />);
    fireEvent.click(screen.getByText('Created plan'));
    fireEvent.click(
      screen.getByText(mode === 'edit' ? 'Edit development plan' : 'Add mentor feedback'),
    );
    fireEvent.change(
      screen.getByLabelText(mode === 'edit' ? 'Development objective' : 'Mentor observations'),
      { target: { value: 'Authored original objective' } },
    );
    if (mode === 'edit')
      fireEvent.click(screen.getByLabelText('I reviewed this plan and audience'));
    else
      fireEvent.change(screen.getByLabelText('Next development step'), {
        target: { value: 'Keep practicing' },
      });
    fireEvent.click(
      screen.getByText(mode === 'edit' ? 'Save development plan' : 'Publish mentor feedback'),
    );
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    h.version = 2;
    view.rerender(<GrowthHub />);
    fireEvent.click(
      screen.getByText(mode === 'edit' ? 'Edit development plan' : 'Add mentor feedback'),
    );
    expect(
      (
        screen.getByLabelText(
          mode === 'edit' ? 'Development objective' : 'Mentor observations',
        ) as HTMLTextAreaElement
      ).value,
    ).toBe(mode === 'edit' ? 'Concurrent objective' : '');
    if (mode === 'review')
      expect(screen.getByRole('dialog').textContent).toContain('reviewed version 2');
  },
);
