// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ store: {} as any }));
vi.mock('../store', () => ({ useWorkspace: () => h.store }));
import { demoUnavailableMessage, useExecutionMutation } from './execution';
afterEach(cleanup);
let run: () => Promise<unknown> = async () => undefined;
function Probe({ path }: { path: string }) {
  const m = useExecutionMutation('$preflight-probe');
  run = () => m.execute(path, { expectedVersion: 1 });
  return <p role="alert">{m.error}</p>;
}
const base = {
  companyId: 'co',
  session: { user: { id: 'me' } },
  data: { company: { id: 'co' }, me: { id: 'me', role: 'finance' } },
  mutate: vi.fn(),
};
it('shows a visible error instead of silently refusing while access is being confirmed', async () => {
  h.store = { ...base, mode: 'api', authorizing: true };
  render(<Probe path="/finance/intakes/x/cancel" />);
  await act(async () => {
    await run().catch(() => {});
  });
  expect(screen.getByRole('alert').textContent).toMatch(/access is still being confirmed/);
  expect(base.mutate).not.toHaveBeenCalled();
});
it('explains finance tools in demo mode in their own words', async () => {
  h.store = { ...base, mode: 'demo' };
  render(<Probe path="/finance/receipt-extractions" />);
  await act(async () => {
    await run().catch(() => {});
  });
  expect(screen.getByRole('alert').textContent).toBe(
    demoUnavailableMessage('/finance/receipt-extractions'),
  );
  expect(screen.getByRole('alert').textContent).toMatch(/Receipt extraction/);
  expect(screen.getByRole('alert').textContent).not.toMatch(/milestones/);
  expect(base.mutate).not.toHaveBeenCalled();
});
it('keeps milestone wording for project execution tools', () => {
  expect(demoUnavailableMessage('/project-milestones/m')).toMatch(/milestones/);
});
