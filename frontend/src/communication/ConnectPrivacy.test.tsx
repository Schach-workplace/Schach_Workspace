// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import Connect from './Connect';
const scope = vi.hoisted(() => ({ chat: {} as any }));
vi.mock('../store', () => ({
  useWorkspace: () => ({
    companyId: 'company',
    session: { user: { id: 'member' } },
    mode: 'api',
    refresh: vi.fn(),
    data: {
      me: { id: 'member', role: 'member' },
      people: [],
      departments: [],
      company: { timezone: 'Asia/Kolkata' },
      expenseCategories: [],
    },
  }),
}));
vi.mock('./store', () => ({ useCommunication: () => scope.chat }));
vi.mock('./Calls', () => ({ default: () => null }));
vi.mock('./ConversationSettings', () => ({ default: () => null }));
vi.mock('./Structured', () => ({ default: () => null }));
vi.mock('./MediaComposer', () => ({ default: () => null }));
vi.mock('./WorkflowTools', () => ({ default: () => null }));
afterEach(cleanup);
function fixture() {
  const message = {
    id: 'message',
    conversationId: 'conversation',
    senderId: 'member',
    body: 'private-source-marker',
    revision: 1,
    sequence: 1,
    removed: false,
    replyToId: '',
    clientMessageId: 'key',
    mediaIds: [],
    createdAt: '2026-10-10T09:00:00Z',
    updatedAt: '2026-10-10T09:00:00Z',
  };
  scope.chat = {
    privacyEpoch: 0,
    listHasMore: false,
    hasMore: false,
    conversations: [],
    selected: 'conversation',
    conversation: {
      id: 'conversation',
      title: 'Private',
      kind: 'group',
      archived: false,
      public: false,
      version: 1,
      forwarding: 'deny',
    },
    members: [
      {
        userId: 'member',
        role: 'member',
        active: true,
        epoch: 1,
        readSequence: 0,
        historyFromSequence: 1,
      },
    ],
    messages: [message],
    connected: true,
    command: vi.fn(async (path: string) =>
      path.endsWith('/thread')
        ? { root: { ...message, body: 'private-thread-marker' }, messages: [] }
        : path.endsWith('/saved')
          ? { messages: [{ ...message, body: 'private-saved-marker' }] }
          : { conversations: [] },
    ),
    refreshList: vi.fn(),
    select: vi.fn(),
  };
}
function revoke() {
  scope.chat = {
    ...scope.chat,
    conversation: null,
    members: [],
    messages: [],
    connected: false,
    error: 'Access revoked',
  };
}
describe('derived conversation privacy', () => {
  it('clears an open thread and its unsent reply when access is lost', async () => {
    fixture();
    const v = render(<Connect />);
    fireEvent.click(screen.getByRole('button', { name: 'Open thread' }));
    await screen.findByText('private-thread-marker');
    const inputs = screen.getAllByLabelText('Message');
    fireEvent.change(inputs.at(-1)!, { target: { value: 'private-draft-marker' } });
    revoke();
    v.rerender(<Connect />);
    expect(screen.queryByText('private-thread-marker')).toBeNull();
    expect(screen.queryByDisplayValue('private-draft-marker')).toBeNull();
  });
  it('clears saved results when access is lost', async () => {
    fixture();
    const v = render(<Connect />);
    fireEvent.click(screen.getByRole('button', { name: 'Saved and reminders' }));
    await screen.findByText('private-saved-marker');
    revoke();
    v.rerender(<Connect />);
    expect(screen.queryByText('private-saved-marker')).toBeNull();
  });
  it('clears selected-message actions on a source revision change', () => {
    fixture();
    const v = render(<Connect />);
    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for message from Company member' }),
    );
    expect(screen.getByRole('dialog', { name: 'Message actions' })).toBeTruthy();
    scope.chat = {
      ...scope.chat,
      privacyEpoch: 1,
      messages: [{ ...scope.chat.messages[0], body: 'Edited source', revision: 2 }],
    };
    v.rerender(<Connect />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('private-source-marker')).toBeNull();
  });
});
