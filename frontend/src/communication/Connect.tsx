import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Briefcase,
  ChevronRight,
  FileDown,
  Hash,
  Info,
  LockKeyhole,
  MessageCircle,
  MessagesSquare,
  MoreHorizontal,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import { Avatar, Modal } from '../components/UI';
import { useWorkspace } from '../store';
import { useCommunication } from './store';
import type { Message, Conversation } from './types';
import Composer from './Composer';
import NewConversation from './NewConversation';
import DailyTools from './DailyTools';
import ConversationSettings from './ConversationSettings';
import WorkflowTools from './WorkflowTools';
import Structured from './Structured';
import MediaComposer from './MediaComposer';
import MessageTaskConversion from '../components/MessageTaskConversion';
import './Connect.css';
const Calls = lazy(() => import('./Calls'));
type Panel = 'search' | 'saved' | 'details' | 'work' | 'records' | null;
export default function Connect() {
  const workspace = useWorkspace();
  const chat = useCommunication(
    workspace.companyId,
    workspace.session?.user.id ?? '',
    workspace.mode === 'api',
  );
  const member = chat.members.find((m) => m.userId === workspace.session?.user.id);
  const privacyKey =
    workspace.companyId +
    ':' +
    workspace.session?.user.id +
    ':' +
    chat.selected +
    ':' +
    (chat.conversation
      ? chat.conversation.version + ':' + member?.epoch + ':' + member?.role
      : 'unavailable') +
    ':' +
    chat.privacyEpoch;
  return <ConnectView key={privacyKey} workspace={workspace} chat={chat} />;
}
function ConnectView({
  workspace,
  chat,
}: {
  workspace: ReturnType<typeof useWorkspace>;
  chat: ReturnType<typeof useCommunication>;
}) {
  const data = workspace.data!;
  const me = chat.members.find((m) => m.userId === data.me.id);
  const conversation = chat.conversation;
  const disabled =
    data.me.role === 'viewer' || !conversation || conversation.archived || me?.role === 'viewer';
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState('');
  const [reply, setReply] = useState<Message | null>(null);
  const [conversion, setConversion] = useState<Message | null>(null);
  const [workSource, setWorkSource] = useState<Message | null>(null);
  const [structured, setStructured] = useState<Message | null>(null);
  const [thread, setThread] = useState<{ root: Message; messages: Message[] } | null>(null);
  const [actionSource, setActionSource] = useState<Message | null>(null);
  const [edit, setEdit] = useState<Message | null>(null);
  const [remind, setRemind] = useState<Message | null>(null);
  const [remove, setRemove] = useState<Message | null>(null);
  const [exporting, setExporting] = useState(false);
  const [attention, setAttention] = useState<Record<string, number>>({});
  const historyRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const alive = useRef(true);
  const shellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const resize = () => {
      const shell = shellRef.current;
      if (!shell) return;
      shell.style.setProperty('--connect-viewport-height', viewport.height + 'px');
      shell.dataset.keyboard = String(viewport.height < window.innerHeight * 0.8);
    };
    resize();
    viewport.addEventListener('resize', resize);
    return () => viewport.removeEventListener('resize', resize);
  }, []);
  const refreshAttention = useEffectEvent(() => {
    void chat
      .command<{ conversations: { conversationId: string; unread: number }[] }>(
        '/communication/attention',
        undefined,
        'GET',
      )
      .then((v) => {
        if (alive.current)
          setAttention(
            Object.fromEntries(v.conversations.map((c) => [c.conversationId, c.unread])),
          );
      })
      .catch(() => {});
  });
  useEffect(() => {
    if (workspace.mode !== 'api') return;
    refreshAttention();
    const timer = setInterval(() => refreshAttention(), 15000);
    return () => clearInterval(timer);
  }, []);
  const refreshThread = useEffectEvent(() => {
    if (thread && conversation)
      void chat
        .command<{ root: Message; messages: Message[] }>(
          `/conversations/${chat.selected}/messages/${thread.root.id}/thread`,
          undefined,
          'GET',
        )
        .then((v) => {
          if (alive.current) setThread(v.root.removed ? null : v);
        })
        .catch(() => {
          if (alive.current) setThread(null);
        });
  });
  useEffect(() => {
    if (!thread) return;
    const timer = setInterval(() => refreshThread(), 15000);
    return () => clearInterval(timer);
  }, [thread?.root.id]);
  useEffect(() => {
    const el = historyRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length]);
  const readSent = useRef(0);
  function acknowledgeRead() {
    const last = chat.messages.at(-1);
    if (
      !conversation ||
      !last ||
      !atBottom.current ||
      document.visibilityState === 'hidden' ||
      last.sequence <= Math.max(readSent.current, me?.readSequence ?? 0)
    )
      return;
    readSent.current = last.sequence;
    void chat
      .command(`/conversations/${chat.selected}/read`, { sequence: last.sequence })
      .then(() => refreshAttention())
      .catch(() => {
        if (alive.current) readSent.current = me?.readSequence ?? 0;
      });
  }
  const acknowledgeEvent = useEffectEvent(acknowledgeRead);
  useEffect(() => {
    acknowledgeEvent();
    const handler = () => acknowledgeEvent();
    document.addEventListener('visibilitychange', handler);
    const timer = setInterval(handler, 15000);
    return () => {
      document.removeEventListener('visibilitychange', handler);
      clearInterval(timer);
    };
  }, [chat.messages.at(-1)?.sequence]);
  const label = (c: Conversation) =>
    c.kind === 'dm'
      ? (data.people.find((p) => p.id === c.peerId)?.name ??
        (c.id === chat.selected
          ? data.people.find(
              (p) => p.id === chat.members.find((m) => m.userId !== data.me.id)?.userId,
            )?.name
          : undefined) ??
        'Direct message')
      : c.title;
  const icon = (c: Conversation) =>
    c.kind === 'channel' ? (
      <Hash size={21} />
    ) : c.kind === 'group' ? (
      <Users size={21} />
    ) : (
      <Avatar name={label(c)} />
    );
  const rows = chat.conversations.filter(
    (c) =>
      label(c).toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
      (filter === 'all' ||
        (filter === 'unread' && (attention[c.id] ?? 0) > 0) ||
        (filter === 'channels' && c.kind === 'channel') ||
        (filter === 'chats' && c.kind !== 'channel')),
  );
  async function action(path: string, body: unknown, method = 'POST') {
    setError('');
    await chat.command(path, body, method);
  }
  function run(path: string, body: unknown, method = 'POST') {
    void action(path, body, method).catch((e) => {
      if (alive.current) setError(e.message);
    });
  }
  async function openThread(m: Message) {
    try {
      const result = await chat.command<{ root: Message; messages: Message[] }>(
        `/conversations/${chat.selected}/messages/${m.replyToId || m.id}/thread`,
        undefined,
        'GET',
      );
      if (alive.current && !result.root.removed) setThread(result);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  }
  if (workspace.mode === 'demo')
    return (
      <div className="page-content">
        <h2>Connect requires the shared server</h2>
        <p>
          This browser demo contains fictional tasks and finance. It does not simulate multi-user
          conversations or calls.
        </p>
      </div>
    );
  return (
    <div
      ref={shellRef}
      className={'connect-layout connect-shell' + (chat.selected ? ' connect-chat-open' : '')}
    >
      <aside className="connect-rail" aria-label="Conversations">
        <header className="connect-rail-heading">
          <div>
            <h2>Your conversations</h2>
            <p>People, teams and company channels</p>
          </div>
          {data.me.role !== 'viewer' && (
            <button
              className="connect-icon"
              aria-label="New conversation"
              title="New conversation"
              onClick={() => setCreating(true)}
            >
              <Plus size={21} />
            </button>
          )}
        </header>
        <label className="connect-search">
          <Search size={17} />
          <input
            aria-label="Filter conversations"
            placeholder="Find a conversation…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="connect-filter" aria-label="Conversation filters">
          {[
            ['all', 'All'],
            ['unread', 'Unread'],
            ['chats', 'Chats'],
            ['channels', 'Channels'],
          ].map(([value, text]) => (
            <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {text}
            </button>
          ))}
        </div>
        <nav className="connect-conversations">
          {rows.map((c) => (
            <button
              className="connect-conversation"
              aria-pressed={chat.selected === c.id}
              key={c.id}
              onClick={() => chat.select(c.id)}
            >
              <span className={'connect-conversation-icon ' + c.kind}>{icon(c)}</span>
              <span className="connect-conversation-copy">
                <strong>{label(c)}</strong>
                <small>
                  {c.archived
                    ? 'Archived'
                    : c.kind === 'dm'
                      ? 'Direct message'
                      : c.public
                        ? 'Company channel'
                        : c.kind === 'channel'
                          ? 'Private channel'
                          : 'Private group'}
                </small>
              </span>
              {(attention[c.id] ?? 0) > 0 && (
                <span className="connect-unread" aria-label={`${attention[c.id]} unread messages`}>
                  {attention[c.id]}
                </span>
              )}
            </button>
          ))}
          {rows.length === 0 && (
            <div className="connect-list-empty">
              <MessageCircle size={27} />
              <p>
                {query || filter !== 'all'
                  ? 'No matching conversations'
                  : 'Your conversations will appear here'}
              </p>
              {data.me.role !== 'viewer' && !query && filter === 'all' && (
                <button onClick={() => setCreating(true)}>
                  Message a person <ChevronRight size={15} />
                </button>
              )}
            </div>
          )}
          {chat.listHasMore && (
            <button
              className="connect-load"
              onClick={() => void chat.loadMoreConversations().catch((e) => setError(e.message))}
            >
              Load more conversations
            </button>
          )}
        </nav>
        <footer className="connect-rail-tools">
          <button onClick={() => setPanel('search')}>
            <Search size={17} />
            Search messages
          </button>
          <button onClick={() => setPanel('saved')}>
            <Bookmark size={17} />
            Saved and reminders
          </button>
        </footer>
      </aside>
      <section className="connect-chat" aria-label="Conversation history">
        {conversation ? (
          <>
            <header className="connect-chat-heading">
              <button
                className="connect-icon connect-back"
                aria-label="Back to conversations"
                onClick={() => chat.select('')}
              >
                <ArrowLeft size={20} />
              </button>
              <span className={'connect-conversation-icon ' + conversation.kind}>
                {icon(conversation)}
              </span>
              <div className="connect-heading-copy">
                <h2>{label(conversation)}</h2>
                <p>
                  <LockKeyhole size={12} />
                  {conversation.public ? 'Company channel' : 'Private'}
                  <span>·</span>
                  {chat.members.length} {chat.members.length === 1 ? 'participant' : 'participants'}
                  <span>·</span>
                  <span className={chat.connected ? 'connect-online' : ''}>
                    {chat.connected ? 'Live updates' : 'Checking for updates'}
                  </span>
                </p>
              </div>
              <div className="connect-header-actions">
                <button
                  className="connect-icon"
                  aria-label="Search messages"
                  title="Search messages"
                  onClick={() => setPanel('search')}
                >
                  <Search size={19} />
                </button>
                <button
                  className="connect-icon"
                  aria-label="Published work"
                  title="Published work"
                  onClick={() => setPanel('work')}
                >
                  <Briefcase size={19} />
                </button>
                <button
                  className="connect-icon"
                  aria-label="Conversation details"
                  title="Conversation details"
                  onClick={() => setPanel('details')}
                >
                  <Info size={19} />
                </button>
              </div>
            </header>
            {(error || chat.error) && (
              <p className="connect-error" role="alert">
                {error || chat.error}
              </p>
            )}
            {!disabled && (
              <details className="connect-call-strip">
                <summary>Audio & video calls</summary>
                <Suspense fallback={<p>Loading call controls…</p>}>
                  <Calls key={chat.selected} conversation={chat.selected} command={chat.command} />
                </Suspense>
              </details>
            )}
            <div
              className="connect-history"
              ref={historyRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
                if (atBottom.current) acknowledgeRead();
              }}
            >
              {chat.hasMore && (
                <button
                  className="connect-load"
                  onClick={() => void chat.loadMore().catch((e) => setError(e.message))}
                >
                  Load older messages
                </button>
              )}
              {chat.messages.length === 0 ? (
                <div className="connect-empty-chat">
                  <MessagesSquare size={38} />
                  <h3>Start the conversation</h3>
                  <p>
                    {conversation.public
                      ? 'Messages here are visible to all active company members.'
                      : 'Messages and files stay within this conversation.'}
                  </p>
                </div>
              ) : (
                <ol className="connect-messages">
                  {chat.messages.map((m, i) => {
                    const author =
                      data.people.find((p) => p.id === m.senderId)?.name ?? 'Company member';
                    const own = m.senderId === data.me.id;
                    const previous = chat.messages[i - 1];
                    const day = new Date(m.createdAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    });
                    return (
                      <li className="connect-message-group" key={m.id}>
                        {(!previous ||
                          new Date(previous.createdAt).toDateString() !==
                            new Date(m.createdAt).toDateString()) && (
                          <div className="connect-day">
                            <span>{day}</span>
                          </div>
                        )}
                        <article
                          className={
                            'connect-message' +
                            (own ? ' connect-message-own' : '') +
                            (m.removed ? ' connect-message-removed' : '')
                          }
                        >
                          <Avatar name={author} size="sm" />
                          <div className="connect-message-content">
                            <div className="connect-message-meta">
                              <strong>{own ? 'You' : author}</strong>
                              <time dateTime={m.createdAt}>
                                {new Date(m.createdAt).toLocaleTimeString(undefined, {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </time>
                              {m.revision > 1 && !m.removed && <small>edited</small>}
                            </div>
                            {m.replyToId && (
                              <button
                                className="connect-reply-anchor"
                                onClick={() => void openThread(m)}
                              >
                                ↳ In a thread
                              </button>
                            )}
                            <p className="connect-message-body">
                              {m.removed ? 'Message removed' : m.body}
                            </p>
                            {!m.removed &&
                              m.mediaIds?.map((id) => (
                                <a
                                  className="connect-file"
                                  key={id}
                                  href={`${import.meta.env.VITE_API_URL ?? ''}/api/companies/${workspace.companyId}/conversations/${chat.selected}/media/${id}/download`}
                                >
                                  <FileDown size={17} />
                                  Download attachment
                                </a>
                              ))}
                            {!m.removed && (
                              <div className="connect-message-actions">
                                <button disabled={disabled} onClick={() => setReply(m)}>
                                  Reply
                                </button>
                                <button onClick={() => void openThread(m)}>Open thread</button>
                                <button
                                  aria-label={`More actions for message from ${author}`}
                                  onClick={() => setActionSource(m)}
                                >
                                  <MoreHorizontal size={18} />
                                </button>
                              </div>
                            )}
                          </div>
                        </article>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
            <footer className="connect-compose-area">
              {disabled ? (
                <p className="connect-readonly">
                  <LockKeyhole size={16} />
                  {conversation.archived
                    ? 'This conversation is archived. Reopen it in details to send messages.'
                    : 'You have read-only access to this conversation.'}
                </p>
              ) : (
                <>
                  <Composer
                    members={chat.members}
                    names={Object.fromEntries(data.people.map((p) => [p.id, p.name]))}
                    canMentionAll={['owner', 'moderator'].includes(me?.role ?? '')}
                    disabled={disabled}
                    reply={reply}
                    onClearReply={() => setReply(null)}
                    send={(input) =>
                      chat.command(`/conversations/${chat.selected}/messages`, input)
                    }
                  />
                  <details className="connect-media-tools">
                    <summary>Attachments & voice notes</summary>
                    <MediaComposer
                      company={workspace.companyId}
                      conversation={chat.selected}
                      disabled={disabled}
                      onSend={(body, mediaIds, clientMessageId) =>
                        chat.command(`/conversations/${chat.selected}/messages`, {
                          body,
                          mediaIds,
                          clientMessageId,
                        })
                      }
                    />
                  </details>
                </>
              )}
            </footer>
          </>
        ) : (
          <div className="connect-welcome">
            <div className="connect-welcome-icon">
              <MessagesSquare size={38} />
            </div>
            <h2>{chat.selected ? 'Checking conversation access…' : 'A place to stay connected'}</h2>
            <p>
              {chat.selected
                ? 'Your current permissions are checked before messages appear.'
                : 'Open a conversation to catch up, share updates, or turn a discussion into accountable work.'}
            </p>
            {(error || chat.error) && (
              <p role="alert" className="connect-error">
                {error || chat.error}
              </p>
            )}
            {chat.selected && (
              <button className="button" onClick={() => chat.select('')}>
                Back to conversations
              </button>
            )}
            {!chat.selected && data.me.role !== 'viewer' && (
              <button className="button button-primary" onClick={() => setCreating(true)}>
                <Plus size={17} />
                Message a person
              </button>
            )}
            <small>
              <LockKeyhole size={13} />
              Private conversations stay with their participants.
            </small>
          </div>
        )}
      </section>
      {creating && (
        <NewConversation
          data={data}
          command={chat.command}
          onClose={() => setCreating(false)}
          onOpen={async (id) => {
            await chat.refreshList();
            chat.select(id);
            setCreating(false);
          }}
        />
      )}
      {(panel === 'search' || panel === 'saved') && (
        <Modal
          open
          title={panel === 'saved' ? 'Saved messages' : 'Find messages'}
          description="Results include only messages you can currently access."
          onClose={() => setPanel(null)}
        >
          <div className="connect-dialog-body">
            <DailyTools
              conversation={chat.selected}
              data={data}
              command={chat.command}
              select={(id) => {
                setPanel(null);
                chat.select(id);
              }}
              initialMode={panel === 'saved' ? 'saved' : ''}
            />
          </div>
        </Modal>
      )}
      {panel === 'details' && conversation && (
        <Modal
          open
          title="Conversation details"
          description={label(conversation)}
          onClose={() => setPanel(null)}
        >
          <div className="connect-dialog-body">
            <ConversationSettings
              conversation={conversation}
              members={chat.members}
              data={data}
              command={chat.command}
            />
            {me?.role === 'owner' && data.me.role !== 'viewer' && (
              <label>
                Publication policy
                <select
                  value={conversation.forwarding}
                  onChange={(e) =>
                    run(
                      `/conversations/${chat.selected}`,
                      { expectedVersion: conversation.version, forwarding: e.target.value },
                      'PATCH',
                    )
                  }
                >
                  <option value="deny">Private — no work publication</option>
                  <option value="selected">Explicit selected publication allowed</option>
                </select>
                <small>
                  Task and finance audiences are previewed before any selected content is published.
                </small>
              </label>
            )}
            <button className="button" onClick={() => setPanel('records')}>
              Acknowledgements, polls, events and decisions
            </button>
            {me?.role === 'owner' && conversation.forwarding === 'selected' && (
              <button
                className="button"
                disabled={disabled || !chat.messages.some((m) => !m.removed)}
                onClick={() => {
                  setPanel(null);
                  setExporting(true);
                }}
              >
                Export this authorized page with audit
              </button>
            )}
          </div>
        </Modal>
      )}
      {(panel === 'work' || workSource) && conversation && (
        <Modal
          open
          title={workSource ? 'Publish selected message' : 'Published work'}
          description="Tasks, intake requests and expense drafts use their existing approval controls."
          onClose={() => {
            setPanel(null);
            setWorkSource(null);
          }}
          wide
        >
          <div className="connect-dialog-body">
            <WorkflowTools
              conversation={conversation}
              source={workSource}
              data={data}
              command={chat.command}
              onClose={() => {
                setPanel(null);
                setWorkSource(null);
                void workspace.refresh();
              }}
            />
          </div>
        </Modal>
      )}
      {(panel === 'records' || structured) && conversation && (
        <Modal
          open
          title="Conversation records"
          description="Acknowledgements, polls, events and decisions"
          onClose={() => {
            setPanel(null);
            setStructured(null);
          }}
          wide
        >
          <div className="connect-dialog-body">
            <Structured
              conversation={conversation}
              source={structured}
              data={data}
              command={chat.command}
              onClose={() => {
                setStructured(null);
                setPanel(null);
              }}
            />
          </div>
        </Modal>
      )}
      {thread && conversation && (
        <Modal
          open
          title="Thread"
          description="Replies stay within this conversation’s current permissions."
          onClose={() => setThread(null)}
        >
          <div className="connect-dialog-body connect-thread">
            <blockquote>{thread.root.body}</blockquote>
            {thread.messages.map((m) => (
              <article key={m.id}>
                <strong>
                  {data.people.find((p) => p.id === m.senderId)?.name ?? 'Company member'}
                </strong>
                <p>{m.removed ? 'Message removed' : m.body}</p>
              </article>
            ))}
            {!thread.messages.length && (
              <p className="connect-hint">
                No replies yet. Keep this discussion together with a thread reply.
              </p>
            )}
            <Composer
              members={chat.members}
              names={Object.fromEntries(data.people.map((p) => [p.id, p.name]))}
              disabled={disabled}
              reply={null}
              onClearReply={() => {}}
              send={async (input) => {
                const result = await chat.command<{ message: Message }>(
                  `/conversations/${chat.selected}/messages`,
                  { ...input, replyToId: thread.root.id },
                );
                refreshThread();
                return result;
              }}
            />
          </div>
        </Modal>
      )}
      {actionSource && conversation && (
        <Modal
          open
          title="Message actions"
          description={actionSource.body.slice(0, 100) || 'Attachment'}
          onClose={() => setActionSource(null)}
        >
          <div className="connect-action-menu">
            {[
              ['Reply', disabled, () => setReply(actionSource)],
              ['Open thread', false, () => void openThread(actionSource)],
              [
                'Save privately',
                false,
                () =>
                  run(`/conversations/${chat.selected}/messages/${actionSource.id}/save`, {
                    saved: true,
                  }),
              ],
              ['Remind me privately', false, () => setRemind(actionSource)],
              [
                'React 👍',
                disabled,
                () =>
                  run(`/conversations/${chat.selected}/messages/${actionSource.id}/reactions`, {
                    emoji: '👍',
                    active: true,
                  }),
              ],
              ...(['owner', 'moderator'].includes(me?.role ?? '')
                ? [
                    [
                      'Pin',
                      disabled,
                      () =>
                        run(`/conversations/${chat.selected}/messages/${actionSource.id}/pin`, {
                          pinned: true,
                          expectedRevision: actionSource.revision,
                        }),
                    ],
                  ]
                : []),
              [
                'Create task',
                disabled || conversation.forwarding !== 'selected',
                () => setConversion(actionSource),
              ],
              [
                'Publish request / expense draft',
                disabled || conversation.forwarding !== 'selected',
                () => setWorkSource(actionSource),
              ],
              [
                'Request acknowledgement / poll / decision',
                disabled,
                () => setStructured(actionSource),
              ],
              ...(actionSource.senderId === data.me.id
                ? [
                    ['Edit', disabled, () => setEdit(actionSource)],
                    ['Remove', disabled, () => setRemove(actionSource)],
                  ]
                : []),
            ].map(([name, inactive, fn]) => (
              <button
                key={String(name)}
                disabled={Boolean(inactive)}
                onClick={() => {
                  (fn as () => void)();
                  setActionSource(null);
                }}
              >
                {String(name)}
                <ChevronRight size={16} />
              </button>
            ))}
            {conversation.forwarding === 'deny' && (
              <p>Work publication is disabled by this conversation’s privacy policy.</p>
            )}
          </div>
        </Modal>
      )}
      {edit && (
        <TextAction
          title="Edit message"
          label="Message text"
          initial={edit.body}
          onClose={() => setEdit(null)}
          onSubmit={async (body) => {
            await action(
              `/conversations/${chat.selected}/messages/${edit.id}`,
              { expectedRevision: edit.revision, body },
              'PATCH',
            );
            setEdit(null);
          }}
        />
      )}
      {remind && (
        <TextAction
          title="Private reminder"
          label="Remind me at"
          initial=""
          type="datetime-local"
          description="This reminder is visible only to you. Time uses this device’s timezone."
          onClose={() => setRemind(null)}
          onSubmit={async (at) => {
            await action(`/conversations/${chat.selected}/messages/${remind.id}/save`, {
              saved: true,
              remindAt: new Date(at).toISOString(),
            });
            setRemind(null);
          }}
        />
      )}
      {remove && (
        <TextAction
          title="Remove message"
          label="Type REMOVE to confirm"
          initial=""
          description="The message will be removed for conversation participants."
          onClose={() => setRemove(null)}
          onSubmit={async (value) => {
            if (value !== 'REMOVE') throw Error('Type REMOVE to confirm.');
            await action(
              `/conversations/${chat.selected}/messages/${remove.id}`,
              { expectedRevision: remove.revision, removed: true },
              'PATCH',
            );
            setRemove(null);
          }}
        />
      )}
      {exporting && conversation && (
        <TextAction
          title="Export selected page"
          label="Purpose"
          initial=""
          description={`${chat.messages.filter((m) => !m.removed).length} visible messages will be copied. Exported copies cannot be recalled. Continuing acknowledges this independent copy and records an audit event.`}
          onClose={() => setExporting(false)}
          onSubmit={async (purpose) => {
            const result = await chat.command(`/conversations/${chat.selected}/exports`, {
              expectedPolicyVersion: conversation.version,
              messageIds: chat.messages.filter((m) => !m.removed).map((m) => m.id),
              purpose,
              acknowledgedIndependentCopy: true,
            });
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
            );
            const a = document.createElement('a');
            a.href = url;
            a.download = 'Schach-selected-messages.json';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setExporting(false);
          }}
        />
      )}
      {conversion && conversation && (
        <Modal
          open
          title="Create work from message"
          description="Review the task and its audience before publishing."
          onClose={() => setConversion(null)}
          wide
        >
          <MessageTaskConversion
            message={conversion}
            conversation={conversation}
            data={data}
            command={chat.command}
            onClose={() => {
              setConversion(null);
              void workspace.refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
function TextAction({
  title,
  label,
  initial,
  description,
  type,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  initial: string;
  description?: string;
  type?: string;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open title={title} description={description} onClose={onClose}>
      <form
        className="connect-dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          void onSubmit(value)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          {label}
          {type ? (
            <input required type={type} value={value} onChange={(e) => setValue(e.target.value)} />
          ) : (
            <textarea
              required
              maxLength={20000}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="connect-dialog-footer">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" disabled={busy || !value.trim()}>
            {busy ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
