import { ApiError } from './api';
import {
  defaultAttentionPreference,
  attentionIntent,
  type AttentionView,
  type AttentionTransitionInput,
  type AttentionPreference,
} from '../../../shared/attention/types';
import { validateDeadline, deadlineChanged } from './deadlines';
// Explicit local demonstration adapter. Real company security is enforced by the Go API.
import fixture from './sample.json';
import type {
  Attachment,
  Company,
  CreateTaskInput,
  Department,
  Goal,
  MutationResult,
  Person,
  Project,
  Session,
  Task,
  WorkspaceData,
} from '../types';
import { addDays, todayInTimezone } from './metrics';
import { validDate } from './imports';
import { fiscalYearStart } from './finance';
import {
  appendDemoReceipt,
  canReadExpense,
  defaultExpenseCategories,
  financeAudit,
  financeRead,
  hydrateFinance,
  managesFinance,
  mutateDemoFinance,
  receiptExpense,
  validateFinanceSettings,
} from './demo-finance';

interface DemoAttentionRow {
  id: string;
  companyId: string;
  recipientId: string;
  sourceKind: 'task' | 'expense';
  sourceId: string;
  sourceRevision: number;
  occurrenceKey: string;
  kind: AttentionView['kind'];
  state: AttentionView['state'];
  version: number;
  snoozedUntil: string | null;
}
interface DemoDatabase {
  businessRetries?: Record<string, { hash: string; result: MutationResult }>;
  attention?: DemoAttentionRow[];
  attentionRetries?: Record<
    string,
    { hash: string; itemId: string; resultItemId: string; resultVersion: number }
  >;
  attentionPreferences?: Record<string, AttentionPreference>;
  schema: 1;
  sessions: Session[];
  workspaces: WorkspaceData[];
  passwords: Record<string, string>;
  generated: Record<string, string>;
}
const KEY = 'schach.workspace.demo.v1';
const USER_KEY = 'schach.workspace.demo.user';
let memory: DemoDatabase | undefined;
let selectedUser: string | undefined;
const clone = <T>(v: T): T => structuredClone(v);
const id = () => globalThis.crypto.randomUUID();
const stamp = () => new Date().toISOString();
const leadership = (p: Person) => ['founder', 'ceo', 'admin'].includes(p.role);
const fail = (text: string): never => {
  throw new Error(text);
};

