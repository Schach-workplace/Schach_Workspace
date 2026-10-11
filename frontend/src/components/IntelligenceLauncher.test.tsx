// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ loads: 0, fail: false, company: 'A' }));
vi.mock('../store', () => ({
  useWorkspace: () => ({
    companyId: state.company,
    session: { user: { id: 'actor' } },
    data: { me: { memberAccessEpoch: 1 } },
  }),
}));
vi.mock('./UI', () => ({
  Modal: ({ children, onClose }: any) => (
    <section>
      <button onClick={onClose}>Close assistance</button>
      {children}
    </section>
  ),
}));
vi.mock('./IntelligencePanel', () => {
  state.loads++;
  return {
    default: ({ choices }: any) => {
      if (state.fail) throw Error('Private exception detail');
      return <p>{choices[0]?.label ?? 'Current empty panel'}</p>;
    },
  };
});
import IntelligenceLauncher from './IntelligenceLauncher';
afterEach(cleanup);
it('defers the panel until opened, renders current company props, and offers neutral manual recovery on load/render failure', async () => {
  const view = render(
    <IntelligenceLauncher choices={[{ label: 'Company A source', source: {} as any }]} />,
  );
  expect(state.loads).toBe(0);
  fireEvent.click(screen.getByText('Local assistance'));
  await screen.findByText('Company A source');
  expect(state.loads).toBe(1);
  fireEvent.click(screen.getByText('Close assistance'));
  state.company = 'B';
  view.rerender(
    <IntelligenceLauncher choices={[{ label: 'Company B source', source: {} as any }]} />,
  );
  fireEvent.click(screen.getByText('Local assistance'));
  await screen.findByText('Company B source');
  expect(screen.queryByText('Company A source')).toBeNull();
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  state.fail = true;
  view.rerender(<IntelligenceLauncher choices={[]} />);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Continue manually'));
  expect(screen.queryByText('Private exception detail')).toBeNull();
  expect(screen.getByText('Reload this page')).toBeTruthy();
  errors.mockRestore();
});
