import { useState } from 'react';
import { LockKeyhole, Globe2 } from 'lucide-react';
import { Avatar } from '../components/UI';
import type { Conversation, Member } from './types';
import type { WorkspaceData } from '../types';
import '../styles/connect-dialogs.css';
export default function ConversationSettings({
  conversation,
  members,
  data,
  command,
}: {
  conversation: Conversation;
  members: Member[];
  data: WorkspaceData;
  command: <T>(path: string, body: unknown, method?: string) => Promise<T>;
}) {
  const [uid, setUid] = useState('');
  const [role, setRole] = useState('member');
  const [error, setError] = useState('');
  const mine = members.find((m) => m.userId === data.me.id);
  const canManage = ['owner', 'moderator'].includes(mine?.role ?? '') && data.me.role !== 'viewer';
  async function change(userId: string, active: boolean, nextRole: string) {
    try {
      await command(`/conversations/${conversation.id}/members`, {
        expectedVersion: conversation.version,
        userId,
        active,
        role: nextRole,
      });
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const roleTone: Record<string, string> = {
    owner: 'pill-orange',
    moderator: 'pill-purple',
    member: 'pill-slate',
    viewer: 'pill-slate',
  };
  return (
    <section className="connect-settings" aria-label="Conversation settings and participants">
      <p className="connect-settings-privacy">
        {conversation.public ? <Globe2 size={15} /> : <LockKeyhole size={15} />}
        {conversation.public
          ? 'Company channel with retained history'
          : 'Private conversation; new and rejoined participants start with future messages'}
      </p>
      <div className="connect-settings-block">
        <h3>
          Participants <span>{members.length}</span>
        </h3>
        <ul className="connect-member-list">
          {members.map((m) => {
            const name = data.people.find((p) => p.id === m.userId)?.name ?? 'Company member';
            return (
              <li key={m.userId}>
                <Avatar name={name} size="sm" />
                <span className="connect-member-name">
                  <strong>{name}</strong>
                  <span className={'pill ' + (roleTone[m.role] ?? 'pill-slate')}>{m.role}</span>
                </span>
                {canManage && conversation.kind !== 'dm' && m.role !== 'owner' && (
                  <span className="connect-member-actions">
                    {mine?.role === 'owner' && (
                      <button
                        className="button button-secondary button-small"
                        aria-label={`Transfer ownership to ${name}`}
                        onClick={() => void change(m.userId, true, 'owner')}
                      >
                        Transfer ownership
                      </button>
                    )}
                    <button
                      className="button button-secondary button-small connect-danger"
                      aria-label={`Remove participant ${name}`}
                      onClick={() => void change(m.userId, false, m.role)}
                    >
                      Remove
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {canManage && conversation.kind !== 'dm' && (
        <div className="connect-settings-block">
          <h3>Add participant</h3>
          <div className="connect-add-member">
            <label>
              Person
              <select value={uid} onChange={(e) => setUid(e.target.value)}>
                <option value="">Choose an active member</option>
                {data.people
                  .filter((p) => p.active && !members.some((m) => m.userId === p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Conversation role
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option>member</option>
                <option>viewer</option>
                <option>moderator</option>
              </select>
            </label>
            <button
              className="button button-secondary"
              disabled={!uid}
              onClick={() => void change(uid, true, role)}
            >
              Add participant
            </button>
          </div>
        </div>
      )}
      {(canManage || conversation.kind === 'dm') && (
        <div className="connect-settings-block connect-settings-manage">
          {canManage && (
            <button
              className="button button-secondary"
              onClick={() =>
                void command(
                  `/conversations/${conversation.id}`,
                  { expectedVersion: conversation.version, archived: !conversation.archived },
                  'PATCH',
                ).catch((e) => setError(e.message))
              }
            >
              {conversation.archived ? 'Reopen conversation' : 'Archive conversation'}
            </button>
          )}
          {conversation.kind === 'dm' && (
            <button
              className="button button-secondary connect-danger"
              onClick={() => {
                const target = members.find((m) => m.userId !== data.me.id);
                if (target)
                  void command('/communication/blocks', {
                    userId: target.userId,
                    blocked: true,
                  }).catch((e) => setError(e.message));
              }}
            >
              Block direct messages and calls from this participant
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="connect-error">
          {error}
        </p>
      )}
    </section>
  );
}