function shiftedFixture(): DemoDatabase {
  const delta = Math.round(
    (Date.parse(todayInTimezone('Asia/Kolkata') + 'T12:00:00Z') -
      Date.parse(fixture.anchorDate + 'T12:00:00Z')) /
      86400000,
  );
  const move = (v: unknown): unknown => {
    if (typeof v === 'string' && /^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\dZ)?$/.test(v)) {
      if (v.length === 10) return addDays(v, delta);
      return new Date(Date.parse(v) + delta * 86400000).toISOString();
    }
    if (Array.isArray(v)) return v.map(move);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, value]) => [k, move(value)]));
    return v;
  };
  const data = move(clone(fixture)) as { sessions: Session[]; workspaces: WorkspaceData[] };
  for (const w of data.workspaces) {
    hydrateFinance(w);
    const original = fixture.workspaces.find(
      (source) => source.company.id === w.company.id,
    ) as unknown as WorkspaceData;
    const yearDelta =
      fiscalYearStart(todayInTimezone(w.company.timezone), w.company.fiscalYearStartMonth) -
      fiscalYearStart(fixture.anchorDate, w.company.fiscalYearStartMonth);
    for (const budget of w.budgets) {
      const before = original.budgets?.find((b) => b.id === budget.id);
      if (!before) continue;
      budget.startDate = `${Number(before.startDate.slice(0, 4)) + yearDelta}${before.startDate.slice(4)}`;
      budget.endDate = `${Number(before.endDate.slice(0, 4)) + yearDelta}${before.endDate.slice(4)}`;
      budget.createdAt = `${budget.startDate}T00:00:00Z`;
      budget.updatedAt = `${budget.status === 'closed' ? budget.endDate : todayInTimezone(w.company.timezone)}T00:00:00Z`;
    }
  }
  return { schema: 1, ...data, passwords: {}, generated: {} };
}
function hydrateDB(db: DemoDatabase): DemoDatabase {
  for (const w of db.workspaces) hydrateFinance(w);
  for (const s of db.sessions)
    s.companies = s.companies.map(
      (c) =>
        db.workspaces.find((w) => w.company.id === c.id)?.company ?? {
          ...c,
          currency: c.currency || 'INR',
          fiscalYearStartMonth: c.fiscalYearStartMonth || 4,
        },
    );
  return db;
}
function readDB(): DemoDatabase {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as DemoDatabase;
      if (d.schema === 1 && Array.isArray(d.workspaces) && Array.isArray(d.sessions))
        return hydrateDB(d);
    }
  } catch {
    /* Local file/private browsing can use memory. */
  }
  if (!memory) memory = shiftedFixture();
  return hydrateDB(clone(memory));
}
function saveDB(db: DemoDatabase): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    fail(
      'Your browser storage is full or unavailable. Export your tasks, then use the server edition for durable shared storage.',
    );
  }
  memory = clone(db);
}
function setSelected(value: string) {
  selectedUser = value;
  try {
    globalThis.localStorage?.setItem(USER_KEY, value);
  } catch {
    /* Only a local demonstration preference. */
  }
}
function selected() {
  if (selectedUser) return selectedUser;
  try {
    return globalThis.localStorage?.getItem(USER_KEY) ?? 'u-founder';
  } catch {
    return 'u-founder';
  }
}
export function initialDemoSession(): Session | null {
  return readDB().sessions.find((s) => s.user.id === selected()) ?? null;
}
export async function demoLogin(email: string, password: string): Promise<Session> {
  const db = readDB();
  const s = db.sessions.find((s) => s.user.email.toLowerCase() === email.trim().toLowerCase());
  if (!s || (db.passwords[s.user.id] ?? 'SchachDemo!2026') !== password)
    fail('Use a sample account and the demonstration password shown on the sign-in screen.');
  if (
    !s!.companies.some((c) =>
      db.workspaces
        .find((w) => w.company.id === c.id)
        ?.people.some((p) => p.id === s!.user.id && p.active),
    )
  )
    fail('This sample account has no active company memberships.');
  setSelected(s!.user.id);
  return clone(s!);
}
export async function demoLogout() {
  setSelected('guest');
}
export async function resetDemo() {
  memory = shiftedFixture();
  saveDB(memory);
  setSelected('u-founder');
  return initialDemoSession()!;
}
export function currentDemoSession(userId: string): Session {
  const db = readDB();
  const s = db.sessions.find((s) => s.user.id === userId);
  if (!s) fail('Please sign in again.');
  return clone({
    ...s!,
    companies: s!.companies.filter((c) =>
      db.workspaces
        .find((w) => w.company.id === c.id)
        ?.people.some((p) => p.id === userId && p.active),
    ),
  });
}
function context(db: DemoDatabase, companyId: string, userId: string) {
  const w = db.workspaces.find((w) => w.company.id === companyId);
  const me = w?.people.find((p) => p.id === userId && p.active);
  if (!w || !me) fail('You do not have access to this company.');
  return { w: w!, me: me! };
}
function reports(w: WorkspaceData, userId: string): Set<string> {
  const result = new Set([userId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of w.people)
      if (p.managerId && result.has(p.managerId) && !result.has(p.id)) {
        result.add(p.id);
        changed = true;
      }
  }
  return result;
}
export function canReadDemoTask(w: WorkspaceData, me: Person, t: Task): boolean {
  if (leadership(me) || me.role === 'viewer') return true;
  if ([t.ownerId, t.createdBy, t.reviewerId, ...t.collaborators].includes(me.id)) return true;
  if (me.role === 'head' && !!me.departmentId && me.departmentId === t.departmentId) return true;
  return me.role === 'manager' && reports(w, me.id).has(t.ownerId);
}
function canStructure(w: WorkspaceData, me: Person, t: Task) {
  return (
    leadership(me) ||
    (me.role === 'head' && !!me.departmentId && me.departmentId === t.departmentId) ||
    (me.role === 'manager' && reports(w, me.id).has(t.ownerId))
  );
}
function canManage(w: WorkspaceData, me: Person, t: Task) {
  return (
    me.role !== 'viewer' && (canStructure(w, me, t) || t.ownerId === me.id || t.createdBy === me.id)
  );
}
function assertAdmin(me: Person) {
  if (!leadership(me))
    fail('Only company leadership or an administrator can change these settings.');
}
function person(w: WorkspaceData, personId: string) {
  const p = w.people.find((p) => p.id === personId && p.active);
  if (!p) fail('Choose an active person in this company.');
  return p!;
}
function audit(w: WorkspaceData, userId: string, taskId: string, action: string, detail: string) {
  w.activities.unshift({
    id: id(),
    companyId: w.company.id,
    userId,
    taskId,
    action,
    detail,
    createdAt: stamp(),
  });
}
function ping(
  w: WorkspaceData,
  userId: string,
  taskId: string,
  title: string,
  body: string,
  kind: string,
) {
  w.notifications.unshift({
    id: id(),
    companyId: w.company.id,
    userId,
    taskId,
    title,
    body,
    kind,
    read: false,
    createdAt: stamp(),
  });
}
export async function readDemoWorkspace(companyId: string, userId: string): Promise<WorkspaceData> {
  const { w, me } = context(readDB(), companyId, userId);
  return scopedDemoWorkspace(w, me);
}
function scopedDemoWorkspace(w: WorkspaceData, me: Person): WorkspaceData {
  const allowed = w.tasks.filter((t) => canReadDemoTask(w, me, t));
  const taskIds = new Set(allowed.map((t) => t.id));
  const full = leadership(me) || me.role === 'viewer';
  const team = reports(w, me.id);
  const scoped = (userId: string) =>
    full ||
    userId === me.id ||
    w.people.some(
      (p) =>
        p.id === userId &&
        p.active &&
        ((me.role === 'head' && !!me.departmentId && p.departmentId === me.departmentId) ||
          (me.role === 'manager' && team.has(userId))),
    );
  const departmentScope = (departmentId: string) =>
    me.role === 'head' && !!departmentId && departmentId === me.departmentId;
  const projects = w.projects.filter(
    (p) =>
      full ||
      scoped(p.ownerId) ||
      departmentScope(p.departmentId) ||
      allowed.some((t) => t.projectId === p.id),
  );
  const goals = w.goals
    .filter((g) => full || scoped(g.ownerId) || departmentScope(g.departmentId))
    .map((g) => ({ ...g, taskIds: g.taskIds.filter((id) => taskIds.has(id)) }));
  const financial = financeRead(w, me, taskIds, new Set(projects.map((p) => p.id)));
  const relevantPeople = new Set([
    me.id,
    ...allowed.flatMap((t) => [
      t.ownerId,
      t.createdBy,
      t.reviewerId,
      ...t.collaborators,
      ...t.comments.map((c) => c.userId),
      ...t.timeEntries.map((e) => e.userId),
      ...t.attachments.map((a) => a.uploadedBy),
    ]),
    ...financial.expenses.flatMap((e) => [
      e.createdBy,
      e.reviewedBy,
      e.paidBy,
      ...e.receipts.map((receipt) => receipt.uploadedBy),
    ]),
    ...financial.budgets.map((b) => b.createdBy),
    ...financial.financeEvents.map((event) => event.userId),
  ]);
  const people = w.people.filter((p) => scoped(p.id) || relevantPeople.has(p.id));
  const relevantDepartments = new Set([
    me.departmentId,
    ...people.map((p) => p.departmentId),
    ...allowed.map((t) => t.departmentId),
    ...financial.expenses.map((e) => e.departmentId),
  ]);
  const expenseIds = new Set(financial.expenses.map((e) => e.id));
  return clone({
    ...w,
    ...financial,
    me,
    people,
    projects,
    goals,
    departments: w.departments.filter(
      (d) => full || managesFinance(me) || relevantDepartments.has(d.id),
    ),
    tasks: allowed.map((t) => ({
      ...t,
      dependencies: t.dependencies.filter((id) => taskIds.has(id)),
      parentId: taskIds.has(t.parentId) ? t.parentId : '',
    })),
    activities: w.activities
      .filter((a) => (a.taskId ? taskIds.has(a.taskId) : full))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 1000),
    notifications: w.notifications.filter(
      (n) =>
        n.userId === me.id &&
        (!n.taskId || taskIds.has(n.taskId)) &&
        (!n.expenseId || expenseIds.has(n.expenseId)),
    ),
  });
}

