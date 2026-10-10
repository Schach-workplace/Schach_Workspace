import { useState, type FormEvent } from 'react';
import AuthenticatorSettings from '../components/AuthenticatorSettings';
import {
  ArrowRight,
  Bell,
  Building2,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  KeyRound,
  LockKeyhole,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { useWorkspace } from '../store';
import EntityForm from '../components/EntityForm';
import {
  Avatar,
  canAdmin,
  dateLabel,
  EmptyState,
  ErrorMessage,
  Field,
  Modal,
  relativeTime,
  SaveButton,
} from '../components/UI';
import { roleNames } from './Organization';

export function InboxPage({
  onTask,
  onExpense,
}: {
  onTask: (id: string) => void;
  onExpense: (id: string) => void;
}) {
  const store = useWorkspace();
  const data = store.data!;
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const unread = data.notifications.filter((n) => !n.read);
  const shown = data.notifications
    .filter((n) => filter !== 'unread' || !n.read)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  async function read(ids: string[]) {
    setError('');
    try {
      await store.mutate('/notifications/read', { ids });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update notifications.');
    }
  }
  return (
    <div className="page-content inbox-page">
      <div className="task-toolbar">
        <div className="segmented">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            All updates<span className="count-badge">{data.notifications.length}</span>
          </button>
          <button
            className={filter === 'unread' ? 'active' : ''}
            onClick={() => setFilter('unread')}
          >
            Unread<span className="count-badge">{unread.length}</span>
          </button>
        </div>
        <button
          className="button button-secondary"
          disabled={!unread.length || store.saving}
          onClick={() => read([])}
        >
          <CheckCheck size={15} />
          Mark all read
        </button>
      </div>
      <ErrorMessage error={error} />
      <div className="panel notifications-list">
        {shown.map((n) => {
          const Icon = n.kind.includes('comment')
            ? MessageSquare
            : n.kind.includes('review')
              ? ShieldCheck
              : n.kind.includes('deadline') || n.kind.includes('overdue')
                ? Clock3
                : Bell;
          return (
            <article className={`notification ${n.read ? '' : 'unread'}`} key={n.id}>
              <span
                className={`notification-icon notification-${n.kind.includes('review') ? 'purple' : n.kind.includes('overdue') ? 'red' : 'orange'}`}
              >
                <Icon size={19} />
              </span>
              <div className="notification-content">
                <div className="notification-title">
                  <strong>{n.title}</strong>
                  {!n.read && <span className="unread-dot" aria-label="Unread" />}
                </div>
                <p>{n.body}</p>
                <div className="notification-actions">
                  <time>{relativeTime(n.createdAt)}</time>
                  {n.expenseId && (
                    <button
                      className="text-button"
                      onClick={() => {
                        if (!n.read) void read([n.id]);
                        onExpense(n.expenseId!);
                      }}
                    >
                      Open expense <ArrowRight size={13} />
                    </button>
                  )}
                  {n.taskId && (
                    <button
                      className="text-button"
                      onClick={() => {
                        if (!n.read) read([n.id]);
                        if (data.tasks.some((t) => t.id === n.taskId)) onTask(n.taskId);
                        else
                          store.notify(
                            'This task is no longer available in your current access scope.',
                          );
                      }}
                    >
                      Open task
                      <ArrowRight size={13} />
                    </button>
                  )}
                </div>
              </div>
              {!n.read && (
                <button
                  className="icon-button"
                  disabled={store.saving}
                  aria-label={`Mark ${n.title} as read`}
                  onClick={() => read([n.id])}
                >
                  <Check size={16} />
                </button>
              )}
            </article>
          );
        })}
        {shown.length === 0 && (
          <EmptyState
            icon={<Bell size={29} />}
            title={filter === 'unread' ? "You're all caught up" : 'A quieter way to stay connected'}
            description={
              filter === 'unread'
                ? 'Your unread updates have been handled. New assignments, comments and review requests will appear here.'
                : 'Assignments, comments, reviews and deadline reminders arrive in this inbox.'
            }
          />
        )}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const store = useWorkspace();
  const data = store.data!;
  const [tab, setTab] = useState('company');
  const [editing, setEditing] = useState<'current' | 'new' | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [error, setError] = useState('');
  async function password(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (newPassword !== repeatPassword) {
      setError('Your new passwords do not match.');
      return;
    }
    try {
      await store.mutate('/auth/password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setRepeatPassword('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to change password.');
    }
  }
  return (
    <div className="page-content settings-page">
      <div className="settings-tabs">
        <button className={tab === 'company' ? 'active' : ''} onClick={() => setTab('company')}>
          <Building2 size={16} />
          Company
        </button>
        <button className={tab === 'account' ? 'active' : ''} onClick={() => setTab('account')}>
          <KeyRound size={16} />
          My account
        </button>
        <button className={tab === 'workflow' ? 'active' : ''} onClick={() => setTab('workflow')}>
          <Zap size={16} />
          Workflow
        </button>
      </div>
      <ErrorMessage error={error} />
      {tab === 'company' && (
        <>
          <section className="panel settings-section">
            <div className="section-header">
              <div>
                <h2>Company details</h2>
                <p>Your current workspace identity, calendar and financial settings.</p>
              </div>
              {canAdmin(data) && (
                <button className="button button-secondary" onClick={() => setEditing('current')}>
                  <Pencil size={14} />
                  Edit details
                </button>
              )}
            </div>
            <div className="company-settings-brand">
              <span style={{ background: data.company.color }}>
                <Building2 size={29} />
              </span>
              <div>
                <h2>{data.company.name}</h2>
                <p>{data.company.industry || 'Company workspace'}</p>
              </div>
            </div>
            <dl className="settings-facts">
              <div>
                <dt>Company identifier</dt>
                <dd>{data.company.slug}</dd>
              </div>
              <div>
                <dt>Timezone</dt>
                <dd>{data.company.timezone}</dd>
              </div>
              <div>
                <dt>Currency</dt>
                <dd>{data.company.currency}</dd>
              </div>
              <div>
                <dt>Financial year starts</dt>
                <dd>
                  {new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(
                    new Date(Date.UTC(2026, data.company.fiscalYearStartMonth - 1, 1)),
                  )}
                </dd>
              </div>
              <div>
                <dt>Your role</dt>
                <dd>
                  <span className="pill pill-orange">{roleNames[data.me.role]}</span>
                </dd>
              </div>
              <div>
                <dt>Active members</dt>
                <dd>{data.people.filter((p) => p.active).length}</dd>
              </div>
            </dl>
          </section>
          <section className="panel settings-section">
            <div className="section-header">
              <div>
                <h2>Your companies</h2>
                <p>Membership and permissions are separate in every company.</p>
              </div>
              {store.session?.user.isPlatformAdmin && (
                <button className="button button-primary" onClick={() => setEditing('new')}>
                  <Plus size={15} />
                  Add company
                </button>
              )}
            </div>
            <div className="settings-companies">
              {store.session?.companies.map((c) => (
                <button
                  key={c.id}
                  className={c.id === data.company.id ? 'current' : ''}
                  onClick={() => {
                    if (c.id !== data.company.id)
                      store
                        .switchCompany(c.id)
                        .catch((e) =>
                          setError(e instanceof Error ? e.message : 'Unable to switch company.'),
                        );
                  }}
                >
                  <span
                    className="company-initial"
                    style={{ background: `${c.color}18`, color: c.color }}
                  >
                    {c.name.slice(0, 1)}
                  </span>
                  <div>
                    <strong>{c.name}</strong>
                    <span>{c.industry || c.slug}</span>
                  </div>
                  {c.id === data.company.id ? (
                    <span className="pill pill-green">Current</span>
                  ) : (
                    <ChevronRight size={17} />
                  )}
                </button>
              ))}
            </div>
          </section>
          <section className="panel settings-section">
            <div className="section-header">
              <div>
                <h2>Clear access boundaries</h2>
                <p>Who can see and manage work in this workspace.</p>
              </div>
              <ShieldCheck size={19} />
            </div>
            <div className="permissions-explainer">
              <div>
                <strong>Founder, CEO & company admin</strong>
                <p>Company work, organisation settings, membership and review decisions.</p>
              </div>
              <div>
                <strong>Finance</strong>
                <p>
                  Company budgets, categories, independent expense decisions and payment records.
                  Work access follows their own task assignments.
                </p>
              </div>
              <div>
                <strong>Department head & manager</strong>
                <p>
                  Heads see department work and budgets and may approve colleagues’ expenses within
                  budget. Managers see reporting-team work and their own expenses.
                </p>
              </div>
              <div>
                <strong>Member & viewer</strong>
                <p>
                  Members work on assigned, created and collaborated tasks. Viewers have read-only
                  company work access, with no finance records.
                </p>
              </div>
            </div>
          </section>
        </>
      )}
      {tab === 'account' && (
        <>
          <section className="panel settings-section">
            <div className="section-header">
              <div>
                <h2>Your profile</h2>
                <p>Your identity is shared; your role belongs to this company.</p>
              </div>
            </div>
            <div className="account-profile">
              <Avatar person={data.me} size="lg" />
              <div>
                <h2>{data.me.name}</h2>
                <p>{data.me.email}</p>
                <span className="pill pill-slate">{roleNames[data.me.role]}</span>
              </div>
            </div>
          </section>
          <section className="panel settings-section">
            <div className="section-header">
              <div>
                <h2>Change password</h2>
                <p>Use at least 12 characters. Your other sessions will be signed out.</p>
              </div>
              <LockKeyhole size={19} />
            </div>
            {store.mode==='api'&&<AuthenticatorSettings/>}
            <form className="password-form" onSubmit={password}>
              <Field label="Current password">
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </Field>
              <Field label="New password">
                <input
                  required
                  minLength={12}
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </Field>
              <Field label="Repeat new password">
                <input
                  required
                  minLength={12}
                  type="password"
                  autoComplete="new-password"
                  value={repeatPassword}
                  onChange={(e) => setRepeatPassword(e.target.value)}
                />
              </Field>
              <SaveButton saving={store.saving}>Update password</SaveButton>
            </form>
          </section>
        </>
      )}
      {tab === 'workflow' && (
        <>
          <section className="panel settings-section">
            <div className="section-header">
              <div>
                <h2>Recurring work & reminders</h2>
                <p>Keep recurring commitments and deadline reminders up to date.</p>
              </div>
              <Zap size={20} />
            </div>
            <div className="workflow-description">
              <p>
                Tasks can repeat daily, weekly or monthly. Completed recurring work produces the
                next commitment once. Deadline reminders and nudges stay in the recipient's in-app
                inbox.
              </p>
              {canAdmin(data) && (
                <button
                  className="button button-secondary"
                  disabled={store.saving}
                  onClick={async () => {
                    setError('');
                    try {
                      const result = await store.mutate('/automations/run', {});
                      store.notify(
                        `Processed recurring work: ${result.created ?? 0} tasks created, ${result.reminders ?? 0} reminders.`,
                      );
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : 'Unable to run workflow processing.',
                      );
                    }
                  }}
                >
                  <RefreshCw size={15} />
                  Process now
                </button>
              )}
            </div>
          </section>
          {store.mode === 'demo' && (
            <section className="panel settings-section demo-settings">
              <div className="section-header">
                <div>
                  <h2>Demo workspace</h2>
                  <p>Fictional companies and people, ready for you to explore.</p>
                </div>
                <span className="pill pill-orange">Demo</span>
              </div>
              <div className="workflow-description">
                <p>
                  Your demo changes are saved in this browser. Reset to bring back the original
                  sample tasks, people and projects.
                </p>
                <button className="button button-secondary" onClick={() => setResetOpen(true)}>
                  <RefreshCw size={14} />
                  Reset sample data
                </button>
              </div>
            </section>
          )}
        </>
      )}
      {editing && (
        <EntityForm
          kind="company"
          item={editing === 'current' ? data.company : undefined}
          onClose={() => setEditing(null)}
        />
      )}
      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset the demo workspace?"
        description="This replaces your browser's demo changes with the original fictional sample data."
      >
        <div className="entity-form">
          <p className="muted">
            Tasks, comments, projects and company changes made in this demo will be reset.
          </p>
          <div className="form-actions">
            <button className="button button-secondary" onClick={() => setResetOpen(false)}>
              Keep my changes
            </button>
            <button
              className="button button-primary"
              disabled={store.saving}
              onClick={async () => {
                try {
                  await store.resetDemo();
                  setResetOpen(false);
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Unable to reset demo.');
                }
              }}
            >
              Reset demo
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
