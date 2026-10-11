import IntelligenceLauncher from './components/IntelligenceLauncher';
import PeopleTools from './components/PeopleTools';
import Connect from './communication/Connect';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowRight,
  Bell,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Command,
  FolderKanban,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Target,
  UsersRound,
  Wallet,
  X,
} from 'lucide-react';
import { useWorkspace } from './store';
import type { TaskFilters, View } from './types';
import { Avatar, cx, ErrorMessage } from './components/UI';
import TaskDrawer from './components/TaskDrawer';
import Overview from './pages/Overview';
import TasksPage, { emptyFilters } from './pages/Tasks';
import Projects from './pages/Projects';
import { CalendarPage, WorkloadPage } from './pages/CalendarWorkload';
import { GoalsPage, ReportsPage } from './pages/GoalsReports';
import Organization, { roleNames } from './pages/Organization';
import { InboxPage, SettingsPage } from './pages/InboxSettings';
import FinancePage from './pages/Finance';

const navigation = [
  { id: 'connect' as View, label: 'Connect', icon: UsersRound, group: 'workspace' },
  { id: 'overview' as View, label: 'Overview', icon: LayoutDashboard, group: 'workspace' },
  { id: 'my-work' as View, label: 'My work', icon: Check, group: 'workspace' },
  { id: 'tasks' as View, label: 'All tasks', icon: ClipboardList, group: 'workspace' },
  { id: 'projects' as View, label: 'Projects', icon: FolderKanban, group: 'workspace' },
  { id: 'calendar' as View, label: 'Calendar', icon: CalendarDays, group: 'workspace' },
  { id: 'workload' as View, label: 'Workload', icon: UsersRound, group: 'management' },
  { id: 'goals' as View, label: 'Goals', icon: Target, group: 'management' },
  { id: 'finance' as View, label: 'Finance', icon: Wallet, group: 'management' },
  { id: 'reports' as View, label: 'Reports', icon: ChartNoAxesCombined, group: 'management' },
  { id: 'people' as View, label: 'People', icon: Building2, group: 'management' },
  { id: 'inbox' as View, label: 'Inbox', icon: Bell, group: 'tools' },
  { id: 'settings' as View, label: 'Settings', icon: Settings, group: 'tools' },
];
const headings: Record<View, { title: string; description: string }> = {
  connect: { title: 'Connect', description: 'Company conversations and accountable work.' },
  overview: {
    title: 'Your business, in focus.',
    description: 'The commitments, decisions and people moving your company forward.',
  },
  'my-work': {
    title: 'My work',
    description: 'Your priorities, commitments and reviews. All in one place.',
  },
  tasks: {
    title: 'All tasks',
    description: 'Clear ownership. Visible progress. Nothing lost in the follow-up.',
  },
  projects: {
    title: 'Projects',
    description: 'Bring people and work together around a shared outcome.',
  },
  calendar: {
    title: 'Calendar',
    description: 'See what is coming. Plan the work before the deadline.',
  },
  workload: {
    title: 'Workload',
    description: 'Balance commitments with the capacity to deliver them.',
  },
  goals: {
    title: 'Goals',
    description: "Keep your team's effort connected to measurable results.",
  },
  finance: {
    title: 'Budgets & expenses',
    description: 'Plan department budgets, review spending and keep every decision accountable.',
  },
  reports: {
    title: 'Delivery reports',
    description: 'Understand the commitments kept, changed and still in progress.',
  },
  people: {
    title: 'People & organisation',
    description: 'Know who owns the work, who leads the team and where support is needed.',
  },
  inbox: {
    title: 'Inbox',
    description: 'The updates that need you, without another status meeting.',
  },
  settings: {
    title: 'Workspace settings',
    description: 'Manage your company, your account and the way work flows.',
  },
};
function hashView(): View {
  const value = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  if (value === 'report') return 'reports';
  return navigation.some((n) => n.id === value) ? (value as View) : 'overview';
}

