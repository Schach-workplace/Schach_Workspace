import { ApiError } from './api';
import type { Person, WorkspaceData } from '../types';
import type {
  PeoplePreset,
  OnboardingIntent,
  OnboardingPreview,
  AccessReviewView,
  ReviewDecision,
  DeparturePreview,
  DepartureReplacement,
  SessionEffect,
  MembershipDefaults,
} from '../../../shared/people/types';
// Finite fictional workflow state. This adapter never calls the company API and
// never persists or validates a real credential. Passwords are discarded.
type Row = {
  actor: string;
  company: string;
  basis: string;
  expires: number;
  kind: string;
  intent: unknown;
  view: unknown;
  used?: boolean;
};
export interface DemoPeopleState {
  presets: Record<string, PeoplePreset & { company: string }>;
  previews: Record<string, Row>;
  reviews: Record<string, AccessReviewView & { company: string }>;
  retries: Record<string, { body: string; result: unknown }>;
}
export const newDemoPeopleState = (): DemoPeopleState => ({
  presets: {},
  previews: {},
  reviews: {},
  retries: {},
});
const id = () => crypto.randomUUID();
const roles = ['founder', 'ceo', 'admin', 'finance', 'head', 'manager', 'member', 'viewer'];
const ranks: Record<string, number> = {
  founder: 100,
  ceo: 90,
  admin: 80,
  finance: 60,
  head: 50,
  manager: 40,
  member: 20,
  viewer: 10,
};
const denied = () => {
  throw new ApiError('Current company administration is required.', 403, 'forbidden');
};
const conflict = () => {
  throw new ApiError(
    'The reviewed company or source changed. Inspect current records.',
    409,
    'conflict',
  );
};
function invalid(text: string): never {
  throw new ApiError(text, 422, 'validation');
}
const typedMembership = (m: MembershipDefaults) => ({ ...m, role: m.role as Person['role'] });
const effect = (changed = false): SessionEffect => ({
  reauthenticate: changed,
  scope: 'account_sessions',
  devicesMustReregister: changed,
  callsMustRejoin: changed,
  otherCompanyMembershipsPreserved: true,
});
const basis = (w: WorkspaceData) =>
  JSON.stringify([
    w.company.companyPermissionEpoch,
    w.people.map((p) => [
      p.id,
      p.membershipVersion,
      p.active,
      p.role,
      p.departmentId,
      p.managerId,
      p.title,
      p.capacityHours,
    ]),
    w.departments.map((d) => [d.id, d.version]),
  ]);
