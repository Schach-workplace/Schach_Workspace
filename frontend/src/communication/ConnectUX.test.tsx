// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Connect from './Connect';
const fixture = vi.hoisted(() => ({ chat: {} as any }));
vi.mock('../store', () => ({
  useWorkspace: () => ({
    companyId: 'company',
    session: { user: { id: 'me' } },
    mode: 'api',
    refresh: vi.fn(),
    data: {
      me: { id: 'me', name: 'Me', role: 'member' },
      people: [
        { id: 'me', name: 'Me', active: true },
        { id: 'peer', name: 'Alex Kumar', active: true },
        { id: 'inactive', name: 'Inactive Person', active: false },
      ],
      departments: [],
      company: { timezone: 'Asia/Kolkata' },
      expenseCategories: [],
    },
  }),
}));
vi.mock('./store', () => ({ useCommunication: () => fixture.chat }));
vi.mock('./Calls', () => ({ default: () => null }));
vi.mock('./MediaComposer', () => ({ default: () => null }));
vi.mock('./ConversationSettings', () => ({ default: () => null }));
const message = {
  id: 'msg',
  conversationId: 'chat',
  senderId: 'peer',
  body: 'Discuss the site visit',
  revision: 1,
  sequence: 1,
  removed: false,
  replyToId: '',
  clientMessageId: 'key',
  mediaIds: [],
  createdAt: '2026-10-10T09:00:00Z',
  updatedAt: '2026-10-10T09:00:00Z',
};
beforeEach(() => {
  fixture.chat = {
    conversations: [],
    selected: '',
    conversation: null,
    members: [],
    messages: [],
    connected: false,
    error: '',
    privacyEpoch: 0,
    listHasMore: false,
    hasMore: false,
    select: vi.fn(),
    refreshList: vi.fn(),
    command: vi.fn(async () => ({ conversations: [] })),
  };
});
afterEach(cleanup);
describe('Connect everyday flows', () => {
  it('opens a person’s existing DM without asking for a conversation name', async () => {
    fixture.chat.command.mockImplementation(async (path: string) =>
      path === '/conversations' ? { id: 'existing-on-second-page' } : { conversations: [] },
    );
    render(
      <StrictMode>
        <Connect />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    const dialog = screen.getByRole('dialog', { name: 'New conversation' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Direct message' }));
    expect(within(dialog).queryByLabelText('Conversation name')).toBeNull();
    expect(within(dialog).queryByText('Inactive Person')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Alex Kumar' }));
    await waitFor(() =>
      expect(fixture.chat.select).toHaveBeenCalledWith('existing-on-second-page'),
    );
    expect(fixture.chat.command).toHaveBeenCalledWith('/conversations', {
      kind: 'dm',
      participantIds: ['peer'],
      public: false,
    });
  });
  it('keeps the person picker open on a failed DM request and allows retrying the same person', async () => {
    let attempts = 0;
    fixture.chat.command.mockImplementation(async (path: string) => {
      if (path !== '/conversations') return { conversations: [] };
      if (++attempts === 1) throw Error('Response lost');
      return { id: 'existing' };
    });
    render(<Connect />);
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Direct message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Alex Kumar' }));
    await screen.findByRole('alert');
    expect(fixture.chat.select).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Alex Kumar' }).hasAttribute('disabled')).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Alex Kumar' }));
    await waitFor(() => expect(fixture.chat.select).toHaveBeenCalledWith('existing'));
    const calls = fixture.chat.command.mock.calls.filter(
      ([path]: string[]) => path === '/conversations',
    );
    expect(calls[0]).toEqual(calls[1]);
  });
  it('replies inside the open thread with the root message id', async () => {
    fixture.chat = {
      ...fixture.chat,
      selected: 'chat',
      conversation: {
        id: 'chat',
        title: 'Site',
        kind: 'group',
        public: false,
        archived: false,
        forwarding: 'deny',
        version: 1,
      },
      members: [
        {
          userId: 'me',
          role: 'member',
          active: true,
          epoch: 1,
          readSequence: 0,
          historyFromSequence: 1,
        },
      ],
      messages: [message],
      command: vi.fn(async (path: string) =>
        path.endsWith('/thread')
          ? { root: message, messages: [] }
          : path.endsWith('/messages')
            ? { message }
            : { conversations: [] },
      ),
    };
    render(<Connect />);
    fireEvent.click(screen.getByRole('button', { name: 'Open thread' }));
    const thread = await screen.findByRole('dialog', { name: 'Thread' });
    fireEvent.change(within(thread).getByLabelText('Message'), {
      target: { value: 'I can attend' },
    });
    fireEvent.click(within(thread).getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(fixture.chat.command).toHaveBeenCalledWith(
        '/conversations/chat/messages',
        expect.objectContaining({ body: 'I can attend', replyToId: 'msg' }),
      ),
    );
  });
  it('acknowledges the current visible message page and refreshes attention', async () => {
    const conversation = {
      id: 'chat',
      title: 'Site',
      kind: 'group',
      public: false,
      archived: false,
      forwarding: 'deny',
      version: 1,
    };
    let read = false;
    fixture.chat = {
      ...fixture.chat,
      selected: 'chat',
      conversation,
      conversations: [conversation],
      connected: true,
      members: [
        {
          userId: 'me',
          role: 'member',
          active: true,
          epoch: 1,
          readSequence: 0,
          historyFromSequence: 1,
        },
      ],
      messages: [message],
      command: vi.fn(async (path: string) => {
        if (path.endsWith('/read')) {
          read = true;
          return {};
        }
        return { conversations: [{ conversationId: 'chat', unread: read ? 0 : 1 }] };
      }),
    };
    render(<Connect />);
    await waitFor(() =>
      expect(fixture.chat.command).toHaveBeenCalledWith('/conversations/chat/read', {
        sequence: 1,
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText('1 unread messages')).toBeNull());
  });
});
