// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Composer from './Composer';
import { clearAllDrafts } from './drafts';
afterEach(() => {
  cleanup();
  clearAllDrafts();
});
it('preserves frozen lost-ACK intent across A B A navigation and ignores double submit', async () => {
  const sends: any[] = [];
  const send = vi.fn(async (input) => {
    sends.push(input);
    if (sends.length === 1) throw Error('ACK lost');
    return { message: {} as any };
  });
  const scope = { serverOrigin: 'https://test', companyId: 'c', userId: 'u', conversationId: 'a' };
  const props = { send, disabled: false, reply: null, onClearReply: () => {} };
  const view = render(<Composer {...props} scope={scope} />);
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'authored A' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Send' }).closest('form')!);
  fireEvent.submit(screen.getByRole('button', { name: /Sending|Retry same/ }).closest('form')!);
  await screen.findByText(/ACK lost/);
  expect(sends).toHaveLength(1);
  view.unmount();
  const b = render(<Composer {...props} scope={{ ...scope, conversationId: 'b' }} />);
  expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'authored B' } });
  b.unmount();
  render(<Composer {...props} scope={scope} />);
  expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('authored A');
  fireEvent.click(screen.getByRole('button', { name: 'Retry same message' }));
  await waitFor(() => expect(sends).toHaveLength(2));
  expect(sends[1]).toEqual(sends[0]);
  expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('');
});
