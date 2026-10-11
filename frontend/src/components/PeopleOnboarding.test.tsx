// @vitest-environment happy-dom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import sample from '../data/sample.json';
import { clearAllBusinessAttempts, readAttempt } from '../../../shared/business/attempts';
import { clearAllDrafts } from '../communication/drafts';
import PeopleOnboarding from './PeopleOnboarding';
const state = vi.hoisted(() => ({ mutate: vi.fn(), withhold: false }));
import PeopleTools from './PeopleTools';
import Organization from '../pages/Organization';
vi.mock('../store', () => ({
  useWorkspace: () => ({
    mode: 'api',
    companyId: sample.workspaces[0].company.id,
    session: { user: { id: sample.workspaces[0].me.id } },
    data: state.withhold ? null : sample.workspaces[0],
    mutate: state.mutate,
    saving: false,
  }),
}));
beforeEach(() => {
  clearAllBusinessAttempts();
  clearAllDrafts();
  state.mutate.mockReset();
  state.withhold = false;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('requires identity reentry after graph clearing before a fresh onboarding preview', async () => {
  let previews = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      if (String(input).endsWith('/onboarding/preview')) {
        previews++;
        return new Response(
          JSON.stringify({
            id: 'preview',
            version: 1,
            accountMode: 'existing_account',
            grants: [],
            taskPreviews: [],
            unresolved: [],
            person: { name: 'Starter', email: 'starter@example.invalid' },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify(
          String(input).endsWith('/people/context')
            ? {
                people: sample.workspaces[0].people,
                departments: [],
                roles: ['member'],
                readBasis: 'current',
              }
            : String(input).includes('presets')
              ? { items: [] }
              : { templates: [], projects: [] },
        ),
        { status: 200 },
      );
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PeopleOnboarding onClose={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Starter' } });
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'starter@example.invalid' },
  });
  fireEvent.click(screen.getByText('Continue to access'));
  fireEvent.click(screen.getByText('Continue to starting work'));
  fireEvent.click(screen.getByText('Review onboarding'));
  const fresh = await screen.findByText('Create fresh preview');
  expect(previews).toBe(1);
  clearAllDrafts();
  await waitFor(() => expect(screen.getByLabelText('Name')).toHaveProperty('value', ''));
  expect(fresh).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByText('Edit reviewed choices'));
  expect(screen.getByText('Continue to access').closest('[hidden]')).toBeNull();
  expect(previews).toBe(1);
});
it('opens a complete guided onboarding flow from Add person', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (input: string) =>
        new Response(
          JSON.stringify(
            String(input).endsWith('/people/context')
              ? {
                  people: sample.workspaces[0].people,
                  departments: sample.workspaces[0].departments,
                  roles: ['founder', 'admin', 'member', 'viewer'],
                  readBasis: 'current',
                }
              : String(input).includes('presets')
                ? { items: [], cursor: '' }
                : { templates: [], projects: [], nextCursor: '' },
          ),
          { status: 200 },
        ),
    ),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PeopleTools>
        <Organization onNavigate={() => {}} />
      </PeopleTools>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add person' }));
  expect(await screen.findByText('Starting work')).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: 'Fictional starter' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
    target: { value: 'starter@example.invalid' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Continue to access' }));
  expect(await screen.findByLabelText('Company role')).toBeTruthy();
});

it('erases local and submitted credentials before dependent refresh fails after a known ACK', async () => {
  const effect = {
    reauthenticate: true,
    scope: 'account_sessions',
    devicesMustReregister: true,
    callsMustRejoin: true,
    otherCompanyMembershipsPreserved: true,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (input: string) =>
        new Response(
          JSON.stringify(
            String(input).endsWith('/people/context')
              ? {
                  people: sample.workspaces[0].people,
                  departments: sample.workspaces[0].departments,
                  roles: ['member'],
                  readBasis: 'current',
                }
              : String(input).endsWith('/onboarding/preview')
                ? {
                    id: 'pp',
                    version: 1,
                    accountMode: 'new_account',
                    person: { name: 'Fictional', email: 'fictional@example.invalid' },
                    grants: [],
                    taskPreviews: [
                      {
                        templateId: 'fictional-template',
                        templateVersion: 3,
                        projectVersion: 0,
                        checklist: ['Read the handbook'],
                        fields: {
                          title: 'Reviewed starter task',
                          ownerId: sample.workspaces[0].me.id,
                          reviewerId: '',
                          status: 'todo',
                          priority: 'high',
                          description: 'Exact reviewed description',
                          estimatedHours: 4,
                          deadlineMode: 'timed',
                          dueDate: '2026-12-01',
                          dueAt: '2026-12-01T09:00:00Z',
                          dueTimezone: 'Asia/Kolkata',
                          tags: ['starter'],
                        },
                      },
                    ],
                    unresolved: [],
                    sessionEffect: effect,
                  }
                : String(input).includes('presets')
                  ? { items: [], cursor: '' }
                  : { templates: [], projects: [], nextCursor: '' },
          ),
          { status: 200 },
        ),
    ),
  );
  let ack: undefined | (() => void);
  let refresh: undefined | (() => void);
  state.mutate.mockImplementation(
    (_path, body, _method, onCommitted) =>
      new Promise((_resolve, reject) => {
        expect(body.password).toBe('fictional-secret-123');
        ack = () => {
          onCommitted({ id: 'joined', sessionEffect: effect });
          refresh = () => reject(Error('dependent refresh unavailable'));
        };
      }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PeopleOnboarding onClose={() => {}} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      screen
        .queryByText('Checking current company access…')
        ?.parentElement?.getAttribute('aria-hidden') !== 'false',
    ).toBe(true),
  );
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Fictional' } });
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'fictional@example.invalid' },
  });
  fireEvent.click(screen.getByText('Continue to access'));
  fireEvent.click(screen.getByText('Continue to starting work'));
  fireEvent.click(screen.getByText('Review onboarding'));
  const password = await screen.findByLabelText(/New account password/);
  expect(screen.getByText('Exact reviewed description')).toBeTruthy();
  expect(screen.getByText(/Read the handbook/)).toBeTruthy();
  expect(screen.getByText(/Asia\/Kolkata/)).toBeTruthy();
  fireEvent.change(password, { target: { value: 'fictional-secret-123' } });
  fireEvent.click(screen.getByText('Confirm onboarding'));
  await waitFor(() => expect(state.mutate).toHaveBeenCalledOnce());
  expect(screen.queryByLabelText(/New account password/)).toBeNull();
  ack!();
  expect(
    readAttempt({
      serverOrigin: window.location.origin + ':api',
      companyId: sample.workspaces[0].company.id,
      userId: sample.workspaces[0].me.id,
      formId: '$people-onboard-apply',
    }),
  ).toBeUndefined();
  refresh!();
  await screen.findByText('Company onboarding completed.');
  expect(screen.queryByText('Retry the same submission')).toBeNull();
});

