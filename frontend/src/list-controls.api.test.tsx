// @vitest-environment happy-dom
// Existing controls consume the real API-mode store's bounded list projections.
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import fixture from './data/sample.json';
import type { WorkspaceData, TaskFilters } from './types';
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_DATA_MODE', 'api');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
async function setup(page: 'tasks' | 'finance') {
  const data = structuredClone(fixture.workspaces[0]) as WorkspaceData;
  data.tasks = [
    {
      ...data.tasks[0],
      title: 'Delivery with full scalar fields',
      status: 'blocked',
      description: 'Searchable delivery context only in description',
      blockerReason: 'Waiting for signed design',
      deadlineChangeReason: 'Supplier confirmation moved the deadline',
      deadlineMode: 'timed',
      dueAt: '2026-10-10T16:00:00+05:30',
      dueTimezone: 'Asia/Kolkata',
      originalDeadlineMode: 'timed',
      originalDueAt: '2026-10-09T16:00:00+05:30',
      originalDueTimezone: 'Asia/Kolkata',
      comments: [],
      timeEntries: [],
      attachments: [],
      checklist: [],
    },
  ];
  data.expenses = [
    {
      ...data.expenses[0],
      title: 'Expense with full scalar fields',
      expenseDate: '2026-10-10',
      description: 'Searchable finance context only in description',
      reviewNote: 'Reviewed independently with evidence',
      receiptExceptionReason: 'Original invoice pending from supplier',
      budgetOverrideReason: 'Authorised exceptional site expense',
      receipts: [],
    },
  ];
  const downloads: Blob[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    downloads.push(blob as Blob);
    return 'blob:owned-test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const path = String(input);
      const reply = (value: unknown) =>
        new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
      if (path.endsWith('/auth/session'))
        return reply({ user: data.me, companies: [data.company] });
      if (path.endsWith('/bootstrap'))
        return reply({
          ...data,
          readBasis: 'confirmed',
          tasks: [],
          expenses: [],
          financeEvents: [],
        });
      if (path.includes('/tasks?')) return reply({ tasks: data.tasks, cursor: '', hasMore: false });
      if (path.includes('/expenses?'))
        return reply({ expenses: data.expenses, cursor: '', hasMore: false });
      if (path.endsWith('/finance/events')) return reply({ financeEvents: [] });
      throw Error('Unexpected API request: ' + path);
    }),
  );
  const { WorkspaceProvider, useWorkspace } = await import('./store');
  const { default: TasksPage, emptyFilters } = await import('./pages/Tasks');
  const { default: FinancePage } = await import('./pages/Finance');
  function Probe() {
    const store = useWorkspace();
    const [filters, setFilters] = useState<TaskFilters>(emptyFilters);
    if (!store.data) return null;
    return page === 'tasks' ? (
      <TasksPage filters={filters} setFilters={setFilters} onTask={() => {}} />
    ) : (
      <FinancePage onOpenTask={() => {}} />
    );
  }
  render(
    <WorkspaceProvider>
      <Probe />
    </WorkspaceProvider>,
  );
  await screen.findByRole('textbox', {
    name: page === 'tasks' ? 'Search tasks' : 'Search expenses',
  });
  return { data, downloads };
}
it('API task description search, blocked preview and CSV retain description, blocker and exact deadline business fields', async () => {
  const { data, downloads } = await setup('tasks');
  fireEvent.click(screen.getByRole('button', { name: 'Board' }));
  expect(screen.getByText(data.tasks[0].blockerReason)).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: 'Search tasks' }), {
    target: { value: 'Searchable delivery context' },
  });
  expect(screen.getByText(data.tasks[0].title)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  const csv = await downloads[0].text();
  for (const field of [
    'description',
    'blockerReason',
    'deadlineChangeReason',
    'dueAt',
    'dueTimezone',
    'originalDueAt',
    'originalDueTimezone',
  ] as const)
    expect(csv).toContain(data.tasks[0][field]);
  expect(csv).toContain('Description');
  expect(csv).toContain('Blocker');
});
it('API expense description search and CSV retain business purpose, review, receipt exception and override reasons', async () => {
  const { data, downloads } = await setup('finance');
  fireEvent.change(screen.getByRole('textbox', { name: 'Search expenses' }), {
    target: { value: 'Searchable finance context' },
  });
  expect(screen.getByRole('button', { name: new RegExp(data.expenses[0].title) })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Export expenses' }));
  const csv = await downloads[0].text();
  for (const field of [
    'description',
    'reviewNote',
    'receiptExceptionReason',
    'budgetOverrideReason',
  ] as const)
    expect(csv).toContain(data.expenses[0][field]);
  for (const field of [
    'Business purpose',
    'Receipt exception',
    'Approval note',
    'Budget override reason',
  ])
    expect(csv).toContain(field);
});
