// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi, afterEach } from 'vitest';
import { ReportsPage } from '../pages/GoalsReports';
import sample from '../data/sample.json';
vi.mock('../store', () => ({
  useWorkspace: () => ({
    data: sample.workspaces[0],
    companyId: sample.workspaces[0].company.id,
    session: { user: { id: sample.workspaces[0].me.id } },
    mode: 'demo',
    notify: vi.fn(),
  }),
}));
afterEach(cleanup);
it('offers saved definitions beside current and historical reports', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReportsPage onTask={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Saved reports' }));
  expect(screen.getByText(/Saved reports require a connected company server/)).toBeTruthy();
});
