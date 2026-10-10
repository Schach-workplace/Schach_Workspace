import { StrictMode } from 'react';
// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MediaComposer from './MediaComposer';
const request = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ communicationRequest: request }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  request.mockReset();
});
it('retries a media send after response loss without re-uploading or changing its message ID', async () => {
  request.mockImplementation((_company, path) =>
    Promise.resolve(path.endsWith('/media') ? { id: 'media-original' } : {}),
  );
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  const send = vi.fn().mockRejectedValueOnce(new Error('Response lost')).mockResolvedValueOnce({});
  render(<MediaComposer company="a" conversation="b" disabled={false} onSend={send} />);
  const file = new File(['safe content'], 'notes.txt', { type: 'text/plain' });
  fireEvent.change(screen.getByLabelText('Attach media'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Send selected media' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Retry same media message' }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(request.mock.calls.filter((c) => c[1].endsWith('/media'))).toHaveLength(1);
});

it('accepts an attachment in the real StrictMode development tree', async () => {
  request.mockImplementation((_company, path) =>
    Promise.resolve(path.endsWith('/media') ? { id: 'strict-media' } : {}),
  );
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  const send = vi.fn().mockResolvedValue({});
  render(
    <StrictMode>
      <MediaComposer company="a" conversation="b" disabled={false} onSend={send} />
    </StrictMode>,
  );
  fireEvent.change(screen.getByLabelText('Attach media'), {
    target: { files: [new File(['content'], 'notes.txt', { type: 'text/plain' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send selected media' }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
});