function taskBy(w: WorkspaceData, me: Person, taskId: string) {
  const t = w.tasks.find((t) => t.id === taskId && canReadDemoTask(w, me, t));
  if (!t) fail('Task not found in your accessible workspace.');
  return t!;
}
function canAssign(w: WorkspaceData, me: Person, owner: Person) {
  return (
    leadership(me) ||
    (me.role === 'head' && owner.departmentId === me.departmentId) ||
    (me.role === 'manager' && reports(w, me.id).has(owner.id)) ||
    owner.id === me.id
  );
}
function validateTask(w: WorkspaceData, me: Person, t: Task, previous?: Task) {
  validateDeadline(t);
  if (!t.title.trim() || t.title.length > 240) fail('Task title must contain 1–240 characters.');
  if (!validDate(t.dueDate) || (t.startDate && !validDate(t.startDate)))
    fail('Choose valid start and deadline dates.');
  if (t.startDate && t.startDate > t.dueDate)
    fail('The deadline cannot be earlier than the start date.');
  if (!Number.isFinite(t.estimatedHours) || t.estimatedHours < 0 || t.estimatedHours > 10000)
    fail('Estimated hours must be between 0 and 10,000.');
  if (!Number.isFinite(t.progress) || t.progress < 0 || t.progress > 100)
    fail('Progress must be between 0 and 100.');
  if (
    !['backlog', 'todo', 'in_progress', 'blocked', 'in_review', 'done', 'cancelled'].includes(
      t.status,
    )
  )
    fail('Choose a valid task status.');
  if (!['critical', 'high', 'medium', 'low'].includes(t.priority)) fail('Choose a valid priority.');
  if (!['none', 'daily', 'weekly', 'monthly'].includes(t.recurrence))
    fail('Choose a supported repeat interval.');
  const owner = person(w, t.ownerId);
  if (!canAssign(w, me, owner)) fail('You can assign work only within your reporting scope.');
  if (t.departmentId && !w.departments.some((d) => d.id === t.departmentId))
    fail('Choose a department in this company.');
  if (!leadership(me) && t.departmentId !== owner.departmentId)
    fail('The task must belong to its owner’s department.');
  if (t.projectId && !w.projects.some((p) => p.id === t.projectId))
    fail('Choose a project in this company.');
  if (t.reviewerId && person(w, t.reviewerId).role === 'viewer')
    fail('Choose a reviewer who can review work; viewers have read-only access.');
  if (t.requiresApproval && (!t.reviewerId || t.reviewerId === t.ownerId))
    fail('Choose a reviewer other than the task owner.');
  if (
    previous &&
    previous.ownerId === me.id &&
    previous.requiresApproval &&
    (t.requiresApproval !== previous.requiresApproval || t.reviewerId !== previous.reviewerId)
  )
    fail('Ask an independent manager to change the review of your own task.');
  if (previous && previous.requiresApproval && !t.requiresApproval)
    fail('A required review cannot be removed from an existing task.');
  if (
    previous &&
    !canStructure(w, me, previous) &&
    (
      [
        'ownerId',
        'reviewerId',
        'requiresApproval',
        'departmentId',
        'projectId',
        'parentId',
        'recurrence',
      ] as const
    ).some((k) => t[k] !== previous[k])
  )
    fail(
      'A manager must change task ownership, review, project, recurrence or reporting structure.',
    );
  if (
    previous &&
    !canStructure(w, me, previous) &&
    JSON.stringify(t.dependencies) !== JSON.stringify(previous.dependencies)
  )
    fail('A manager must change task dependencies.');
  for (const depId of [...t.dependencies, ...(t.parentId ? [t.parentId] : [])]) {
    if (depId === t.id) fail('A task cannot depend on or be a child of itself.');
    const dep = taskBy(w, me, depId);
    if (dep.companyId !== w.company.id) fail('Related tasks must belong to this company.');
  }
  for (const userId of t.collaborators) person(w, userId);
  const graph = w.tasks.filter((x) => x.id !== t.id).concat(t);
  const hasCycle = (
    current: string,
    target: string,
    seen: Set<string>,
    parent: boolean,
  ): boolean => {
    if (current === target) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    const item = graph.find((x) => x.id === current);
    const next = parent ? (item?.parentId ? [item.parentId] : []) : (item?.dependencies ?? []);
    return next.some((n) => hasCycle(n, target, seen, parent));
  };
  if (t.dependencies.some((d) => hasCycle(d, t.id, new Set(), false)))
    fail('That dependency would create a cycle.');
  if (t.parentId && hasCycle(t.parentId, t.id, new Set(), true))
    fail('That parent would create a cycle.');
  if (t.status === 'blocked' && !t.blockerReason.trim()) fail('Explain what is blocking the task.');
}
function readyForCompletion(w: WorkspaceData, t: Task) {
  if (t.checklist.some((item) => !item.done))
    fail('Complete every checklist item before submitting this work.');
  if (t.dependencies.some((dep) => w.tasks.find((x) => x.id === dep)?.status !== 'done'))
    fail('Complete the prerequisite tasks first.');
  if (
    w.tasks.some(
      (child) => child.parentId === t.id && !['done', 'cancelled'].includes(child.status),
    )
  )
    fail('Complete the subtasks first.');
}
function createTask(w: WorkspaceData, me: Person, body: Record<string, unknown>): Task {
  if (me.role === 'viewer') fail('This company membership is read-only.');
  const input = body as unknown as Partial<CreateTaskInput>;
  const now = stamp();
  const t: Task = {
    id: id(),
    code: `${w.company.slug.toUpperCase().slice(0, 3)}-${1001 + w.tasks.length}`,
    companyId: w.company.id,
    title: input.title?.trim() ?? '',
    description: input.description ?? '',
    ownerId: input.ownerId ?? me.id,
    createdBy: me.id,
    reviewerId: input.reviewerId ?? '',
    departmentId: input.departmentId ?? me.departmentId,
    projectId: input.projectId ?? '',
    parentId: input.parentId ?? '',
    status: input.status ?? 'todo',
    priority: input.priority ?? 'medium',
    dueDate: input.dueDate ?? '',
    originalDueDate: input.dueDate ?? '',
    deadlineMode: input.deadlineMode ?? 'all_day',
    dueAt: input.dueAt ?? '',
    dueTimezone: input.dueTimezone ?? '',
    originalDeadlineMode: input.deadlineMode ?? 'all_day',
    originalDueAt: input.dueAt ?? '',
    originalDueTimezone: input.dueTimezone ?? '',
    startDate: input.startDate ?? '',
    progress: 0,
    estimatedHours: input.estimatedHours ?? 1,
    actualHours: 0,
    tags: input.tags ?? [],
    checklist: input.checklist ?? [],
    dependencies: input.dependencies ?? [],
    collaborators: input.collaborators ?? [],
    recurrence: input.recurrence ?? 'none',
    requiresApproval: input.requiresApproval ?? !!input.reviewerId,
    blockerReason: String(body.blockerReason ?? ''),
    deadlineChangeReason: '',
    completedAt: '',
    createdAt: now,
    updatedAt: now,
    version: 1,
    comments: [],
    timeEntries: [],
    attachments: [],
  };
  if (!['todo', 'backlog'].includes(t.status)) fail('New tasks begin in To do or Backlog.');
  validateTask(w, me, t);
  w.tasks.push(t);
  audit(w, me.id, t.id, 'task_created', `${t.code} · ${t.title}`);
  ping(w, t.ownerId, t.id, 'A new task is assigned to you', t.title, 'assignment');
  return t;
}