function authorize(me: Person) {
  if (!me.active || !['founder', 'ceo', 'admin'].includes(me.role)) denied();
}
function validate(w: WorkspaceData, me: Person, p: Person, all: Person[]) {
  if (!roles.includes(p.role) || ranks[p.role] > ranks[me.role]) denied();
  if (p.id === me.id && !p.active)
    invalid('Ask another administrator to revoke your company access.');
  if (!Number.isFinite(p.capacityHours) || p.capacityHours < 0 || p.capacityHours > 168)
    invalid('Choose weekly capacity between 0 and 168.');
  if (p.departmentId && !w.departments.some((d) => d.id === p.departmentId))
    invalid('Choose a current department.');
  const seen = new Set([p.id]);
  let manager = p.managerId;
  while (manager) {
    if (seen.has(manager)) invalid('Reporting relationships cannot form a cycle.');
    seen.add(manager);
    const next = all.find((x) => x.id === manager && x.active);
    if (!next) invalid('Choose an active reporting manager.');
    manager = next.managerId;
  }
  if (!all.some((x) => x.role === 'founder' && x.active))
    invalid('Retain an active company founder.');
}
function applyMembers(w: WorkspaceData, me: Person, after: Person[]): SessionEffect {
  for (const p of after) {
    const old = w.people.find((x) => x.id === p.id);
    if (old && ranks[old.role] > ranks[me.role]) {
      if (JSON.stringify(old) !== JSON.stringify(p)) denied();
    }
    validate(w, me, p, after);
  }
  let scope = false;
  for (const p of after) {
    const old = w.people.find((x) => x.id === p.id);
    if (!old) continue;
    const changed = ['role', 'departmentId', 'managerId', 'active'].some(
      (k) => old[k as keyof Person] !== p[k as keyof Person],
    );
    const metadata = changed || old.title !== p.title || old.capacityHours !== p.capacityHours;
    p.membershipVersion = old.membershipVersion + (metadata ? 1 : 0);
    p.memberAccessEpoch = old.memberAccessEpoch + (changed ? 1 : 0);
    scope ||= changed;
  }
  w.people = after;
  if (scope) w.company.companyPermissionEpoch++;
  return effect(scope);
}
export function readDemoPeople(
  state: DemoPeopleState,
  w: WorkspaceData,
  me: Person,
  path: string,
): unknown {
  authorize(me);
  if (path === '/people/context')
    return {
      people: w.people,
      departments: w.departments,
      roles: roles.filter((r) => ranks[r] <= ranks[me.role]),
      readBasis: basis(w),
      companyPermissionEpoch: w.company.companyPermissionEpoch,
    };
  if (path === '/people/presets')
    return {
      items: Object.values(state.presets).filter((p) => p.company === w.company.id),
      cursor: '',
    };
  if (path === '/people/access-reviews')
    return {
      items: Object.values(state.reviews).filter((p) => p.company === w.company.id),
      cursor: '',
    };
  const review = state.reviews[path.split('/')[3]];
  if (review?.company === w.company.id) return review;
  throw new ApiError('Current fictional People record unavailable.', 404, 'not_found');
}
function inventory(
  w: WorkspaceData,
  me: Person,
  target: string,
  replacements: DepartureReplacement[],
): DeparturePreview {
  const person = w.people.find((p) => p.id === target);
  if (!person || !person.active || target === me.id)
    invalid('Choose another active company member.');
  if (ranks[person.role] > ranks[me.role]) denied();
  const v: DeparturePreview = {
    id: id(),
    version: 1,
    expiresAt: new Date(Date.now() + 1800000).toISOString(),
    graphFingerprint: basis(w),
    target: {
      id: person.id,
      name: person.name,
      role: person.role,
      membershipVersion: person.membershipVersion,
    },
    liveItems: [],
    retainedHistory: { tasks: 0 },
    unresolved: [],
    sessionEffect: effect(true),
    readyToApply: false,
  };
  const add = (
    kind: string,
    sourceId: string,
    version: number,
    title: string,
    state: string,
    other = '',
  ) => {
    v.liveItems.push({
      kind,
      sourceId,
      version,
      title,
      state,
      allowsNoManager: kind === 'reporting_manager',
      candidates: w.people
        .filter(
          (p) =>
            p.active &&
            p.id !== target &&
            p.id !== other &&
            (kind !== 'task_reviewer' || p.role !== 'viewer'),
        )
        .map((p) => ({
          id: p.id,
          name: p.name,
          role: p.role,
          departmentId: p.departmentId,
          eligibility: 'Eligible in this fictional local sample',
        })),
    });
  };
  for (const t of w.tasks) {
    if (['done', 'cancelled'].includes(t.status)) {
      if (t.ownerId === target || t.reviewerId === target) v.retainedHistory.tasks++;
      continue;
    }
    if (t.ownerId === target) add('task_owner', t.id, t.version, t.title, t.status, t.reviewerId);
    if (t.reviewerId === target)
      add('task_reviewer', t.id, t.version, t.title, t.status, t.ownerId);
  }
  for (const p of w.projects)
    if (p.ownerId === target && ['active', 'on_hold'].includes(p.status))
      add('project_owner', p.id, p.version ?? 1, p.name, p.status);
  for (const g of w.goals)
    if (g.ownerId === target)
      add('goal_owner', g.id, (g as typeof g & { version?: number }).version ?? 1, g.name, 'live');
  for (const d of w.departments)
    if (d.headId === target) add('department_head', d.id, d.version, d.name, 'live');
  for (const p of w.people)
    if (p.active && p.managerId === target)
      add('reporting_manager', p.id, p.membershipVersion, p.name, 'active');
  if (replacements.length > v.liveItems.length)
    invalid('A replacement is outside the complete current inventory.');
  const seen = new Set<string>();
  for (const r of replacements) {
    const key = r.kind + ':' + r.sourceId;
    if (seen.has(key)) invalid('Choose each responsibility once.');
    seen.add(key);
    const item = v.liveItems.find((x) => x.kind === r.kind && x.sourceId === r.sourceId);
    if (!item) conflict();
    if (item!.version !== r.expectedVersion) conflict();
    if (
      !(r.action === 'clear_reporting_manager' && item!.allowsNoManager && !r.newUserId) &&
      !(r.action === 'transfer' && item!.candidates.some((p) => p.id === r.newUserId))
    )
      invalid('Choose an eligible replacement.');
    item!.replacement = r;
  }
  if (v.liveItems.some((x) => !x.replacement))
    v.unresolved.push({
      code: 'replacement_required',
      message: 'Choose an explicit eligible replacement for every live responsibility.',
    });
  v.readyToApply = v.unresolved.length === 0;
  return v;
}
export function mutateDemoPeople(
  state: DemoPeopleState,
  w: WorkspaceData,
  me: Person,
  path: string,
  b: Record<string, any>,
  method: string,
  existingAccount: (email: string) => { id: string; name: string } | undefined,
): any {
  authorize(me);
  if (typeof b.retryKey !== 'string' || !b.retryKey) invalid('Use a submitted action key.');
  const key = JSON.stringify([w.company.id, me.id, path, b.retryKey]);
  const body = JSON.stringify(
    Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'password' && k !== 'retryKey')),
  );
  const previous = state.retries[key];
  if (previous) {
    if (previous.body !== body) conflict();
    return structuredClone(previous.result);
  }
  let result: any;
  const capture = (kind: string, intent: unknown, view: any) => {
    state.previews[view.id] = {
      actor: me.id,
      company: w.company.id,
      basis: basis(w),
      expires: Date.now() + 1800000,
      kind,
      intent: structuredClone(intent),
      view: structuredClone(view),
    };
    return view;
  };
  const preview = (kind: string) => {
    const p = state.previews[b.previewId];
    if (!p || p.company !== w.company.id || p.actor !== me.id || p.kind !== kind)
      throw new ApiError('Preview unavailable.', 404, 'not_found');
    if (p.used || p.expires < Date.now() || p.basis !== basis(w)) conflict();
    return p;
  };
  if (path === '/people/presets' || path.startsWith('/people/presets/')) {
    const old = state.presets[path.split('/')[3]];
    if (
      method === 'PATCH' &&
      (!old || old.company !== w.company.id || old.version !== b.expectedVersion)
    )
      conflict();
    if (!String(b.name ?? '').trim()) invalid('Name this preset.');
    if ((b.templateIds ?? []).length)
      invalid('This finite local sample has no starting task templates.');
    const membership = typedMembership(b.membership as MembershipDefaults);
    validate(w, me, { ...me, id: 'fictional-preset', ...membership }, [
      ...w.people,
      { ...me, id: 'fictional-preset', ...membership },
    ]);
    result = {
      id: old?.id ?? id(),
      version: (old?.version ?? 0) + 1,
      name: b.name,
      description: b.description ?? '',
      archived: !!b.archived,
      membership,
      templateIds: [],
      company: w.company.id,
    };
    state.presets[result.id] = result;
  } else if (path === '/people/onboarding/preview') {
    const intent = b as OnboardingIntent;
    const email = String(intent.email ?? '')
      .trim()
      .toLowerCase();
    if (!intent.name.trim() || !/^\S+@\S+\.\S+$/.test(email))
      invalid('Enter a name and valid email.');
    if (w.people.some((p) => p.email.toLowerCase() === email && p.active))
      invalid('This person already has active company access.');
    if (intent.tasks.length) invalid('This finite local sample has no starting task templates.');
    if (intent.presetId) {
      const p = state.presets[intent.presetId];
      if (
        !p ||
        p.archived ||
        p.company !== w.company.id ||
        p.version !== intent.expectedPresetVersion
      )
        conflict();
    }
    const account = existingAccount(email);
    const candidate = {
      ...me,
      id: account?.id ?? 'fictional-new',
      ...typedMembership(intent.membership),
      active: true,
    };
    validate(w, me, candidate, [...w.people.filter((p) => p.id !== candidate.id), candidate]);
    const v: OnboardingPreview = {
      id: id(),
      version: 1,
      expiresAt: new Date(Date.now() + 1800000).toISOString(),
      graphFingerprint: basis(w),
      accountMode: account ? 'existing_account' : 'new_account',
      person: { name: account?.name ?? intent.name, email },
      membershipAfter: intent.membership,
      grants: [
        {
          area: 'company',
          summary:
            'Fictional local company access; no private invitations or real account credential changes.',
        },
      ],
      taskPreviews: [],
      unresolved: [],
      sessionEffect: effect(true),
    };
    result = capture('onboarding', { ...intent, email }, v);
  } else if (path === '/people/onboarding/apply') {
    const p = preview('onboarding');
    if (b.expectedPreviewVersion !== 1) conflict();
    const v = p.view as OnboardingPreview,
      intent = p.intent as OnboardingIntent;
    const account = existingAccount(intent.email);
    if (v.accountMode === 'new_account' && Array.from(String(b.password ?? '')).length < 12)
      invalid('Use at least 12 characters for the fictional form.');
    let person = w.people.find((x) => x.id === account?.id);
    if (person) {
      if (person.active) conflict();
      const after = w.people.map((x) =>
        x.id === person!.id ? { ...x, ...typedMembership(intent.membership), active: true } : x,
      );
      applyMembers(w, me, after);
      person = after.find((x) => x.id === person!.id)!;
    } else {
      person = {
        ...typedMembership(intent.membership),
        id: account?.id ?? id(),
        membershipId: id(),
        name: v.person.name,
        email: v.person.email,
        active: true,
        avatar: v.person.name.slice(0, 2),
        membershipVersion: 1,
        memberAccessEpoch: 1,
        companyPermissionEpoch: w.company.companyPermissionEpoch + 1,
      };
      w.people.push(person);
      w.company.companyPermissionEpoch++;
    }
    p.used = true;
    result = {
      ok: true,
      id: person.id,
      userId: person.id,
      membershipId: person.membershipId,
      taskIds: [],
      sessionEffect: effect(true),
      companyPermissionEpoch: w.company.companyPermissionEpoch,
    };
  } else if (path === '/people/access-reviews/preview') {
    if (!String(b.reason ?? '').trim()) invalid('Explain the review.');
    const ds = b.decisions as ReviewDecision[];
    if (ds.length !== w.people.length || new Set(ds.map((d) => d.userId)).size !== w.people.length)
      invalid('Capture every membership exactly once.');
    const after = w.people.map((p) => {
      const d = ds.find((d) => d.userId === p.id);
      if (!d || d.expectedMembershipVersion !== p.membershipVersion) conflict();
      return {
        ...p,
        ...(d!.action === 'change' ? (d!.fields as Partial<Person>) : {}),
        ...(d!.action === 'revoke_access' ? { active: false } : {}),
      };
    });
    const copy = structuredClone(w);
    const se = applyMembers(copy, me, after);
    const reviewId = id();
    const view: AccessReviewView & { company: string } = {
      id: reviewId,
      company: w.company.id,
      previewId: id(),
      version: 1,
      state: 'draft',
      reason: b.reason,
      decisions: ds.map((d) => ({
        ...d,
        accessOutcome:
          d.action === 'change'
            ? 'changed'
            : d.action === 'revoke_access'
              ? 'revoked'
              : 'unchanged',
        handoverStatus:
          d.action === 'departure_required'
            ? 'pending'
            : d.action === 'revoke_access'
              ? 'not_performed'
              : 'not_requested',
      })),
      graphFingerprint: basis(w),
      reviewerId: me.id,
      createdAt: new Date().toISOString(),
      completedAt: '',
      sessionEffect: se,
      companyPermissionEpoch: w.company.companyPermissionEpoch,
    };
    capture('review', { after, reviewId }, { ...view, id: view.previewId });
    state.reviews[reviewId] = view;
    result = view;
  } else if (/^\/people\/access-reviews\/[^/]+\/complete$/.test(path)) {
    const p = preview('review');
    const intent = p.intent as { after: Person[]; reviewId: string };
    if (path.split('/')[3] !== intent.reviewId || b.expectedReviewVersion !== 1) conflict();
    const view = state.reviews[intent.reviewId];
    view.sessionEffect = applyMembers(w, me, intent.after);
    view.state = 'completed';
    view.version++;
    view.completedAt = new Date().toISOString();
    view.companyPermissionEpoch = w.company.companyPermissionEpoch;
    p.used = true;
    result = view;
  } else if (/^\/people\/[^/]+\/departure\/preview$/.test(path)) {
    if (!String(b.reason ?? '').trim()) invalid('Explain the departure.');
    const target = path.split('/')[2],
      v = inventory(w, me, target, b.replacements ?? []);
    result = capture(
      'departure',
      {
        target,
        replacements: b.replacements ?? [],
        sources: JSON.stringify(v.liveItems),
        reason: b.reason,
      },
      v,
    );
  } else if (/^\/people\/[^/]+\/departure\/apply$/.test(path)) {
    const p = preview('departure');
    const intent = p.intent as {
      target: string;
      replacements: DepartureReplacement[];
      sources: string;
    };
    if (
      intent.target !== path.split('/')[2] ||
      b.expectedPreviewVersion !== 1 ||
      !b.confirmCompanyDeparture
    )
      conflict();
    const current = inventory(w, me, intent.target, intent.replacements);
    if (!current.readyToApply || JSON.stringify(current.liveItems) !== intent.sources) conflict();
    const after = structuredClone(w.people);
    for (const r of intent.replacements) {
      if (r.kind === 'reporting_manager') {
        after.find((p) => p.id === r.sourceId)!.managerId = r.newUserId;
        continue;
      }
      const list = r.kind.startsWith('task_')
        ? w.tasks
        : r.kind === 'project_owner'
          ? w.projects
          : r.kind === 'goal_owner'
            ? w.goals
            : w.departments;
      const row = list.find((x) => x.id === r.sourceId)! as unknown as Record<string, unknown>;
      row[
        r.kind === 'task_reviewer'
          ? 'reviewerId'
          : r.kind === 'department_head'
            ? 'headId'
            : 'ownerId'
      ] = r.newUserId;
      row.version = Number(row.version ?? 1) + 1;
    }
    after.find((x) => x.id === intent.target)!.active = false;
    const se = applyMembers(w, me, after);
    p.used = true;
    result = {
      ok: true,
      id: id(),
      userId: intent.target,
      sessionEffect: se,
      companyPermissionEpoch: w.company.companyPermissionEpoch,
    };
  } else invalid('This fictional People action is unavailable.');
  state.retries[key] = { body, result: structuredClone(result) };
  return result;
}
