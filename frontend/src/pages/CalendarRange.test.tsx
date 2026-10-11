// @vitest-environment happy-dom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { CalendarPage } from './CalendarWorkload';
import sample from '../data/sample.json';
import { clearAllDrafts } from '../communication/drafts';
const s = vi.hoisted(() => ({
  w: {} as any,
  urls: [] as string[],
  hold: false,
  release: undefined as (() => void) | undefined,
}));
vi.mock('../store', () => ({ useWorkspace: () => s.w }));
vi.mock('../components/PlanningView', () => ({ default: () => null }));
const tasks = Array.from({ length: 109 }, (_, i) => ({
  id: 'cal-' + i,
  code: 'C-' + i,
  title:
    i === 105
      ? 'Older beyond first100'
      : i === 106
        ? 'Timed local midnight'
        : i === 107
          ? 'Accepted older'
          : 'Calendar work ' + i,
  status: i === 107 ? 'done' : i === 108 ? 'cancelled' : 'todo',
  priority: 'medium',
  progress: 0,
  ownerId: 'u',
  departmentId: '',
  projectId: '',
  dueDate: i === 106 ? '2026-10-10' : '2026-10-11',
  deadlineMode: i === 106 ? 'timed' : 'all_day',
  dueAt: i === 106 ? '2026-10-10T18:45:00.123456Z' : '',
  dueTimezone: i === 106 ? 'Asia/Kolkata' : '',
  version: 1,
}));
beforeEach(() => {
  clearAllDrafts();
  s.urls = [];
  s.hold = false;
  s.release = undefined;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-11T06:00:00Z'));
  s.w = {
    mode: 'api',
    companyId: 'c',
    session: { user: { id: 'u' } },
    data: {
      ...sample.workspaces[0],
      readBasis: 'same',
      company: { ...sample.workspaces[0].company, timezone: 'Asia/Kolkata' },
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const path = new URL(String(url), 'http://localhost');
      s.urls.push(path.pathname + path.search);
      if (s.hold)
        await new Promise<void>((r) => {
          s.release = r;
        });
      const all = path.pathname.endsWith('/planning/calendar');
      const rows = all
        ? tasks
            .filter(
              (t) =>
                path.searchParams.get('openOnly') === 'false' ||
                !['done', 'cancelled'].includes(t.status),
            )
            .map((t) => ({ ...t, dueDate: '2026-10-11' }))
        : path.searchParams.has('cursor')
          ? tasks.slice(100)
          : tasks.slice(0, 100);
      return new Response(
        JSON.stringify(
          all
            ? { tasks: rows, complete: true, timezone: 'Asia/Kolkata', readBasis: 'current' }
            : {
                tasks: rows,
                cursor: path.searchParams.has('cursor') ? '' : 'first100',
                hasMore: !path.searchParams.has('cursor'),
              },
        ),
        { status: 200 },
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CalendarPage onTask={() => {}} />
    </QueryClientProvider>,
  );
it('shows complete >100 current range including the older and company-local timed task, then includes accepted and closed', async () => {
  mount();
  await waitFor(() => expect(screen.getByText('107 deadlines on this day')).toBeTruthy());
  expect(screen.getByText('Older beyond first100')).toBeTruthy();
  expect(screen.getByText('Timed local midnight')).toBeTruthy();
  expect(s.urls[0]).toContain('/planning/calendar?');
  expect(s.urls[0]).toContain('openOnly=true');
  fireEvent.click(screen.getByLabelText('Open work only'));
  await waitFor(() => expect(screen.getByText('109 deadlines on this day')).toBeTruthy());
  expect(screen.getByText('Accepted older')).toBeTruthy();
  expect(s.urls.at(-1)).toContain('openOnly=false');
});
it('withholds counts and empty agenda claims while a complete current range is pending', async () => {
  s.hold = true;
  mount();
  await waitFor(() => expect(s.urls.length).toBe(1));
  expect(screen.queryByText('0 deadlines on this day')).toBeNull();
  expect(screen.queryByText('Nothing needs attention here')).toBeNull();
  expect(screen.queryByLabelText(/, 0 tasks$/)).toBeNull();
  s.hold = false;
  s.release?.();
  await waitFor(() => expect(screen.getByText('107 deadlines on this day')).toBeTruthy());
});
it('fetches one bounded selected-range response instead of10001 unrelated-date tasks', async () => {
  let fetched = 0,
    bytes = 0,
    calls = 0;
  const outside = Array.from({ length: 10001 }, (_, i) => ({
    ...tasks[0],
    id: 'outside-' + i,
    title: 'Outside '.repeat(200),
    dueDate: '2020-01-01',
  }));
  const selected = { ...tasks[105], title: 'Selected date work' };
  const source = [...outside, selected];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const path = new URL(String(url), 'http://localhost');
      calls++;
      const range = path.pathname.endsWith('/planning/calendar');
      const offset = Number(path.searchParams.get('cursor') || 0);
      const rows = range
        ? source.filter(
            (t) =>
              t.dueDate >= path.searchParams.get('from')! &&
              t.dueDate <= path.searchParams.get('to')!,
          )
        : source.slice(offset, offset + 100);
      fetched += rows.length;
      const more = offset + rows.length < source.length;
      const body = JSON.stringify(
        range
          ? { tasks: rows, complete: true, timezone: 'Asia/Kolkata', readBasis: 'current' }
          : { tasks: rows, hasMore: more, cursor: more ? String(offset + rows.length) : '' },
      );
      bytes += body.length;
      return new Response(body, { status: 200 });
    }),
  );
  mount();
  await waitFor(() => expect(screen.getByText('1 deadlines on this day')).toBeTruthy());
  expect(calls).toBe(1);
  expect(fetched).toBe(1);
  expect(bytes).toBeLessThanOrEqual(8 << 20);
});
it('range errors never claim complete zero counts and expose a current retry', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'range_too_large',
              message: 'Calendar exceeds10000 tasks. Narrow its dates or filters.',
            },
          }),
          { status: 422 },
        ),
    ),
  );
  mount();
  await waitFor(() => expect(screen.getByText(/Calendar exceeds10000/)).toBeTruthy());
  expect(screen.queryByText('0 deadlines on this day')).toBeNull();
  expect(screen.queryByText('Nothing needs attention here')).toBeNull();
  expect(screen.getByText('Retry current calendar range')).toBeTruthy();
});
it('withholds old company content and ignores delayed range responses after a scope switch', async () => {
  let release!: () => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const first = String(url).includes('/companies/c/');
      if (first)
        await new Promise<void>((r) => {
          release = r;
        });
      return new Response(
        JSON.stringify({
          tasks: [
            { ...tasks[0], title: first ? 'Private company A range' : 'Current company B range' },
          ],
          complete: true,
          timezone: 'Asia/Kolkata',
          readBasis: 'current',
        }),
        { status: 200 },
      );
    }),
  );
  const query = new QueryClient();
  const node = () => (
    <QueryClientProvider client={query}>
      <CalendarPage onTask={() => {}} />
    </QueryClientProvider>
  );
  const ui = render(node());
  await waitFor(() => expect(release).toBeTruthy());
  s.w = {
    ...s.w,
    companyId: 'other',
    data: { ...s.w.data, company: { ...s.w.data.company, id: 'other' } },
  };
  ui.rerender(node());
  await waitFor(() =>
    expect(screen.getAllByText('Current company B range').length).toBeGreaterThan(0),
  );
  release();
  await new Promise((r) => setTimeout(r, 10));
  expect(screen.queryByText('Private company A range')).toBeNull();
  expect(screen.getAllByText('Current company B range').length).toBeGreaterThan(0);
});
it('keeps selected agenda inside a deliberately navigated calendar period', async () => {
  mount();
  await waitFor(() => expect(screen.getByText('107 deadlines on this day')).toBeTruthy());
  fireEvent.click(screen.getByLabelText('Next period'));
  await waitFor(() => expect(s.urls.at(-1)).toContain('from=2026-10-26'));
  expect(
    screen.getByRole('heading', {
      name: /1 November.*Sunday|Sunday.*November 1|Sunday.*1 November/,
    }),
  ).toBeTruthy();
});
it('uses the complete response company-date projection when bootstrap timezone is stale', async () => {
  s.w.data.company.timezone = 'UTC';
  mount();
  await waitFor(() => expect(screen.getByText('107 deadlines on this day')).toBeTruthy());
  expect(screen.getByText('Timed local midnight')).toBeTruthy();
  expect(screen.getByText('Deadlines in Asia/Kolkata')).toBeTruthy();
});