function Login() {
  const store = useWorkspace();
  const [email, setEmail] = useState(store.mode === 'demo' ? 'founder@schach.demo' : '');
  const [password, setPassword] = useState(store.mode === 'demo' ? 'SchachDemo!2026' : '');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await store.login(email, password, code, recoveryCode);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-story">
        <div className="login-brand">
          <img src="/schach-logo.webp" alt="Schach Engineers" />
          <span>WORKSPACE</span>
        </div>
        <div className="login-story-content">
          <span className="eyebrow">BUILT FOR TEAMS THAT BUILD.</span>
          <h1>
            Every commitment.
            <br />A clear way forward.
          </h1>
          <p>A shared view of your companies, your teams and the work that matters.</p>
          <div className="login-work-card">
            <div className="login-work-top">
              <span className="login-dot" />
              One connected workspace
              <ShieldCheck size={19} />
            </div>
            <div className="login-flow">
              <span>
                <Building2 size={20} />
                Your company
              </span>
              <ChevronRight size={16} />
              <span>
                <UsersRound size={20} />
                Your people
              </span>
              <ChevronRight size={16} />
              <span>
                <Target size={20} />
                Your goals
              </span>
            </div>
            <div className="login-work-footer">
              <span>
                <Check size={14} />
                Clear ownership
              </span>
              <span>
                <Check size={14} />
                Visible progress
              </span>
              <span>
                <Check size={14} />
                Shared accountability
              </span>
            </div>
          </div>
        </div>
        <div className="login-footer">
          SCHACH WORKSPACE<span>Clarity creates momentum.</span>
        </div>
      </section>
      <section className="login-form-section">
        <div className="login-mobile-brand">
          <span className="brand-symbol">S</span>
          <strong>
            schach<span>workspace</span>
          </strong>
        </div>
        <div className="login-form-wrap">
          {store.mode === 'demo' && (
            <span className="pill pill-orange">Interactive demo · fictional sample data</span>
          )}
          <h2>Welcome back.</h2>
          <p>Sign in to see the work moving forward.</p>
          <form onSubmit={login}>
            <ErrorMessage error={error || store.error} />
            <label className="field">
              <span className="field-label">Email address</span>
              <input
                type="email"
                autoComplete="username"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
              />
            </label>
            {store.mode === 'api' && (
              <>
                <label className="field">
                  <span className="field-label">Authenticator code (if enabled)</span>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    maxLength={6}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Recovery code (instead of authenticator)</span>
                  <input
                    autoComplete="off"
                    value={recoveryCode}
                    onChange={(e) => setRecoveryCode(e.target.value)}
                    maxLength={32}
                  />
                </label>
              </>
            )}
            <button
              className="button button-primary login-submit"
              disabled={busy || store.loading}
              type="submit"
            >
              {busy ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <>
                  Sign in
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>
          {store.mode === 'demo' ? (
            <div className="demo-accounts">
              <h3>Explore a different perspective</h3>
              <div>
                {[
                  { name: 'Founder', email: 'founder@schach.demo' },
                  { name: 'CEO', email: 'ceo@schach.demo' },
                  { name: 'Department head', email: 'head@schach.demo' },
                  { name: 'Team member', email: 'member@schach.demo' },
                ].map((account) => (
                  <button
                    className={email === account.email ? 'active' : ''}
                    key={account.email}
                    onClick={() => {
                      setEmail(account.email);
                      setPassword('SchachDemo!2026');
                    }}
                  >
                    {account.name}
                  </button>
                ))}
              </div>
              <p>
                Sample password: <code>SchachDemo!2026</code>
                <br />
                Demonstration people, tasks and business results are fictional.
              </p>
            </div>
          ) : (
            <div className="login-account-help">
              <LockKeyhole size={16} />
              <p>Need an account or password reset? Contact your company administrator.</p>
            </div>
          )}
          <p className="login-privacy">
            <ShieldCheck size={14} />
            Company access is based on your membership and role.
          </p>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  return (
    <PeopleTools>
      <WorkspaceApp />
    </PeopleTools>
  );
}
function WorkspaceApp() {
  const store = useWorkspace();
  const { data, session } = store;
  const [view, setView] = useState<View>(hashView);
  const [filters, setFilters] = useState<TaskFilters>(emptyFilters);
  const [taskId, setTaskId] = useState('');
  useEffect(() => {
    const open = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id) setTaskId(id);
    };
    window.addEventListener('schach-open-task', open);
    return () => window.removeEventListener('schach-open-task', open);
  }, []);
  const [expenseId, setExpenseId] = useState('');
  useEffect(() => {
    const open = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id) setExpenseId(id);
    };
    window.addEventListener('schach-open-expense', open);
    return () => window.removeEventListener('schach-open-expense', open);
  }, []);
  const [initialProject, setInitialProject] = useState('');
  const [projectId, setProjectId] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [localError, setLocalError] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const previousCompany = useRef('');
  useEffect(() => {
    const handler = () => {
      setView(hashView());
      setMobileNav(false);
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setSearch('');
        setSearchFocused(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => {
    if (!data || previousCompany.current === `${data.company.id}/${data.me.id}`) return;
    const prior = previousCompany.current;
    previousCompany.current = `${data.company.id}/${data.me.id}`;
    setFilters(emptyFilters);
    setTaskId('');
    setExpenseId('');
    setProjectId('');
    if (
      prior ||
      !window.location.hash ||
      (data.me.role === 'member' && hashView() === 'overview')
    ) {
      const next =
        data.me.role === 'finance' ? 'finance' : data.me.role === 'member' ? 'my-work' : 'overview';
      setView(next);
      window.location.hash = next;
    }
  }, [data?.company.id, data?.me.id]);
  function navigate(next: View, nextFilters?: Partial<TaskFilters>) {
    setView(next);
    window.location.hash = next;
    setMobileNav(false);
    setSearchFocused(false);
    setSearch('');
    if (next === 'tasks' || next === 'my-work') setFilters({ ...emptyFilters, ...nextFilters });
    if (next === 'projects') setProjectId(nextFilters?.projectId ?? '');
    if (next === 'finance') setExpenseId('');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function openTask(id: string, project = '') {
    if (id !== 'new' && !data?.tasks.some((t) => t.id === id)) {
      store.notify('This task is no longer available in the current workspace.');
      return;
    }
    setInitialProject(project);
    setTaskId(id);
    setSearchFocused(false);
  }
  function openExpense(id: string) {
    if (!data?.expenses.some((e) => e.id === id)) {
      store.notify('This expense is no longer available in the current workspace.');
      return;
    }
    navigate('finance');
    setExpenseId(id);
  }
  async function refresh() {
    setLocalError('');
    try {
      await store.refresh();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Unable to refresh workspace.');
    }
  }
  if (!session)
    return store.loading ? (
      <div className="app-loading">
        <span className="brand-symbol">S</span>
        <LoaderCircle className="spin" size={22} />
        <h2>Opening your workspace…</h2>
      </div>
    ) : (
      <Login />
    );
  if (!data)
    return (
      <div className="app-loading">
        <span className="brand-symbol">S</span>
        {store.loading ? (
          <>
            <LoaderCircle className="spin" size={22} />
            <h2>Connecting the pieces…</h2>
          </>
        ) : (
          <>
            <h2>We couldn't open this workspace.</h2>
            <ErrorMessage error={store.error} />
            <button className="button button-primary" onClick={refresh}>
              Try again
            </button>
            <button className="text-button" onClick={() => store.logout()}>
              Sign out
            </button>
          </>
        )}
      </div>
    );
  const unread = data.notifications.filter((n) => !n.read).length;
  const role = data.me.role;
  const matches = search.trim()
    ? data.tasks
        .filter((t) => `${t.title} ${t.code}`.toLowerCase().includes(search.toLowerCase()))
        .slice(0, 5)
    : [];
  const navItems = navigation.filter(
    (n) =>
      !(role === 'member' && n.id === 'overview') &&
      !(data.financeScope === 'none' && n.id === 'finance'),
  );
  const sidebarContent = (
    <>
      <div className="sidebar-brand">
        <img src="/schach-logo.webp" alt="Schach Engineers" />
        <span>WORKSPACE</span>
      </div>
      <div className="workspace-switch">
        <label>
          <span className="workspace-icon" style={{ background: data.company.color }}>
            {data.company.name.slice(0, 1)}
          </span>
          <span className="workspace-select-wrap">
            <span className="workspace-switch-label">COMPANY WORKSPACE</span>
            <select
              aria-label="Switch company"
              value={data.company.id}
              disabled={store.loading}
              onChange={async (e) => {
                try {
                  await store.switchCompany(e.target.value);
                } catch (err) {
                  setLocalError(err instanceof Error ? err.message : 'Unable to switch company.');
                }
              }}
            >
              {session.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </span>
          <ChevronDown size={13} className="workspace-chevron" />
        </label>
      </div>
      <nav className="sidebar-nav" aria-label="Main navigation">
        {['workspace', 'management', 'tools'].map((group) => (
          <div className={`nav-group nav-group-${group}`} key={group}>
            {group !== 'tools' && (
              <div className="nav-group-label">
                {group === 'workspace' ? 'WORKSPACE' : 'ORGANISATION'}
              </div>
            )}
            {navItems
              .filter((n) => n.group === group)
              .map((n) => (
                <button
                  key={n.id}
                  title={n.label}
                  className={cx('nav-item', view === n.id && 'active')}
                  onClick={() => navigate(n.id)}
                  aria-current={view === n.id ? 'page' : undefined}
                >
                  <n.icon size={18} />
                  <span>{n.label}</span>
                  {n.id === 'inbox' && unread > 0 && <b className="nav-badge">{unread}</b>}
                  {n.id === 'my-work' &&
                    data.tasks.filter(
                      (t) =>
                        t.ownerId === data.me.id && t.status !== 'done' && t.status !== 'cancelled',
                    ).length > 0 && (
                      <b className="nav-count">
                        {
                          data.tasks.filter(
                            (t) =>
                              t.ownerId === data.me.id &&
                              t.status !== 'done' &&
                              t.status !== 'cancelled',
                          ).length
                        }
                      </b>
                    )}
                </button>
              ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-bottom">
        {store.mode === 'demo' && (
          <div className="sidebar-demo">
            <span className="demo-live-dot" />
            <div>
              <strong>Demo workspace</strong>
              <span>Fictional sample data</span>
            </div>
          </div>
        )}
        <div className="sidebar-user">
          <button className="user-profile-button" onClick={() => navigate('settings')}>
            <Avatar person={data.me} />
            <span>
              <strong>{data.me.name}</strong>
              <small>{roleNames[data.me.role]}</small>
            </span>
          </button>
          <button
            className="icon-button signout-button"
            title="Sign out"
            aria-label="Sign out"
            onClick={async () => {
              try {
                await store.logout();
              } catch (e) {
                setLocalError(e instanceof Error ? e.message : 'Unable to sign out.');
              }
            }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </>
  );
  return (
    <div className={cx('app-shell', collapsed && 'sidebar-collapsed')}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">{sidebarContent}</aside>
      <div className="app-main">
        <header className="topbar">
          <IntelligenceLauncher label="Local assistance history" />
          <div className="topbar-left">
            <button
              className="icon-button desktop-collapse"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={() => setCollapsed(!collapsed)}
            >
              <PanelLeftClose size={18} />
            </button>
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={20} />
            </button>
            <div className="breadcrumbs">
              <span>Workspace</span>
              <ChevronRight size={12} />
              <strong>{navigation.find((n) => n.id === view)?.label}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <div className="global-search-wrap">
              <form
                className="global-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  navigate('tasks', { search });
                }}
              >
                <Search size={15} />
                <input
                  ref={searchRef}
                  aria-label="Search workspace"
                  placeholder="Search tasks…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                />
                <kbd>⌘ K</kbd>
              </form>
              {searchFocused && search.trim() && (
                <div className="global-search-results">
                  <span>Tasks in {data.company.name}</span>
                  {matches.map((t) => (
                    <button
                      key={t.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => openTask(t.id)}
                    >
                      <ClipboardList size={16} />
                      <span>
                        <strong>{t.title}</strong>
                        <small>{t.code}</small>
                      </span>
                      <ArrowRight size={14} />
                    </button>
                  ))}
                  {matches.length === 0 && <p>No matching tasks.</p>}
                  <button
                    className="all-search-results"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => navigate('tasks', { search })}
                  >
                    Search all task details
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
            {store.mode === 'demo' && <span className="topbar-demo">DEMO</span>}
            <button
              className="icon-button refresh-button"
              disabled={store.loading}
              aria-label="Refresh workspace"
              onClick={refresh}
            >
              <RefreshCw size={17} className={store.loading ? 'spin' : ''} />
            </button>
            <button
              className="icon-button notification-button"
              aria-label={`Inbox, ${unread} unread notifications`}
              onClick={() => navigate('inbox')}
            >
              <Bell size={18} />
              {unread > 0 && <span />}
            </button>
            <button
              className="topbar-avatar"
              aria-label="My account settings"
              onClick={() => navigate('settings')}
            >
              <Avatar person={data.me} />
            </button>
          </div>
        </header>
        <main id="main-content" className="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <span className="page-eyebrow">
                {view === 'overview'
                  ? `WELCOME BACK, ${data.me.name.split(' ')[0].toUpperCase()}`
                  : data.company.name.toUpperCase()}
              </span>
              <h1>{headings[view].title}</h1>
              <p>{headings[view].description}</p>
            </div>
            {['overview', 'calendar', 'my-work'].includes(view) && role !== 'viewer' && (
              <button
                className="button button-primary page-main-action"
                onClick={() => openTask('new')}
              >
                <Plus size={16} />
                Create task
              </button>
            )}
          </div>
          {(store.error || localError) && (
            <div className="global-error" role="alert">
              <span>{localError || store.error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => {
                  setLocalError('');
                  store.clearError();
                }}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {view === 'overview' && (
            <Overview
              onExpense={openExpense}
              onTask={openTask}
              onNavigate={navigate}
              onProject={(id) => {
                navigate('projects');
                setProjectId(id);
              }}
            />
          )}
          {(view === 'tasks' || view === 'my-work') && (
            <TasksPage
              key={`${data.company.id}-${view}`}
              filters={filters}
              setFilters={setFilters}
              onTask={openTask}
              mine={view === 'my-work'}
            />
          )}
          {view === 'projects' && (
            <Projects selectedId={projectId} onSelect={setProjectId} onTask={openTask} />
          )}
          {view === 'calendar' && <CalendarPage onTask={openTask} />}
          {view === 'workload' && <WorkloadPage onTask={openTask} />}
          {view === 'goals' && <GoalsPage onTask={openTask} />}
          {view === 'reports' && <ReportsPage onTask={openTask} />}
          {view === 'connect' && (
            <Connect
              onTask={openTask}
              key={store.companyId + ':' + (store.session?.user.id ?? '')}
            />
          )}
          {view === 'people' && <Organization onNavigate={navigate} />}
          {view === 'finance' && (
            <FinancePage key={data.company.id} initialExpenseId={expenseId} onOpenTask={openTask} />
          )}
          {view === 'inbox' && <InboxPage onTask={openTask} onExpense={openExpense} />}
          {view === 'settings' && <SettingsPage />}
          <footer className="workspace-footer">
            <span>Schach Workspace</span>
            <span>
              {store.mode === 'demo' ? 'Fictional demo data' : 'Connected workspace'}
              <i />
              {data.company.timezone}
            </span>
          </footer>
        </main>
      </div>
      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        {[
          {
            id: role === 'finance' ? 'finance' : role === 'member' ? 'my-work' : 'overview',
            label: 'Home',
            icon: LayoutDashboard,
          },
          { id: 'tasks', label: 'Tasks', icon: ClipboardList },
          { id: 'projects', label: 'Projects', icon: FolderKanban },
          { id: 'inbox', label: 'Inbox', icon: Bell },
        ].map((n) => (
          <button
            key={n.id}
            className={view === n.id ? 'active' : ''}
            onClick={() => navigate(n.id as View)}
          >
            <n.icon size={20} />
            <span>{n.label}</span>
            {n.id === 'inbox' && unread > 0 && <i />}
          </button>
        ))}
        <button onClick={() => setMobileNav(true)}>
          <Menu size={20} />
          <span>More</span>
        </button>
      </nav>
      <Dialog.Root open={mobileNav} onOpenChange={setMobileNav}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="mobile-sidebar">
            <Dialog.Title className="sr-only">Workspace navigation</Dialog.Title>
            <Dialog.Description className="sr-only">
              Switch company or open a workspace view.
            </Dialog.Description>
            <Dialog.Close
              className="icon-button mobile-sidebar-close"
              aria-label="Close navigation"
            >
              <X size={20} />
            </Dialog.Close>
            {sidebarContent}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {taskId && (
        <TaskDrawer
          key={`${data.company.id}-${taskId}`}
          taskId={taskId}
          initialProject={initialProject}
          onClose={() => setTaskId('')}
        />
      )}
      {store.toast && (
        <div className="toast" role="status">
          <span>
            <Check size={16} />
          </span>
          {store.toast}
        </div>
      )}
    </div>
  );
}
