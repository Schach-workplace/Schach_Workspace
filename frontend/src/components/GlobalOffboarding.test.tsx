// @vitest-environment happy-dom
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const request = vi.fn();
vi.mock('../data/api', () => ({ request: (...args: unknown[]) => request(...args) }));
const workspace = {
  mode: 'api',
  session: { user: { id: 'admin-1', isPlatformAdmin: true } },
};
vi.mock('../store', () => ({ useWorkspace: () => workspace }));
import GlobalOffboarding from './GlobalOffboarding';

beforeEach(() => {
  request.mockReset();
  workspace.mode = 'api';
  workspace.session.user = { id: 'admin-1', isPlatformAdmin: true };
});
afterEach(cleanup);

it('is hidden from users who are not platform administrators', () => {
  workspace.session.user = { id: 'admin-1', isPlatformAdmin: false };
  const { container } = render(<GlobalOffboarding userId="user-2" />);
  expect(container.textContent).toBe('');
});

it('is hidden for the administrator themself', () => {
  const { container } = render(<GlobalOffboarding userId="admin-1" />);
  expect(container.textContent).toBe('');
});

it('requires typing the confirmation phrase before offboarding', async () => {
  request.mockResolvedValueOnce({ ok: true, id: 'user-2', handoverStatus: 'not_performed' });
  render(<GlobalOffboarding userId="user-2" />);
  const button = screen.getByRole('button', { name: 'Offboard from every company' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Type OFFBOARD/), { target: { value: 'offboard' } });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Type OFFBOARD/), { target: { value: 'OFFBOARD' } });
  fireEvent.click(button);
  expect((await screen.findByRole('status')).textContent).toMatch(
    /suspended.*Handover was not performed/s,
  );
  expect(request).toHaveBeenCalledWith('/admin/users/user-2/offboard', {
    method: 'POST',
    body: {},
  });
});

it('shows the server error when offboarding is refused', async () => {
  request.mockRejectedValueOnce(new Error('Transfer company ownership before global offboarding.'));
  render(<GlobalOffboarding userId="user-2" />);
  fireEvent.change(screen.getByLabelText(/Type OFFBOARD/), { target: { value: 'OFFBOARD' } });
  fireEvent.click(screen.getByRole('button', { name: 'Offboard from every company' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Transfer company ownership');
});
