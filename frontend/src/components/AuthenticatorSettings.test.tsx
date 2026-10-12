// @vitest-environment happy-dom
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const request = vi.fn();
vi.mock('../data/api', () => ({ request: (...args: unknown[]) => request(...args) }));
vi.mock('../store', () => ({ useWorkspace: () => ({ session: { user: { id: 'user-1' } } }) }));
vi.mock('./DeviceSessions', () => ({ default: () => null }));
import AuthenticatorSettings from './AuthenticatorSettings';

const operatorMessage = /operator must configure/i;
beforeEach(() => {
  request.mockReset();
});
afterEach(cleanup);

it('shows a loading state instead of the operator message while status loads', () => {
  request.mockReturnValue(new Promise(() => {}));
  render(<AuthenticatorSettings />);
  expect(screen.getByText(/Loading authenticator status/i)).toBeTruthy();
  expect(screen.queryByText(operatorMessage)).toBeNull();
});

it('shows an error with retry when the status cannot load', async () => {
  request.mockRejectedValueOnce(new Error('Cannot reach the server.'));
  render(<AuthenticatorSettings />);
  expect((await screen.findByRole('alert')).textContent).toContain('Cannot reach the server.');
  expect(screen.queryByText(operatorMessage)).toBeNull();
  request.mockResolvedValueOnce({ enabled: false, configured: true });
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(/Add an authenticator/)).toBeTruthy();
});

it('shows the operator message only when the server reports configured=false', async () => {
  request.mockResolvedValueOnce({ enabled: false, configured: false });
  render(<AuthenticatorSettings />);
  expect(await screen.findByText(operatorMessage)).toBeTruthy();
});

it('shows the otpauth setup URI with a copy button during enrollment', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const uri = 'otpauth://totp/Schach%20Workspace:me?secret=ABC';
  request.mockImplementation(async (path: string) =>
    path === '/auth/mfa' ? { enabled: false, configured: true } : { secret: 'ABC', uri },
  );
  render(<AuthenticatorSettings />);
  fireEvent.change(await screen.findByLabelText('Current password'), {
    target: { value: 'pw' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Set up authenticator' }));
  expect(await screen.findByText(uri)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Copy setup link' }));
  expect(writeText).toHaveBeenCalledWith(uri);
  expect(await screen.findByText('Copied.')).toBeTruthy();
});

it('requires both a password and a 6-digit code to disable', async () => {
  request.mockResolvedValueOnce({ enabled: true, configured: true });
  render(<AuthenticatorSettings />);
  const disable = await screen.findByRole('button', { name: /Disable with password/ });
  fireEvent.change(screen.getByLabelText('Current authenticator code'), {
    target: { value: '123456' },
  });
  expect((disable as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'pw' } });
  expect((disable as HTMLButtonElement).disabled).toBe(false);
});