it('keeps the authored onboarding node while the joined workspace shell is reauthorizing', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (input: string) =>
        new Response(
          JSON.stringify(
            String(input).endsWith('/people/context')
              ? {
                  people: sample.workspaces[0].people,
                  departments: [],
                  roles: ['member'],
                  readBasis: 'current',
                }
              : String(input).includes('presets')
                ? { items: [] }
                : { templates: [], projects: [] },
          ),
          { status: 200 },
        ),
    ),
  );
  const client = new QueryClient();
  const tree = (shell: boolean) => (
    <QueryClientProvider client={client}>
      <PeopleTools>
        {shell ? <Organization onNavigate={() => {}} /> : <p>Joining current source data</p>}
      </PeopleTools>
    </QueryClientProvider>
  );
  const view = render(tree(true));
  fireEvent.click(screen.getByText('Add person'));
  const name = await screen.findByLabelText('Name');
  fireEvent.change(name, { target: { value: 'Authored person' } });
  name.focus();
  state.withhold = true;
  view.rerender(tree(false));
  expect(screen.getByLabelText('Name')).toBe(name);
  expect((name as HTMLInputElement).value).toBe('Authored person');
  expect(document.activeElement).toBe(name);
  state.withhold = false;
  view.rerender(tree(true));
  expect(screen.getByLabelText('Name')).toBe(name);
  expect((name as HTMLInputElement).value).toBe('Authored person');
  window.dispatchEvent(
    new CustomEvent('schach-api-hard-denial', {
      detail: {
        status: 403,
        path: '/companies/' + sample.workspaces[0].company.id + '/people/context',
      },
    }),
  );
  await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull());
});

