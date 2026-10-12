// @vitest-environment happy-dom
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({ children }: { children: unknown }) => children,
  VideoConference: () => null,
  RoomAudioRenderer: () => null,
  ControlBar: () => null,
}));
const request = vi.fn();
vi.mock('../data/api', () => ({ request: (...args: unknown[]) => request(...args) }));
vi.mock('../store', () => ({ useWorkspace: () => ({ session: { user: { id: 'user-1' } } }) }));
import Calls from './Calls';

const active = { id: 'call-1', kind: 'audio', version: 1, state: 'active' };
function command() {
  return vi.fn(async (path: string) =>
    path.endsWith('/calls') ? { calls: [active] } : { token: 't', url: 'wss://x', call: active },
  );
}
beforeEach(() => {
  localStorage.clear();
  request.mockReset();
});
afterEach(cleanup);

async function joinOnce() {
  const view = render(<Calls conversation="c1" command={command() as never} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Join audio call' }));
  await screen.findByText(/Recording is off/);
  view.unmount();
}

it('reuses the registered web device instead of creating a duplicate on every join', async () => {
  request.mockImplementation(async (_path: string, opts: { body: { deviceId?: string } }) => ({
    id: opts.body.deviceId ?? 'dev-1',
  }));
  await joinOnce();
  await joinOnce();
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0][1].body).toEqual({ platform: 'web', name: 'Web call device' });
  expect(request.mock.calls[1][1].body).toEqual({
    platform: 'web',
    name: 'Web call device',
    deviceId: 'dev-1',
  });
});

it('registers a fresh device when the stored device id is rejected', async () => {
  localStorage.setItem('schach.web-device.user-1', 'stale');
  request.mockImplementation(async (_path: string, opts: { body: { deviceId?: string } }) => {
    if (opts.body.deviceId) throw Object.assign(new Error('not found'), { status: 404 });
    return { id: 'dev-2' };
  });
  await joinOnce();
  expect(request.mock.calls[1][1].body).toEqual({ platform: 'web', name: 'Web call device' });
  expect(localStorage.getItem('schach.web-device.user-1')).toBe('dev-2');
});

it('keys the stored device per signed-in user', async () => {
  localStorage.setItem('schach.web-device.someone-else', 'theirs');
  request.mockResolvedValue({ id: 'dev-3' });
  await joinOnce();
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(request.mock.calls[0][1].body.deviceId).toBeUndefined();
});
