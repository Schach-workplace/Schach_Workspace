// @vitest-environment happy-dom
// Exercises the real query provider against a mocked HTTP boundary, not browser layout.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import fixture from './data/sample.json';
import type { Session, WorkspaceData } from './types';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('revoked company access', () => {
  it.each([true, false])(
    'removes cached financial data after HTTP 403 (another company: %s)',
    async (hasOtherCompany) => {
      vi.resetModules();
      vi.stubEnv('VITE_DATA_MODE', 'api');
      localStorage.clear();
      const schach = structuredClone(fixture.workspaces[0]) as WorkspaceData;
      const meridian = structuredClone(fixture.workspaces[1]) as WorkspaceData;
      let revoked = false;
      const founder = fixture.sessions.find((session) => session.user.id === 'u-founder')!;
      let sessionRequests = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL | Request) => {
          const url = String(input);
          const reply = (body: unknown, status = 200) =>
            new Response(JSON.stringify(body), {
              status,
              headers: { 'Content-Type': 'application/json' },
            });
          if (url.endsWith('/auth/session')) {
            sessionRequests++;
            return reply({
              ...founder,
              companies: revoked ? (hasOtherCompany ? [meridian.company] : []) : founder.companies,
            } as Session);
          }
          if (url.endsWith('/companies/c-schach/bootstrap'))
            return revoked
              ? reply(
                  {
                    error: {
                      code: 'forbidden',
                      message: 'Company membership is no longer active.',
                    },
                  },
                  403,
                )
              : reply(schach);
          if (url.endsWith('/companies/c-meridian/bootstrap')) return reply(meridian);
          const data = url.includes('/companies/c-schach/') ? schach : meridian;
          if (url.includes('/tasks?'))
            return reply({ tasks: data.tasks, cursor: '', hasMore: false });
          if (url.includes('/expenses?'))
            return reply({ expenses: data.expenses, cursor: '', hasMore: false });
          if (url.endsWith('/finance/events')) return reply({ financeEvents: data.financeEvents });
          throw new Error(`Unexpected test request: ${url}`);
        }),
      );
      const { WorkspaceProvider, useWorkspace } = await import('./store');
      function Probe() {
        const store = useWorkspace();
        return (
          <div>
            <p>{store.data?.company.name ?? 'No workspace data'}</p>
            <p>{store.data?.expenses[0]?.title}</p>
            <p>{store.session?.companies.map((c) => c.name).join(', ')}</p>
            <button onClick={() => void store.refresh()}>Refresh access</button>
          </div>
        );
      }
      render(
        <WorkspaceProvider>
          <Probe />
        </WorkspaceProvider>,
      );
      await screen.findByText(schach.expenses[0].title);
      revoked = true;
      fireEvent.click(screen.getByRole('button', { name: 'Refresh access' }));
      await waitFor(() => expect(screen.queryByText(schach.expenses[0].title)).toBeNull(), {
        timeout: 3000,
      });
      await waitFor(() => expect(sessionRequests).toBeGreaterThan(1));
      if (hasOtherCompany) await screen.findByText(meridian.expenses[0].title);
      else expect(screen.getByText('No workspace data')).toBeTruthy();
      expect(screen.queryByText(schach.expenses[0].title)).toBeNull();
    },
  );
});