export async function demoMutate(
  companyId: string,
  userId: string,
  path: string,
  body: unknown = {},
  method: 'POST' | 'PATCH' = 'POST',
): Promise<MutationResult> {
  if (path.startsWith('/attention/')) return demoAttentionMutation(companyId, userId, path, body);
  const db = readDB();
  const session = db.sessions.find((s) => s.user.id === userId);
  if (!session) fail('Please sign in.');
  const b = (body ?? {}) as Record<string, any>;
  if (path === '/auth/password') {
    if ((db.passwords[userId] ?? 'SchachDemo!2026') !== b.currentPassword)
      fail('Current password is incorrect.');
    if (String(b.newPassword ?? '').length < 12)
      fail('Use a new password of at least 12 characters.');
    db.passwords[userId] = b.newPassword;
    saveDB(db);
    return { ok: true };
  }
  if (path === '/companies' && method === 'POST') {
    if (!session!.user.isPlatformAdmin) fail('Only the platform owner can add a company.');
    const name = String(b.name ?? '').trim();
    const slug = String(b.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).trim();
    if (!name || !slug || !/^[a-z0-9][a-z0-9-]{1,48}$/.test(slug))
      fail('Enter a company name and a unique lowercase slug (2–49 letters, numbers or hyphens).');
    if (db.workspaces.some((w) => w.company.slug === slug))
      fail('That company slug already exists.');
    try {
      todayInTimezone(b.timezone || 'Asia/Kolkata');
    } catch {
      fail('Choose a valid IANA timezone.');
    }
    const c: Company = {
      id: id(),
      name,
      slug,
      industry: b.industry ?? '',
      timezone: b.timezone || 'Asia/Kolkata',
      color: b.color || '#F97316',
      createdAt: stamp(),
      currency: b.currency || 'INR',
      fiscalYearStartMonth: Number(b.fiscalYearStartMonth ?? 4),
    };
    const me: Person = {
      id: userId,
      membershipId: id(),
      name: session!.user.name,
      email: session!.user.email,
      role: 'founder',
      departmentId: '',
      managerId: '',
      title: 'Founder',
      capacityHours: 40,
      avatar: session!.user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2),
      active: true,
    };
    const newWorkspace: WorkspaceData = {
      company: c,
      me,
      people: [me],
      departments: [],
      tasks: [],
      projects: [],
      goals: [],
      activities: [],
      notifications: [],
      financeScope: 'company',
      expenseCategories: defaultExpenseCategories(c.id),
      budgets: [],
      expenses: [],
      financeEvents: [],
    };
    Object.assign(c, validateFinanceSettings(newWorkspace, b));
    db.workspaces.push(newWorkspace);
    session!.companies.push(c);
    saveDB(db);
    return { ok: true, id: c.id };
  }
  const { w, me } = context(db, companyId, userId);
  for (const p of w.projects) {
    p.version ??= 1;
    p.taskOwnerPolicy ??= 'actor';
    p.defaultTaskOwnerId ??= '';
    p.defaultReviewerId ??= '';
    p.defaultRequiresApproval ??= false;
  }
  const parts = path.replace(/^\//, '').split('/').filter(Boolean);
  const keyed = (path === '/tasks' || path === '/tasks/import') && Object.hasOwn(b, 'retryKey');
  const retryIdentity = JSON.stringify([companyId, userId, path, b.retryKey]);
  const retryHash = JSON.stringify(
    Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'retryKey')),
  );
  if (keyed) {
    if (typeof b.retryKey !== 'string' || !b.retryKey.trim() || b.retryKey.length > 100)
      fail('A retry key is required.');
    if (me.role === 'viewer') fail('Read-only membership.');
    for (const row of path === '/tasks/import' ? b.rows : [b]) {
      if (!w.people.some((p) => p.id === row.ownerId && p.active)) fail('Owner unavailable.');
      if (row.projectId && !scopedDemoWorkspace(w, me).projects.some((p) => p.id === row.projectId))
        fail('Project unavailable.');
    }
    const old = db.businessRetries?.[retryIdentity];
    if (old) {
      if (old.hash !== retryHash) fail('This retry intent changed.');
      for (const id of old.result.ids ?? (old.result.id ? [old.result.id] : [])) taskBy(w, me, id);
      return clone(old.result);
    }
  }
  let result: MutationResult = { ok: true };
  if (['expense-categories', 'budgets', 'expenses'].includes(parts[0])) {
    const visible = scopedDemoWorkspace(w, me);
    result = mutateDemoFinance(w, me, parts, b, method, {
      taskIds: new Set(visible.tasks.map((t) => t.id)),
      projectIds: new Set(visible.projects.map((p) => p.id)),
    });
    saveDB(db);
    return result;
  }
  if (!parts.length && method === 'PATCH') {
    assertAdmin(me);
    const priorFinanceSettings = `${w.company.currency}; financial year starts in month ${w.company.fiscalYearStartMonth}`;
    const financialSettings = validateFinanceSettings(w, b);
    const settingsChanged =
      financialSettings.currency !== w.company.currency ||
      financialSettings.fiscalYearStartMonth !== w.company.fiscalYearStartMonth;
    Object.assign(w.company, financialSettings);
    if (settingsChanged)
      financeAudit(
        w,
        me,
        'settings',
        w.company.id,
        '',
        'financial_settings_updated',
        `${priorFinanceSettings} → ${w.company.currency}; financial year starts in month ${w.company.fiscalYearStartMonth}`,
      );
    if (!String(b.name ?? w.company.name).trim()) fail('Company name is required.');
    if (b.timezone) {
      try {
        todayInTimezone(b.timezone);
      } catch {
        fail('Choose a valid IANA timezone.');
      }
    }
    for (const key of ['name', 'industry', 'timezone', 'color'] as const)
      if (b[key] !== undefined) w.company[key] = String(b[key]);
    for (const s of db.sessions)
      s.companies = s.companies.map((c) => (c.id === w.company.id ? clone(w.company) : c));
    audit(w, me.id, '', 'company_updated', 'Company settings updated');
  } else if (parts[0] === 'tasks' && parts[1] === 'import') {
    if (!Array.isArray(b.rows) || !b.rows.length || b.rows.length > 200)
      fail('Import between 1 and 200 tasks.');
    result.ids = [];
    b.rows.forEach((row: Record<string, unknown>, i: number) => {
      try {
        result.ids!.push(createTask(w, me, row).id);
      } catch (e) {
        fail(`Row ${i + 2}: ${(e as Error).message}`);
      }
    });
    result.created = b.rows.length;
  } else if (parts[0] === 'tasks' && !parts[1]) {
    result.id = createTask(w, me, b).id;
  } else if (parts[0] === 'tasks') {
    const t = taskBy(w, me, parts[1]);
    const action = parts[2];
    if (me.role === 'viewer') fail('This company membership is read-only.');
    if (!action && method === 'PATCH') {
      if (!canManage(w, me, t)) fail('You cannot edit this task.');
      if (b.version !== t.version)
        fail('This task changed since you opened it. Refresh and try your change again.');
      const allowed = [
        'title',
        'description',
        'ownerId',
        'reviewerId',
        'departmentId',
        'projectId',
        'parentId',
        'priority',
        'status',
        'dueDate',
        'startDate',
        'estimatedHours',
        'tags',
        'checklist',
        'dependencies',
        'collaborators',
        'recurrence',
        'requiresApproval',
        'progress',
        'blockerReason',
        'deadlineChangeReason',
        'deadlineMode',
        'dueAt',
        'dueTimezone',
      ];
      const next = { ...t };
      for (const key of allowed)
        if (b[key] !== undefined) (next as unknown as Record<string, unknown>)[key] = clone(b[key]);
      if (deadlineChanged(next, t) && !String(b.deadlineChangeReason ?? '').trim())
        fail('Explain why the deadline is changing.');
      if (t.status === 'done' && next.status === 'done')
        fail('Reopen an accepted task before changing its content.');
      if (next.status === 'done' && next.requiresApproval)
        fail('Submit this task for review. The reviewer must accept it.');
      if (next.status === 'in_review' || next.status === 'done') readyForCompletion(w, next);
      validateTask(w, me, next, t);
      if (next.status === 'in_review') {
        next.progress = 100;
        ping(w, next.reviewerId, t.id, 'Work is ready for your review', next.title, 'review');
      }
      if (next.status === 'done') {
        next.progress = 100;
        next.completedAt = stamp();
      } else if (t.status === 'done') next.completedAt = '';
      const dueDetail = deadlineChanged(next, t)
        ? `Deadline changed from ${t.dueDate} to ${next.dueDate}. ${b.deadlineChangeReason}`
        : `${t.status} → ${next.status} · ${next.progress}% progress`;
      if (next.ownerId !== t.ownerId)
        ping(w, next.ownerId, t.id, 'A task has been assigned to you', next.title, 'assignment');
      Object.assign(t, next, { version: t.version + 1, updatedAt: stamp() });
      audit(
        w,
        me.id,
        t.id,
        next.dueDate !== t.originalDueDate && b.dueDate ? 'deadline_changed' : 'task_updated',
        dueDetail,
      );
    } else if (action === 'comments') {
      const text = String(b.body ?? '').trim();
      if (!text || text.length > 10000) fail('Enter a comment of 1–10,000 characters.');
      t.comments.push({ id: id(), userId: me.id, body: text, createdAt: stamp() });
      audit(w, me.id, t.id, 'comment_added', text);
      if (me.id !== t.ownerId)
        ping(w, t.ownerId, t.id, 'New comment on your task', text, 'comment');
    } else if (action === 'time') {
      if (!canManage(w, me, t) && t.reviewerId !== me.id && !t.collaborators.includes(me.id))
        fail('You cannot log time to this task.');
      const hours = Number(b.hours);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 24 || !validDate(String(b.date ?? '')))
        fail('Log more than 0 and at most 24 hours with a valid date.');
      t.timeEntries.push({
        id: id(),
        userId: me.id,
        hours,
        date: b.date,
        note: String(b.note ?? ''),
        createdAt: stamp(),
      });
      t.actualHours = Math.round((t.actualHours + hours) * 100) / 100;
      t.version++;
      t.updatedAt = stamp();
      audit(w, me.id, t.id, 'time_logged', `${hours} hours · ${b.note ?? ''}`);
    } else if (action === 'review') {
      if (t.ownerId === me.id) fail('You cannot approve or review your own task.');
      if (t.reviewerId !== me.id && !leadership(me))
        fail('Only the assigned reviewer or company leadership can review this task.');
      if (t.status !== 'in_review') fail('This task is not awaiting review.');
      if (b.version !== t.version) fail('The task has changed. Refresh before reviewing.');
      if (!['approve', 'request_changes'].includes(b.decision))
        fail('Choose an approval decision.');
      if (b.decision === 'approve') {
        readyForCompletion(w, t);
        t.status = 'done';
        t.completedAt = stamp();
        t.progress = 100;
      } else {
        if (!String(b.comment ?? '').trim()) fail('Explain the changes required.');
        t.status = 'in_progress';
        t.progress = 90;
      }
      t.version++;
      t.updatedAt = stamp();
      audit(
        w,
        me.id,
        t.id,
        b.decision === 'approve' ? 'work_accepted' : 'changes_requested',
        String(b.comment || 'Work accepted'),
      );
      if (b.comment)
        t.comments.push({ id: id(), userId: me.id, body: String(b.comment), createdAt: stamp() });
      ping(
        w,
        t.ownerId,
        t.id,
        b.decision === 'approve' ? 'Your work was accepted' : 'Changes requested',
        String(b.comment || t.title),
        'review',
      );
    } else if (action === 'nudge') {
      if (!canManage(w, me, t) && t.reviewerId !== me.id)
        fail('You cannot send a reminder on this task.');
      ping(
        w,
        t.ownerId,
        t.id,
        `${me.name} requested an update`,
        String(b.message || 'Please update progress, blockers and your next action.'),
        'nudge',
      );
      audit(
        w,
        me.id,
        t.id,
        'reminder_sent',
        'An in-app update request was sent to the task owner.',
      );
    } else fail('This task action is unavailable.');
  } else if (parts[0] === 'departments') {
    assertAdmin(me);
    const name = String(b.name ?? '').trim();
    if (!name) fail('Department name is required.');
    if (b.headId) person(w, b.headId);
    if (parts[1]) {
      const d = w.departments.find((d) => d.id === parts[1]);
      if (!d) fail('Department not found.');
      Object.assign(d!, {
        name,
        headId: b.headId ?? d!.headId,
        color: b.color ?? d!.color,
        description: b.description ?? d!.description,
      });
    } else {
      const d: Department = {
        id: id(),
        companyId: w.company.id,
        name,
        headId: b.headId ?? '',
        color: b.color || '#6366F1',
        description: b.description ?? '',
      };
      w.departments.push(d);
      result.id = d.id;
    }
    audit(w, me.id, '', 'department_updated', name);
  } else if (parts[0] === 'people') {
    assertAdmin(me);
    if (b.departmentId && !w.departments.some((d) => d.id === b.departmentId))
      fail('Choose a department in this company.');
    if (b.managerId) person(w, b.managerId);
    if (
      b.role &&
      !['founder', 'ceo', 'admin', 'finance', 'head', 'manager', 'member', 'viewer'].includes(
        b.role,
      )
    )
      fail('Choose a valid role.');
    if (b.role && ['founder', 'ceo'].includes(b.role) && me.role !== 'founder')
      fail('Only a founder can assign a leadership role.');
    if (
      b.capacityHours !== undefined &&
      (!Number.isFinite(Number(b.capacityHours)) || b.capacityHours < 0 || b.capacityHours > 168)
    )
      fail('Weekly capacity must be between 0 and 168 hours.');
    if (parts[1]) {
      const p = w.people.find((p) => p.id === parts[1]);
      if (!p) fail('Person not found.');
      if (p!.role === 'founder' && me.role !== 'founder')
        fail('Only a founder can edit another founder.');
      if (
        p!.role === 'founder' &&
        ((b.role && b.role !== 'founder') || b.active === false) &&
        w.people.filter((p) => p.role === 'founder' && p.active).length <= 1
      )
        fail('The company must retain at least one active founder.');
      if (b.managerId && (b.managerId === p!.id || reports(w, p!.id).has(b.managerId)))
        fail('That reporting line would create a cycle.');
      for (const k of [
        'role',
        'departmentId',
        'managerId',
        'title',
        'capacityHours',
        'active',
      ] as const)
        if (b[k] !== undefined) (p! as unknown as Record<string, unknown>)[k] = b[k];
    } else {
      const name = String(b.name ?? '').trim();
      const email = String(b.email ?? '')
        .trim()
        .toLowerCase();
      if (!name || !/^\S+@\S+\.\S+$/.test(email)) fail('Enter a name and valid email.');
      let s = db.sessions.find((s) => s.user.email.toLowerCase() === email);
      if (w.people.some((p) => p.email.toLowerCase() === email))
        fail('This person is already in the company.');
      if (!s) {
        if (String(b.password ?? '').length < 12)
          fail('Set an initial password of at least 12 characters.');
        s = { user: { id: id(), name, email, isPlatformAdmin: false }, companies: [] };
        db.sessions.push(s);
        db.passwords[s.user.id] = b.password;
      }
      s.companies.push(clone(w.company));
      const p: Person = {
        id: s.user.id,
        membershipId: id(),
        name: s.user.name,
        email,
        role: b.role || 'member',
        departmentId: b.departmentId ?? '',
        managerId: b.managerId ?? '',
        title: b.title ?? '',
        capacityHours: Number(b.capacityHours ?? 40),
        avatar: name
          .split(' ')
          .map((n) => n[0])
          .join('')
          .slice(0, 2),
        active: true,
      };
      w.people.push(p);
      result.id = p.id;
    }
    audit(
      w,
      me.id,
      '',
      'membership_updated',
      parts[1] ? 'Company membership updated' : 'New person added',
    );
  } else if (parts[0] === 'projects') {
    if (!leadership(me) && !['head', 'manager'].includes(me.role))
      fail('A manager must create or change a project.');
    const previous = parts[1] ? w.projects.find((p) => p.id === parts[1]) : undefined;
    if (parts[1] && !previous) fail('Project not found.');
    if (previous && (!b.version || b.version !== (previous.version ?? 1)))
      fail('Project changed. Refresh and intentionally reconcile your edits.');
    const p = {
      version: 1,
      taskOwnerPolicy: 'actor',
      defaultTaskOwnerId: '',
      defaultReviewerId: '',
      defaultRequiresApproval: false,
      id: id(),
      companyId: w.company.id,
      name: '',
      description: '',
      departmentId: me.departmentId,
      ownerId: me.id,
      dueDate: '',
      color: '#6366F1',
      status: 'active',
      ...previous,
      ...b,
    } as Project;
    p.version = previous ? (previous.version ?? 1) + 1 : 1;
    p.companyId = w.company.id;
    p.id = previous?.id ?? p.id;
    if (!p.name.trim() || !validDate(p.dueDate))
      fail('Project name and valid deadline are required.');
    person(w, p.ownerId);
    if (p.departmentId && !w.departments.some((d) => d.id === p.departmentId))
      fail('Choose a department in this company.');
    if (!leadership(me) && p.departmentId !== me.departmentId) fail('Choose your own department.');
    if (!['active', 'on_hold', 'completed', 'archived'].includes(p.status))
      fail('Choose a valid project status.');
    if (previous) Object.assign(previous, p);
    else w.projects.push(p);
    result.id = p.id;
    audit(w, me.id, '', 'project_updated', p.name);
  } else if (parts[0] === 'goals') {
    if (!leadership(me) && !['head', 'manager'].includes(me.role))
      fail('A manager must create or update a company goal.');
    const previous = parts[1] ? w.goals.find((g) => g.id === parts[1]) : undefined;
    if (parts[1] && !previous) fail('Goal not found.');
    const g = {
      id: id(),
      companyId: w.company.id,
      name: '',
      description: '',
      ownerId: me.id,
      departmentId: me.departmentId,
      unit: '',
      baseline: 0,
      target: 100,
      current: 0,
      dueDate: '',
      taskIds: [],
      ...previous,
      ...b,
    } as Goal;
    g.companyId = w.company.id;
    g.id = previous?.id ?? g.id;
    if (
      !g.name.trim() ||
      !validDate(g.dueDate) ||
      ![g.baseline, g.target, g.current].every(Number.isFinite) ||
      g.baseline === g.target
    )
      fail('Enter a goal name, deadline and distinct numeric baseline/target.');
    person(w, g.ownerId);
    if (g.departmentId && !w.departments.some((d) => d.id === g.departmentId))
      fail('Choose a department in this company.');
    if (!leadership(me) && g.departmentId !== me.departmentId) fail('Choose your own department.');
    for (const taskId of g.taskIds) taskBy(w, me, taskId);
    if (previous) Object.assign(previous, g);
    else w.goals.push(g);
    result.id = g.id;
    audit(w, me.id, '', 'goal_updated', `${g.name}: ${g.current} ${g.unit}`);
  } else if (parts[0] === 'notifications' && parts[1] === 'read') {
    const ids = Array.isArray(b.ids) ? b.ids : [];
    for (const n of w.notifications)
      if (n.userId === me.id && (!ids.length || ids.includes(n.id))) n.read = true;
  } else if (parts[0] === 'automations' && parts[1] === 'run') {
    assertAdmin(me);
    let created = 0;
    let reminders = 0;
    const today = todayInTimezone(w.company.timezone);
    for (const t of [...w.tasks]) {
      if (t.status === 'done' && t.recurrence !== 'none' && !db.generated[t.id]) {
        const reviewer = w.people.find(
          (p) => p.id === t.reviewerId && p.active && p.role !== 'viewer',
        );
        const owner = w.people.find((p) => p.id === t.ownerId && p.active);
        if (!owner || (t.requiresApproval && (!reviewer || reviewer.id === owner.id))) {
          const marker = `skipped-${t.id}-${today}`;
          if (!db.generated[marker]) {
            db.generated[marker] = today;
            audit(
              w,
              me.id,
              t.id,
              'recurrence_skipped',
              'Recurring task needs an active owner and eligible independent reviewer.',
            );
            ping(
              w,
              me.id,
              t.id,
              'Recurring task needs attention',
              `${t.code}: assign an eligible owner and reviewer before creating the next instance.`,
              'recurrence',
            );
          }
          continue;
        }
        let due = addDays(
          t.dueDate,
          t.recurrence === 'daily' ? 1 : t.recurrence === 'weekly' ? 7 : 28,
        );
        if (t.recurrence === 'monthly') {
          const d = new Date(t.dueDate + 'T12:00:00Z');
          const day = d.getUTCDate();
          d.setUTCDate(1);
          d.setUTCMonth(d.getUTCMonth() + 1);
          const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
          d.setUTCDate(Math.min(day, end));
          due = d.toISOString().slice(0, 10);
        }
        const next = createTask(w, me, {
          ...t,
          title: t.title,
          status: 'todo',
          dueDate: due,
          startDate: '',
          checklist: t.checklist.map((c) => ({ ...c, id: id(), done: false })),
          dependencies: [],
          parentId: '',
        });
        db.generated[t.id] = next.id;
        created++;
      }
    }
    // Process reminders after generation, so the first pass also covers new due-today instances.
    for (const t of w.tasks)
      if (
        !['done', 'cancelled'].includes(t.status) &&
        t.dueDate <= today &&
        !w.notifications.some(
          (n) =>
            n.taskId === t.id &&
            n.kind === 'deadline' &&
            n.createdAt.slice(0, 10) === stamp().slice(0, 10),
        )
      ) {
        ping(
          w,
          t.ownerId,
          t.id,
          t.dueDate < today ? 'A task is overdue' : 'A task is due today',
          t.title,
          'deadline',
        );
        reminders++;
      }
    result = { ok: true, created, reminders };
    audit(
      w,
      me.id,
      '',
      'automations_run',
      `${created} recurring tasks and ${reminders} reminders created`,
    );
  } else fail('This action is unavailable.');
  if (keyed) {
    db.businessRetries ??= {};
    db.businessRetries[retryIdentity] = { hash: retryHash, result: clone(result) };
  }
  saveDB(db);
  return result;
}

