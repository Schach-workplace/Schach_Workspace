// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi, afterEach } from 'vitest';
import { ReportsPage } from '../pages/GoalsReports';
import sample from '../data/sample.json';
import SavedReports from './SavedReports';
import { clearAllDrafts } from '../communication/drafts';
import { clearAllBusinessAttempts } from '../../../shared/business/attempts';
const env = vi.hoisted(() => ({ mode: 'demo' as 'api' | 'demo', mutate: vi.fn() }));
vi.mock('../store', () => ({
  useWorkspace: () => ({
    data: sample.workspaces[0],
    companyId: sample.workspaces[0].company.id,
    session: { user: { id: sample.workspaces[0].me.id } },
    mode: env.mode,
    mutate: env.mutate,
    notify: vi.fn(),
  }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearAllDrafts();
  clearAllBusinessAttempts();
  env.mode = 'demo';
  env.mutate.mockReset();
});
it('offers saved definitions beside current and historical reports', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReportsPage onTask={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Saved reports' }));
  expect(screen.getByText(/Saved reports require a connected company server/)).toBeTruthy();
});

it.each(['creation', 'definition', 'schedule'])(
  'keeps canonical %s retry versions and reconciles schedule fields together with CAS',
  async (kind) => {
    env.mode = 'api';
    const uid = sample.workspaces[0].me.id;
    const configuration = {
      name: 'Initial',
      basis: 'task_history_v1',
      filters: { ownerId: '', departmentId: '', projectId: '' },
      periodRule: 'fixed',
      from: '2026-09-01',
      to: '2026-09-30',
      timezonePolicy: 'explicit',
      reportZone: 'UTC',
      recipientIds: [uid],
    };
    const initial = {
      id: 'definition',
      companyId: sample.workspaces[0].company.id,
      ownerId: uid,
      version: 2,
      state: 'active',
      schemaVersion: 1,
      basis: 'task_history_v1',
      configuration,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    };
    const initialSchedule = {
      id: 'schedule',
      version: 1,
      definitionRevision: 2,
      weekdays: [1],
      localMinute: '09:00',
      scheduleZone: 'UTC',
      nextOccurrenceUTC: '2026-11-01T00:00:00Z',
      state: 'active',
    };
    let current = { definition: initial, schedule: initialSchedule };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (path: string) =>
          new Response(
            JSON.stringify(
              path.endsWith('/recipients')
                ? { recipients: [{ id: uid, name: 'Recipient' }] }
                : path.endsWith('/orphans')
                  ? { orphans: [] }
                  : path.endsWith('/definitions')
                    ? { definitions: kind === 'creation' ? [] : [initial] }
                    : current,
            ),
          ),
      ),
    );
    const sent: any[] = [];
    env.mutate.mockImplementation(
      async (_path: string, payload: any, _method: string, committed: any) => {
        sent.push(payload);
        if (sent.length === 1) {
          current = {
            definition: {
              ...initial,
              version: kind === 'creation' ? 3 : 4,
              configuration: { ...configuration, name: 'Intervening' },
            },
            schedule: {
              ...initialSchedule,
              version: kind === 'creation' ? 1 : kind === 'schedule' ? 3 : 2,
              definitionRevision: 4,
              weekdays: [2],
              localMinute: '14:00',
              scheduleZone: 'Asia/Kolkata',
            },
          };
          throw Error('Lost ACK');
        }
        const result = {
          definition: {
            ...initial,
            version: kind === 'creation' ? 1 : 3,
            configuration:
              kind === 'definition' ? { ...configuration, name: 'Authored' } : configuration,
          },
          schedule: {
            ...initialSchedule,
            version: kind === 'schedule' ? 2 : 1,
            definitionRevision: 3,
            localMinute: kind === 'schedule' ? '10:00' : '09:00',
          },
        };
        committed(result);
        return result;
      },
    );
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SavedReports onOpen={() => {}} />
      </QueryClientProvider>,
    );
    if (kind !== 'creation') {
      fireEvent.click(await screen.findByRole('button', { name: 'Initial active' }));
      await waitFor(() =>
        expect((screen.getByLabelText('Report name') as HTMLInputElement).value).toBe('Initial'),
      );
    } else await screen.findByText('Recipient');
    if (kind !== 'schedule') {
      fireEvent.change(screen.getByLabelText('Report name'), { target: { value: 'Authored' } });
      fireEvent.click(screen.getByText('Review definition'));
      fireEvent.click(screen.getByText('Confirm saved report'));
    } else {
      fireEvent.change(screen.getByLabelText('Schedule local time'), {
        target: { value: '10:00' },
      });
      fireEvent.click(screen.getByText('Confirm delivery schedule'));
    }
    await screen.findByText('Lost ACK');
    fireEvent.click(
      screen.getByText(
        kind === 'schedule' ? 'Retry same schedule save' : 'Retry same definition save',
      ),
    );
    await screen.findByText('Reconcile current definition');
    expect(sent[1]).toEqual(sent[0]);
    if (kind === 'creation')
      expect((screen.getByLabelText('Report name') as HTMLInputElement).value).toBe('Authored');
    expect((screen.getByLabelText('Schedule local time') as HTMLInputElement).value).toBe(
      kind === 'schedule' ? '10:00' : '09:00',
    );
    fireEvent.click(screen.getByText('Reconcile current definition'));
    expect((screen.getByLabelText('Schedule local time') as HTMLInputElement).value).toBe('14:00');
    expect((screen.getByLabelText('Schedule timezone') as HTMLInputElement).value).toBe(
      'Asia/Kolkata',
    );
    fireEvent.click(screen.getByText('Confirm delivery schedule'));
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2]).toMatchObject({
      expectedDefinitionVersion: kind === 'creation' ? 3 : 4,
      expectedScheduleVersion: kind === 'creation' ? 1 : kind === 'schedule' ? 3 : 2,
      localMinute: '14:00',
      scheduleZone: 'Asia/Kolkata',
      weekdays: [2],
    });
  },
);