it('keeps access title/capacity and password nodes through held current reads', async () => {
  let held = false;
  let release: (() => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      if (String(input).endsWith('/people/context') && held)
        await new Promise<void>((r) => {
          release = r;
        });
      const body = String(input).endsWith('/people/context')
        ? {
            people: sample.workspaces[0].people,
            departments: sample.workspaces[0].departments,
            roles: ['member'],
          }
        : String(input).endsWith('/onboarding/preview')
          ? {
              id: 'held-preview',
              version: 1,
              accountMode: 'new_account',
              person: { name: 'Held fictional', email: 'held@example.invalid' },
              grants: [],
              taskPreviews: [],
              unresolved: [],
              sessionEffect: { reauthenticate: true },
            }
          : { items: [], templates: [], projects: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  const q = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node = (
    <QueryClientProvider client={q}>
      <PeopleOnboarding onClose={() => {}} />
    </QueryClientProvider>
  );
  const mounted = render(node);
  await screen.findByLabelText('Name');
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Held fictional' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'held@example.invalid' } });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Continue to access' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Continue to access' }));
  for (const label of ['Title', 'Weekly capacity']) {
    const input = screen.getByLabelText(label) as HTMLInputElement;
    fireEvent.change(input, { target: { value: label === 'Title' ? 'Authored title' : '31' } });
    input.focus();
    held = true;
    void q.refetchQueries();
    await waitFor(() => expect(release).toBeTruthy());
    expect(screen.getByLabelText(label)).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.disabled).toBe(false);
    held = false;
    release!();
    release = undefined;
    await waitFor(() =>
      expect(
        screen
          .queryByText('Checking current company access…')
          ?.parentElement?.getAttribute('aria-hidden') !== 'false',
      ).toBe(true),
    );
  }
  fireEvent.click(screen.getByRole('button', { name: 'Continue to starting work' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review onboarding' }));
  await waitFor(() => expect(!!document.querySelector('input[type=password]')).toBe(true));
  const password = document.querySelector('input[type=password]') as HTMLInputElement;
  fireEvent.change(password, { target: { value: 'fictional-held-secret' } });
  password.focus();
  password.setSelectionRange(3, 7);
  held = true;
  void q.refetchQueries();
  await waitFor(() => expect(release).toBeTruthy());
  state.withhold = true;
  mounted.rerender(node);
  expect(document.querySelector('input[type=password]') === password).toBe(true);
  expect(password.value.length).toBe(21);
  expect(document.activeElement === password).toBe(true);
  expect([password.selectionStart, password.selectionEnd]).toEqual([3, 7]);
  held = false;
  release!();
  state.withhold = false;
  mounted.rerender(node);
  await waitFor(() =>
    expect(
      screen
        .queryByText('Checking current company access…')
        ?.parentElement?.getAttribute('aria-hidden') !== 'false',
    ).toBe(true),
  );
});

it.each(['review', 'departure'])(
  'keeps authored %s controls during held current reads',
  async (mode) => {
    const { default: AccessReview } = await import('./AccessReview');
    const { default: Departure } = await import('./DepartureHandover');
    const target = sample.workspaces[0].people[1];
    const previewBodies: unknown[] = [];
    let held = false;
    let release: (() => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        if (String(input).endsWith('/departure/preview') && init?.body)
          previewBodies.push(JSON.parse(String(init.body)));
        if (String(input).endsWith('/people/context') && held)
          await new Promise<void>((r) => {
            release = r;
          });
        const body = String(input).endsWith('/people/context')
          ? {
              people: sample.workspaces[0].people,
              departments: sample.workspaces[0].departments,
              roles: ['member', 'admin'],
            }
          : String(input).endsWith('/departure/preview')
            ? {
                id: 'departure',
                version: 1,
                target,
                liveItems: [
                  {
                    kind: 'task_owner',
                    sourceId: 'task',
                    version: 7,
                    title: 'Fictional duty',
                    state: 'todo',
                    candidates: [sample.workspaces[0].people[0]],
                  },
                ],
                retainedHistory: { tasks: 1 },
                unresolved: [],
                readyToApply: false,
                sessionEffect: { reauthenticate: true },
              }
            : { items: [] };
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    const q = new QueryClient();
    render(
      <QueryClientProvider client={q}>
        {mode === 'review' ? (
          <AccessReview onClose={() => {}} />
        ) : (
          <Departure userId={target.id} onClose={() => {}} />
        )}
      </QueryClientProvider>,
    );
    let input: HTMLElement;
    if (mode === 'review') {
      await waitFor(() =>
        expect(
          screen
            .getByRole('button', { name: 'Capture current company memberships' })
            .hasAttribute('disabled'),
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Capture current company memberships' }));
      fireEvent.change(screen.getByLabelText('Access decision for ' + target.name), {
        target: { value: 'change' },
      });
      input = screen.getByLabelText('Title');
      fireEvent.change(input, { target: { value: 'Reviewed authored title' } });
    } else {
      fireEvent.change(screen.getByLabelText('Departure reason'), {
        target: { value: 'Reviewed exit' },
      });
      await waitFor(() =>
        expect(
          screen
            .getByRole('button', { name: 'Inspect current obligations' })
            .hasAttribute('disabled'),
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Inspect current obligations' }));
      input = await screen.findByLabelText('Replacement for task owner');
      fireEvent.change(input, { target: { value: sample.workspaces[0].people[0].id } });
    }
    input.focus();
    held = true;
    void q.refetchQueries();
    await waitFor(() => expect(release).toBeTruthy());
    expect(document.contains(input)).toBe(true);
    expect(document.activeElement === input).toBe(true);
    if (mode === 'departure') {
      expect((input as HTMLSelectElement).value).toBe(sample.workspaces[0].people[0].id);
      expect(input.textContent?.includes(sample.workspaces[0].people[0].name)).toBe(false);
    }
    held = false;
    release!();
    await waitFor(() =>
      expect(
        screen
          .queryByText('Checking current company access…')
          ?.parentElement?.getAttribute('aria-hidden') !== 'false',
      ).toBe(true),
    );
    if (mode === 'departure') {
      expect((input as HTMLSelectElement).value).toBe(sample.workspaces[0].people[0].id);
      expect(document.activeElement === input).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Review selected replacements' }));
      await waitFor(() => expect(previewBodies.length).toBe(2));
      expect(previewBodies[1]).toMatchObject({
        replacements: [
          {
            kind: 'task_owner',
            sourceId: 'task',
            expectedVersion: 7,
            action: 'transfer',
            newUserId: sample.workspaces[0].people[0].id,
          },
        ],
      });
    }
  },
);

it('keeps authored role, department and manager select values with neutral pending labels', async () => {
  const { default: MembershipFields } = await import('./PeopleMembershipFields');
  const person = sample.workspaces[0].people[0];
  const department = sample.workspaces[0].departments[0];
  const value = {
    role: 'member' as const,
    departmentId: department.id,
    managerId: person.id,
    title: 'Authored',
    capacityHours: 40,
  };
  const context = {
    readBasis: 'fictional-basis',
    companyPermissionEpoch: 1,
    people: [person],
    departments: [department],
    roles: ['member' as const],
  };
  const onChange = vi.fn();
  const view = render(<MembershipFields value={value} context={context} onChange={onChange} />);
  const selects = ['Company role', 'Department', 'Reporting manager'].map(
    (label) => screen.getByLabelText(label) as HTMLSelectElement,
  );
  const before = selects.map((select) => select.value);
  view.rerender(<MembershipFields value={value} disabled onChange={onChange} />);
  expect(selects.map((select) => select.value)).toEqual(before);
  expect(selects.every((select) => document.contains(select) && select.disabled)).toBe(true);
  expect(
    selects.every(
      (select) =>
        !select.textContent?.includes(person.name) &&
        !select.textContent?.includes(department.name),
    ),
  ).toBe(true);
  view.rerender(<MembershipFields value={value} context={context} onChange={onChange} />);
  expect(selects.map((select) => select.value)).toEqual(before);
  expect(onChange).not.toHaveBeenCalled();
});

it('discloses every ordered checklist requirement from the actual server preview before confirmation', async () => {
  // Captured by TestOnboardingReviewedTemplateTasks, never a hand-authored preview.
  const { default: fixture } =
    await import('../../../shared/people/testdata/onboarding-review.json');
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (input: string) =>
        new Response(
          JSON.stringify(
            String(input).endsWith('/people/context')
              ? fixture.context
              : String(input).endsWith('/onboarding/preview')
                ? fixture.preview
                : String(input).endsWith('/projects')
                  ? fixture.projects
                  : String(input).includes('presets')
                    ? { items: [] }
                    : { templates: [] },
          ),
          { status: 200 },
        ),
    ),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PeopleOnboarding onClose={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: fixture.preview.person.name },
  });
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: fixture.preview.person.email },
  });
  await waitFor(() =>
    expect(screen.getByText('Continue to access').hasAttribute('disabled')).toBe(false),
  );
  fireEvent.click(screen.getByText('Continue to access'));
  fireEvent.click(screen.getByText('Continue to starting work'));
  fireEvent.click(screen.getByText('Review onboarding'));
  await screen.findByLabelText(/New account password/);
  expect(screen.getByText('Complete the reviewed starting work')).toBeTruthy();
  expect(screen.getByText('Owner: Founder · Independent reviewer: admin')).toBeTruthy();
  expect(screen.getByText(/Project: Reviewed starting project · Project version: 1/)).toBeTruthy();
  expect(screen.getByText(/Status: todo · Priority: high · Estimated hours: 2.5/)).toBeTruthy();
  expect(screen.getByText(/Start: 2026-10-11 · Due: 2026-10-14/)).toBeTruthy();
  const lines = screen.getAllByText(/^Checklist:/).map((node) => node.textContent);
  expect(lines).toEqual([
    'Checklist: Read the complete starting handbook',
    'Checklist: Confirm the independent review requirements',
  ]);
  expect(screen.getByText('Confirm onboarding').hasAttribute('disabled')).toBe(true);
});

it.each([null, undefined])(
  'labels legacy unavailable checklist requirements instead of implying none (%s)',
  async (checklist) => {
    const { default: fixture } =
      await import('../../../shared/people/testdata/onboarding-review.json');
    const { onboardingTaskReview } = await import('../../../shared/people/taskReview');
    expect(
      onboardingTaskReview({ ...fixture.preview.taskPreviews[0], checklist }, undefined),
    ).toContain('Checklist requirements unavailable. Review onboarding again.');
  },
);
