// @vitest-environment happy-dom
// DOM integration tests. These do not verify layout or simulate a real browser.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType, ReactNode } from 'react';
import type { WorkspaceData } from './types';

let App: ComponentType;
let WorkspaceProvider: ComponentType<{ children: ReactNode }>;
let demo: typeof import('./data/demo');
const user = () => userEvent.setup();

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_DATA_MODE', 'demo');
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  window.scrollTo = vi.fn();
  demo = await import('./data/demo');
  await demo.resetDemo();
  ({ default: App } = await import('./App'));
  ({ WorkspaceProvider } = await import('./store'));
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

async function mount(member = false) {
  if (member) await demo.demoLogin('member@schach.demo', 'SchachDemo!2026');
  render(
    <WorkspaceProvider>
      <App />
    </WorkspaceProvider>,
  );
  await screen.findByRole('heading', { name: member ? 'My work' : 'Your business, in focus.' });
}
async function current(): Promise<WorkspaceData> {
  return demo.readDemoWorkspace('c-schach', 'u-founder');
}

describe('rendered workspace workflows (DOM simulation)', () => {
  it('creates an empty company with its own currency, financial year and setup guide', async () => {
    await mount();
    const actor = user();
    await actor.click(screen.getByRole('button', { name: 'Settings' }));
    await actor.click(screen.getByRole('button', { name: 'Add company' }));
    const dialog = await screen.findByRole('dialog');
    await actor.type(within(dialog).getByLabelText('Name'), 'New Regional Works');
    await actor.selectOptions(within(dialog).getByLabelText(/^Company currency/), 'USD');
    await actor.selectOptions(within(dialog).getByLabelText(/^Financial year starts/), '1');
    await actor.click(within(dialog).getByRole('button', { name: 'Create company' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const setup = await screen.findByRole('region', { name: 'Company setup' });
    expect(setup.textContent).toContain('0 of 4 setup steps complete');
    const session = demo.currentDemoSession('u-founder');
    const company = session.companies.find((c) => c.name === 'New Regional Works')!;
    const workspace = await demo.readDemoWorkspace(company.id, 'u-founder');
    expect(workspace.company).toMatchObject({ currency: 'USD', fiscalYearStartMonth: 1 });
    expect(workspace.tasks).toHaveLength(0);
    expect(workspace.expenseCategories).toHaveLength(7);
    await actor.click(within(setup).getByRole('button', { name: /Set department budgets/ }));
    expect(await screen.findByRole('heading', { name: 'Budgets & expenses' })).toBeTruthy();
  });

  it('includes accepted work across the entire selected report period beyond ten years', async () => {
    await mount();
    await user().click(screen.getByRole('button', { name: 'Reports' }));
    fireEvent.change(screen.getByLabelText('Report start date'), {
      target: { value: '2000-01-01' },
    });
    const data = await current();
    const accepted = data.tasks.filter((t) => t.status === 'done').length;
    const chart = screen.getByRole('img', { name: new RegExp(`^${accepted} tasks accepted from`) });
    const displayed = Array.from(chart.querySelectorAll('.report-chart-bar-area > span')).reduce(
      (sum, el) => sum + Number(el.textContent),
      0,
    );
    expect(displayed).toBe(accepted);
  });

  it('opens a real overdue drilldown from the leadership overview', async () => {
    await mount();
    const data = await current();
    const { isOverdue, todayInTimezone } = await import('./data/metrics');
    const overdue = data.tasks.filter((task) =>
      isOverdue(task, todayInTimezone(data.company.timezone)),
    );
    await user().click(screen.getByRole('button', { name: /^Overdue tasks/ }));
    await screen.findByRole('heading', { name: 'All tasks' });
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row').length).toBe(overdue.length + 1);
    for (const task of overdue) expect(within(table).getByText(task.title)).toBeTruthy();
    await user().click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(within(screen.getByRole('table')).getAllByRole('row').length).toBe(
      data.tasks.length + 1,
    );
  });

  it('creates a task with selected-owner defaults and persists the result', async () => {
    await mount();
    const actor = user();
    await actor.click(screen.getByRole('button', { name: 'Create task' }));
    const dialog = await screen.findByRole('dialog');
    await actor.type(
      within(dialog).getByLabelText('Task title'),
      'UI integration delivery commitment',
    );
    await actor.selectOptions(within(dialog).getByLabelText('Accountable owner'), 'u-member');
    expect((within(dialog).getByLabelText('Department') as HTMLSelectElement).value).toBe('d-eng');
    expect((within(dialog).getByLabelText('Reviewer') as HTMLSelectElement).value).toBe('u-head');
    expect(within(dialog).queryByLabelText('Progress estimate')).toBeNull();
    expect(
      Array.from((within(dialog).getByLabelText('Status') as HTMLSelectElement).options).map(
        (o) => o.value,
      ),
    ).toEqual(['backlog', 'todo']);
    const { todayInTimezone, addDays } = await import('./data/metrics');
    const deadline = addDays(todayInTimezone('Asia/Kolkata'), 7);
    fireEvent.change(within(dialog).getByLabelText('Deadline'), { target: { value: deadline } });
    await actor.type(
      within(dialog).getByLabelText(/^Outcome & context/),
      'The signed engineering pack is available for review.',
    );
    await actor.type(within(dialog).getByLabelText('New checklist item'), 'Attach the signed pack');
    await actor.click(within(dialog).getByRole('button', { name: 'Add' }));
    await actor.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const created = (await current()).tasks.find(
      (t) => t.title === 'UI integration delivery commitment',
    );
    expect(created).toMatchObject({
      ownerId: 'u-member',
      reviewerId: 'u-head',
      departmentId: 'd-eng',
      dueDate: deadline,
      originalDueDate: deadline,
      status: 'todo',
      progress: 0,
      requiresApproval: true,
      version: 1,
    });
    expect(created?.checklist.map((c) => c.text)).toEqual(['Attach the signed pack']);
  });

  it('requires an explicit reopen before changing an accepted task', async () => {
    await mount();
    const actor = user();
    await actor.click(screen.getByRole('button', { name: 'All tasks' }));
    await actor.click(
      screen.getByRole('button', { name: /Finish first-article dimensional inspection/ }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Task title').closest('fieldset')?.disabled).toBe(true);
    expect(within(dialog).queryByRole('button', { name: 'Save changes' })).toBeNull();
    await actor.click(within(dialog).getByRole('button', { name: 'Reopen task' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Task title').closest('fieldset')?.disabled).toBe(false),
    );
    expect((await current()).tasks.find((t) => t.id === 't-017')?.status).toBe('in_progress');
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeTruthy();
    expect(
      (within(dialog).getByLabelText('Status') as HTMLSelectElement)
        .querySelector('option[value="done"]')
        ?.hasAttribute('disabled'),
    ).toBe(true);
  });

  it('switches companies without carrying a task drawer or filters into the next scope', async () => {
    await mount();
    const actor = user();
    await actor.click(screen.getByRole('button', { name: /^Overdue tasks/ }));
    await actor.click(screen.getByRole('button', { name: 'New task' }));
    await screen.findByRole('dialog');
    // A company change can originate from another tab or app surface while a dialog is open.
    const companySelect = document.querySelector(
      'select[aria-label="Switch company"]',
    ) as HTMLSelectElement;
    fireEvent.change(companySelect, { target: { value: 'c-meridian' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(
        (screen.getByRole('combobox', { name: 'Switch company' }) as HTMLSelectElement).value,
      ).toBe('c-meridian'),
    );
    await screen.findByRole('heading', { name: 'Your business, in focus.' });
    await actor.click(screen.getByRole('button', { name: 'All tasks' }));
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    expect(within(screen.getByRole('table')).getAllByRole('row').length).toBe(
      (await demo.readDemoWorkspace('c-meridian', 'u-founder')).tasks.length + 1,
    );
  });

  it('lands members on My work and lets them comment without editing task structure', async () => {
    await mount(true);
    const actor = user();
    expect(screen.queryByRole('button', { name: 'Overview' })).toBeNull();
    await actor.click(screen.getByRole('button', { name: /Release revised podium drawings/ }));
    const dialog = await screen.findByRole('dialog');
    for (const label of ['Accountable owner', 'Department', 'Project', 'Reviewer'])
      expect(within(dialog).getByLabelText(label).matches(':disabled')).toBe(true);
    expect(within(dialog).getByLabelText('Task title').matches(':disabled')).toBe(false);
    expect(
      (
        within(dialog).getByLabelText(
          'Require independent approval before completion',
        ) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    await actor.click(within(dialog).getByRole('button', { name: /^Activity/ }));
    await actor.type(
      within(dialog).getByLabelText('Write a comment'),
      'The updated drawing is ready for the next coordination review.',
    );
    await actor.click(within(dialog).getByRole('button', { name: 'Post comment' }));
    await within(dialog).findByText(
      'The updated drawing is ready for the next coordination review.',
      { selector: 'p' },
    );
    expect((await current()).tasks.find((t) => t.id === 't-001')?.comments.at(-1)?.userId).toBe(
      'u-member',
    );
  });
});
