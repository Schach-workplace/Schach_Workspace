// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useCommunication } from './store';
import Composer from './Composer';
const request = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ communicationRequest: request, streamURL: () => 'ws://localhost/' }));
afterEach(() => {
  cleanup();
  request.mockReset();
});
function Probe({ company }: { company: string }) {
  const chat = useCommunication(company, 'person');
  return (
    <div>
      {chat.conversations.map((c) => (
        <span key={c.id}>{c.title}</span>
      ))}
      <button disabled={!chat.listHasMore} onClick={() => void chat.loadMoreConversations()}>
        More conversations
      </button>
    </div>
  );
}
describe('communication boundaries', () => {
  it('drops an old company response after a switch', async () => {
    let resolve: (value: unknown) => void = () => {};
    request.mockImplementation((company: string) =>
      company === 'a'
        ? new Promise((r) => {
            resolve = r;
          })
        : Promise.resolve({ conversations: [{ id: 'b', title: 'Company B' }] }),
    );
    const view = render(<Probe company="a" />);
    view.rerender(<Probe company="b" />);
    await screen.findByText('Company B');
    resolve({ conversations: [{ id: 'private', title: 'Private Company A secret' }] });
    await Promise.resolve();
    expect(screen.queryByText('Private Company A secret')).toBeNull();
  });
  it('loads a second authorized conversation page with its server cursor', async () => {
    request.mockImplementation((_company: string, path: string) =>
      Promise.resolve(
        path.includes('cursor=next')
          ? { conversations: [{ id: 'two', title: 'Second page' }], cursor: 'last', hasMore: false }
          : { conversations: [{ id: 'one', title: 'First page' }], cursor: 'next', hasMore: true },
      ),
    );
    render(<Probe company="a" />);
    await screen.findByText('First page');
    fireEvent.click(screen.getByRole('button', { name: 'More conversations' }));
    await screen.findByText('Second page');
    expect(screen.getByText('First page')).toBeTruthy();
  });
  it('retries a lost response with the same payload/key and keeps draft until acceptance', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('Response lost'))
      .mockResolvedValueOnce({ message: { id: 'accepted' } });
    render(<Composer send={send} disabled={false} reply={null} onClearReply={() => {}} />);
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Persist this instruction' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe(
      'Persist this instruction',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry same message' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]);
    await waitFor(() =>
      expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe(''),
    );
  });
  it('sends on Enter but preserves newlines and IME composition', async () => {
    const send = vi.fn().mockResolvedValue({ message: { id: 'accepted' } });
    render(<Composer send={send} disabled={false} reply={null} onClearReply={() => {}} />);
    const input = screen.getByLabelText('Message');
    fireEvent.change(input, { target: { value: 'A deliberate message' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0].body).toBe('A deliberate message');
  });
});
