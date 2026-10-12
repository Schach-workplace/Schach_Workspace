// @vitest-environment happy-dom
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const request = vi.fn();
vi.mock('../data/api', () => ({ request: (...args: unknown[]) => request(...args) }));
vi.mock('../store', () => ({ useWorkspace: () => ({ session: { user: { id: 'user-1' } } }) }));
import DeviceSessions from './DeviceSessions';

const device = (id: string, active = true) => ({
  id,
  name: 'Web call device',
  platform: 'web',
  active,
  createdAt: '2026-10-01T00:00:00Z',
  lastSeenAt: '2026-10-02T00:00:00Z',
});
beforeEach(() => {
  request.mockReset();
  localStorage.clear();
});
afterEach(cleanup);

it('shows a loading state before devices arrive', () => {
  request.mockReturnValue(new Promise(() => {}));
  render(<DeviceSessions />);
  expect(screen.getByText(/Loading registered devices/i)).toBeTruthy();
});

it('shows an empty state when no devices are registered', async () => {
  request.mockResolvedValueOnce({ devices: [] });
  render(<DeviceSessions />);
  expect(await screen.findByText(/No devices are registered/i)).toBeTruthy();
});

it('shows a load error with retry', async () => {
  request.mockRejectedValueOnce(new Error('Cannot reach the server.'));
  render(<DeviceSessions />);
  expect((await screen.findByRole('alert')).textContent).toContain('Cannot reach the server.');
  request.mockResolvedValueOnce({ devices: [device('dev-1')] });
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(/Web call device/)).toBeTruthy();
});

it('marks the device registered by this browser', async () => {
  localStorage.setItem('schach.web-device.user-1', 'dev-2');
  request.mockResolvedValueOnce({ devices: [device('dev-1'), device('dev-2')] });
  render(<DeviceSessions />);
  const rows = await screen.findAllByRole('listitem');
  expect(rows[0].textContent).not.toContain('This browser');
  expect(rows[1].textContent).toContain('This browser');
});