const filesInMemory = new Map<string, Blob>();
async function fileDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('schach-demo-files', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function saveBlob(key: string, file: Blob) {
  const db = await fileDB();
  if (!db) {
    filesInMemory.set(key, file);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(file, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
async function getBlob(key: string): Promise<Blob | undefined> {
  const db = await fileDB();
  if (!db) return filesInMemory.get(key);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files');
    const r = tx.objectStore('files').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => db.close();
  });
}
export async function demoUpload(companyId: string, userId: string, taskId: string, file: File) {
  const db = readDB();
  const { w, me } = context(db, companyId, userId);
  const t = taskBy(w, me, taskId);
  if (me.role === 'viewer') fail('This company membership is read-only.');
  if (t.status === 'done') fail('Reopen accepted work before adding evidence.');
  if (!file.size || file.size > 10 * 1024 * 1024) fail('Choose a file between 1 byte and 10 MB.');
  if (!/\.(pdf|png|jpg|jpeg|webp|txt|csv)$/i.test(file.name))
    fail('Supported evidence: PDF, PNG/JPG/WebP, TXT and CSV. Export Office documents as PDF.');
  const a: Attachment = {
    id: id(),
    fileName: file.name.replace(/[\x00-\x1f/\\]/g, '_'),
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    uploadedBy: userId,
    createdAt: stamp(),
  };
  await saveBlob(a.id, file);
  t.attachments.push(a);
  t.version++;
  t.updatedAt = stamp();
  audit(w, userId, t.id, 'evidence_added', a.fileName);
  saveDB(db);
}
export async function demoDownload(
  companyId: string,
  userId: string,
  attachment: Attachment,
): Promise<Blob> {
  const { w, me } = context(readDB(), companyId, userId);
  if (
    !w.tasks.some(
      (t) => t.attachments.some((a) => a.id === attachment.id) && canReadDemoTask(w, me, t),
    )
  )
    fail('You cannot access this file.');
  const file = await getBlob(attachment.id);
  if (!file) fail('This demo file is not available in this browser. Upload it again.');
  return file!;
}

export async function demoUploadExpenseReceipt(
  companyId: string,
  userId: string,
  expenseId: string,
  file: File,
) {
  const first = context(readDB(), companyId, userId);
  receiptExpense(first.w, first.me, expenseId);
  if (!file.size || file.size > 10 * 1024 * 1024) fail('Choose a file between 1 byte and 10 MB.');
  if (!/\.(pdf|png|jpg|jpeg|webp|txt|csv)$/i.test(file.name))
    fail('Supported receipts: PDF, PNG/JPG/WebP, TXT and CSV. Export Office documents as PDF.');
  const attachment: Attachment = {
    id: id(),
    fileName: file.name.replace(/[\x00-\x1f/\\]/g, '_'),
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    uploadedBy: userId,
    createdAt: stamp(),
  };
  await saveBlob(attachment.id, file);
  const db = readDB();
  const { w, me } = context(db, companyId, userId);
  appendDemoReceipt(w, me, expenseId, attachment);
  saveDB(db);
}
export async function demoDownloadExpenseReceipt(
  companyId: string,
  userId: string,
  attachment: Attachment,
): Promise<Blob> {
  const { w, me } = context(readDB(), companyId, userId);
  if (
    !w.expenses.some((e) => canReadExpense(me, e) && e.receipts.some((a) => a.id === attachment.id))
  )
    fail('You cannot access this receipt.');
  const stored = await getBlob(attachment.id);
  if (stored) return stored;
  const content = (fixture.receiptContents as Record<string, string>)[attachment.id];
  if (content) return new Blob([content], { type: 'text/plain; charset=utf-8' });
  fail('This demo receipt is not available in this browser. Append it again.');
  throw new Error('Receipt unavailable.');
}

function demoTaskReviewer(p: Person, t: Task, replay = false) {
  return (
    p.active &&
    p.role !== 'viewer' &&
    (replay || t.status === 'in_review') &&
    t.ownerId !== p.id &&
    (t.reviewerId === p.id || leadership(p))
  );
}
function demoExpenseReviewer(p: Person, e: WorkspaceData['expenses'][number], replay = false) {
  return (
    p.active &&
    p.id !== e.createdBy &&
    (replay || e.status === 'submitted') &&
    (managesFinance(p) ||
      (p.role === 'head' && !!p.departmentId && p.departmentId === e.departmentId))
  );
}
function syncDemoAttention(db: DemoDatabase, w: WorkspaceData) {
  db.attention ??= [];
  for (const p of w.people.filter((p) => p.active)) {
    for (const t of w.tasks) {
      const kind = demoTaskReviewer(p, t)
        ? 'task_review'
        : t.ownerId === p.id && !['done', 'cancelled'].includes(t.status)
          ? t.status === 'blocked'
            ? 'blocker'
            : 'update'
          : null;
      if (!kind) continue;
      const key = kind === 'update' ? `owner:${p.id}` : `task:${t.version}`;
      const aid = [w.company.id, 'task', t.id, p.id, key, kind].join(':');
      if (!db.attention.some((a) => a.id === aid))
        db.attention.push({
          id: aid,
          companyId: w.company.id,
          recipientId: p.id,
          sourceKind: 'task',
          sourceId: t.id,
          sourceRevision: t.version,
          occurrenceKey: key,
          kind,
          state: 'open',
          version: 1,
          snoozedUntil: null,
        });
    }
    for (const e of w.expenses) {
      if (!demoExpenseReviewer(p, e)) continue;
      const aid = [w.company.id, 'expense', e.id, p.id, e.version].join(':');
      if (!db.attention.some((a) => a.id === aid))
        db.attention.push({
          id: aid,
          companyId: w.company.id,
          recipientId: p.id,
          sourceKind: 'expense',
          sourceId: e.id,
          sourceRevision: e.version,
          occurrenceKey: `expense:${e.version}`,
          kind: 'expense_review',
          state: 'open',
          version: 1,
          snoozedUntil: null,
        });
    }
  }
}
function demoAttentionView(
  db: DemoDatabase,
  w: WorkspaceData,
  p: Person,
  a: DemoAttentionRow,
  replay = false,
): AttentionView | null {
  if (
    a.companyId !== w.company.id ||
    a.recipientId !== p.id ||
    !p.active ||
    (!replay && a.state === 'superseded')
  )
    return null;
  const view: AttentionView = {
    id: a.id,
    companyId: a.companyId,
    recipientId: a.recipientId,
    sourceKind: a.sourceKind,
    sourceId: a.sourceId,
    kind: a.kind,
    state: a.state,
    version: a.version,
    sourceVersion: 0,
    title: '',
    summary: '',
    link: '',
    ownerName: '',
    canDecide: false,
    canRoute: false,
    actions: [],
    routePeople: [],
    snoozedUntil: a.snoozedUntil,
    dueAt: null,
    reminderState: 'pending',
  };
  if (a.sourceKind === 'task') {
    const t = w.tasks.find((t) => t.id === a.sourceId);
    if (
      !t ||
      !canReadDemoTask(w, p, t) ||
      (a.kind === 'task_review' &&
        (!demoTaskReviewer(p, t, replay) || (!replay && a.sourceRevision !== t.version))) ||
      (!replay && a.kind === 'blocker' && t.status !== 'blocked') ||
      (!replay &&
        a.kind === 'update' &&
        ((t.ownerId !== p.id && !a.occurrenceKey.startsWith('route:')) ||
          ['done', 'cancelled'].includes(t.status)))
    )
      return null;
    Object.assign(view, {
      title: t.title,
      summary: t.description,
      sourceVersion: t.version,
      ownerName: w.people.find((p) => p.id === t.ownerId)?.name ?? '',
      canDecide: demoTaskReviewer(p, t),
      canRoute:
        a.kind === 'task_review'
          ? demoTaskReviewer(p, t, replay)
          : p.id === t.ownerId || p.id === t.createdBy || canStructure(w, p, t),
      link: '/work?task=' + t.id,
    });
    view.routePeople = w.people.filter(
      (target) =>
        target.id !== p.id &&
        target.active &&
        canReadDemoTask(w, target, t) &&
        (a.kind === 'task_review'
          ? demoTaskReviewer(target, t, replay)
          : target.id === t.ownerId ||
            target.id === t.reviewerId ||
            t.collaborators.includes(target.id) ||
            canStructure(w, target, t)),
    );
  } else {
    const e = w.expenses.find((e) => e.id === a.sourceId);
    if (
      !e ||
      !canReadExpense(p, e) ||
      !demoExpenseReviewer(p, e, replay) ||
      (!replay && a.sourceRevision !== e.version)
    )
      return null;
    Object.assign(view, {
      title: e.title,
      summary: e.description,
      sourceVersion: e.version,
      ownerName: w.people.find((p) => p.id === e.createdBy)?.name ?? '',
      canDecide: true,
      canRoute: true,
      link: '/finance?expense=' + e.id,
    });
    view.routePeople = w.people.filter(
      (target) => target.id !== p.id && demoExpenseReviewer(target, e, replay),
    );
  }
  if (a.state === 'open') {
    view.actions = ['resolve', 'snooze', 'unsnooze'];
    if (view.canRoute && view.routePeople.length) view.actions.push('route');
  } else view.canRoute = false;
  return view;
}
export async function demoAttentionRead(
  company: string,
  user: string,
  state = 'open',
  decisionsOnly = false,
) {
  const db = readDB();
  const { w, me } = context(db, company, user);
  syncDemoAttention(db, w);
  saveDB(db);
  return db
    .attention!.map((a) => demoAttentionView(db, w, me, a))
    .filter(
      (v): v is AttentionView =>
        !!v && (decisionsOnly ? v.canDecide : state === 'all' || v.state === state),
    );
}
export async function demoAttentionDetail(company: string, user: string, itemId: string) {
  const db = readDB();
  const { w, me } = context(db, company, user);
  syncDemoAttention(db, w);
  const row = db.attention!.find((a) => a.id === itemId);
  const view = row && demoAttentionView(db, w, me, row);
  if (!view) throw new ApiError('This source is no longer available.', 404, 'not_found');
  saveDB(db);
  return view;
}
export async function demoAttentionPreferences(company: string, user: string) {
  const db = readDB();
  context(db, company, user);
  return db.attentionPreferences?.[company + ':' + user] ?? defaultAttentionPreference();
}
async function demoAttentionMutation(
  company: string,
  user: string,
  path: string,
  body: unknown,
): Promise<MutationResult> {
  const db = readDB();
  const { w, me } = context(db, company, user);
  if (path === '/attention/preferences') {
    const p = body as AttentionPreference;
    const old = db.attentionPreferences?.[company + ':' + user] ?? defaultAttentionPreference();
    if (p.version !== old.version)
      throw new ApiError('Preferences changed. Refresh first.', 409, 'version_conflict');
    if (
      (p.quietStart === p.quietEnd && p.quietStart) ||
      (p.workingHoursEnabled && (!p.workingDays.length || p.workingStart === p.workingEnd))
    )
      throw new ApiError('Choose a nonempty delivery window.', 422, 'validation');
    if (
      p.escalationEnabled &&
      (!w.people.some((v) => v.id === p.escalationUserId && v.active) ||
        p.escalationUserId === user ||
        p.escalationAfterMinutes < 1)
    )
      throw new ApiError('Choose an active independent escalation recipient.', 422, 'validation');
    db.attentionPreferences ??= {};
    db.attentionPreferences[company + ':' + user] = { ...p, version: p.version + 1 };
    saveDB(db);
    return { ok: true };
  }
  const itemId = decodeURIComponent(path.split('/')[2]);
  const input = body as AttentionTransitionInput;
  syncDemoAttention(db, w);
  const row = db.attention!.find((a) => a.id === itemId);
  const view = row && demoAttentionView(db, w, me, row, true);
  if (!row || !view) throw new ApiError('This source is no longer available.', 404, 'not_found');
  const key = [company, user, input.retryKey].join(':');
  const hash = JSON.stringify([
    itemId,
    attentionIntent(
      { version: input.expectedVersion },
      input.action,
      { reason: input.reason, recipientId: input.recipientId, snoozedUntil: input.snoozedUntil },
      input.retryKey,
    ),
  ]);
  const old = db.attentionRetries?.[key];
  if (old) {
    if (old.hash !== hash)
      throw new ApiError('Retry key belongs to another action.', 409, 'version_conflict');
    if (input.action === 'route') {
      const authority = demoAttentionView(db, w, me, { ...row, state: 'open' }, true);
      if (!authority?.canRoute || !authority.routePeople.some((p) => p.id === input.recipientId))
        throw new ApiError('Routing authority changed.', 404, 'not_found');
    }
    return { ok: true, id: old.resultItemId };
  }
  if (row.version !== input.expectedVersion || row.state !== 'open')
    throw new ApiError('This Inbox item changed. Refresh first.', 409, 'version_conflict');
  if (!demoAttentionView(db, w, me, row))
    throw new ApiError('This obligation is no longer current.', 404, 'not_found');
  if (!input.retryKey || !['resolve', 'route', 'snooze', 'unsnooze'].includes(input.action))
    throw new ApiError('Choose an attention action.', 422, 'validation');
  if (
    ['resolve', 'route'].includes(input.action) &&
    (!input.reason?.trim() || input.reason.length > 4000)
  )
    throw new ApiError('A reason is required.', 422, 'validation');
  let resultId = row.id;
  switch (input.action) {
    case 'resolve':
      row.state = 'resolved';
      break;
    case 'snooze': {
      const instant = Date.parse(input.snoozedUntil ?? '');
      if (
        !Number.isFinite(instant) ||
        instant <= Date.now() ||
        instant > Date.now() + 90 * 86400000
      )
        throw new ApiError('Choose a future time within 90 days.', 422, 'validation');
      row.snoozedUntil = input.snoozedUntil!;
      break;
    }
    case 'unsnooze':
      row.snoozedUntil = null;
      break;
    case 'route': {
      if (!view.canRoute || !view.routePeople.some((p) => p.id === input.recipientId))
        throw new ApiError('This recipient is not eligible.', 403, 'forbidden');
      let target = db.attention!.find(
        (a) =>
          a.companyId === company &&
          a.recipientId === input.recipientId &&
          a.sourceKind === row.sourceKind &&
          a.sourceId === row.sourceId &&
          a.kind === row.kind &&
          a.state === 'open' &&
          a.sourceRevision === row.sourceRevision &&
          !!demoAttentionView(
            db,
            w,
            w.people.find((p) => p.id === input.recipientId)!,
            a,
          ),
      );
      if (!target) {
        target = {
          ...row,
          id: id(),
          recipientId: input.recipientId!,
          occurrenceKey: 'route:' + row.id + ':' + input.retryKey,
          state: 'open',
          version: 1,
          snoozedUntil: null,
        };
        db.attention!.push(target);
      }
      row.state = 'routed';
      resultId = target.id;
      break;
    }
  }
  row.version++;
  db.attentionRetries ??= {};
  db.attentionRetries[key] = { hash, itemId, resultItemId: resultId, resultVersion: row.version };
  saveDB(db);
  return { ok: true, id: resultId };
}
