import { beforeEach, it, expect } from 'vitest';
import { resetDemo, readDemoWorkspace, demoMutate } from './demo';
import { executionRead } from './execution';
let company: string, user: string;
beforeEach(async () => {
  const s = await resetDemo();
  company = s.companies[0].id;
  user = s.user.id;
});
it('runs fictional onboarding and exact canonical replay without persisting the submitted password', async () => {
  const context = await executionRead<any>('demo', company, user, '/people/context');
  expect(context.people.length).toBeGreaterThan(0);
  const p = (await demoMutate(company, user, '/people/onboarding/preview', {
    retryKey: 'demo-inspect',
    name: 'Fictional Local Person',
    email: 'local-person@example.invalid',
    membership: { role: 'member', departmentId: '', managerId: '', title: '', capacityHours: 32 },
    tasks: [],
  })) as any;
  const body = {
    retryKey: 'demo-apply',
    previewId: p.id,
    expectedPreviewVersion: 1,
    password: 'never-persist-this-fictional-value',
  };
  const r = (await demoMutate(company, user, '/people/onboarding/apply', body)) as any;
  const again = await demoMutate(company, user, '/people/onboarding/apply', body);
  expect(again).toEqual(r);
  const w = await readDemoWorkspace(company, user);
  expect(w.people.filter((p) => p.id === r.userId)).toHaveLength(1);
  expect(JSON.stringify(w)).not.toContain(body.password);
});
it('attests pending handover separately and completes explicit ordinary departure', async () => {
  const w = await readDemoWorkspace(company, user);
  const target = w.people.find((p) => p.active && p.role === 'member')!;
  const p = (await demoMutate(company, user, '/people/access-reviews/preview', {
    retryKey: 'review-preview',
    reason: 'Fictional audit',
    decisions: w.people.map((p) => ({
      userId: p.id,
      expectedMembershipVersion: p.membershipVersion,
      action: p.id === target.id ? 'departure_required' : 'keep',
    })),
  })) as any;
  const done = (await demoMutate(company, user, '/people/access-reviews/' + p.id + '/complete', {
    retryKey: 'review-complete',
    previewId: p.previewId,
    expectedReviewVersion: 1,
  })) as any;
  expect(done.decisions.find((d: any) => d.userId === target.id).handoverStatus).toBe('pending');
  expect(
    (await readDemoWorkspace(company, user)).people.find((p) => p.id === target.id)?.active,
  ).toBe(true);
  const inspect = (await demoMutate(company, user, '/people/' + target.id + '/departure/preview', {
    retryKey: 'inspect',
    reason: 'Fictional planned departure',
    replacements: [],
  })) as any;
  const replacements = inspect.liveItems.map((i: any) => ({
    kind: i.kind,
    sourceId: i.sourceId,
    expectedVersion: i.version,
    action: i.allowsNoManager ? 'clear_reporting_manager' : 'transfer',
    newUserId: i.allowsNoManager ? '' : i.candidates[0].id,
  }));
  const review = (await demoMutate(company, user, '/people/' + target.id + '/departure/preview', {
    retryKey: 'review',
    reason: 'Fictional planned departure',
    replacements,
  })) as any;
  await demoMutate(company, user, '/people/' + target.id + '/departure/apply', {
    retryKey: 'depart',
    previewId: review.id,
    expectedPreviewVersion: 1,
    confirmCompanyDeparture: true,
  });
  expect(
    (await readDemoWorkspace(company, user)).people.find((p) => p.id === target.id)?.active,
  ).toBe(false);
});

it.each(['ceo', 'admin'])(
  'lets a %s attest an unchanged founder and change an eligible member',
  async (role) => {
    const w = await readDemoWorkspace(company, user);
    const admin = w.people.find((p) => p.role === 'admin' || p.role === 'ceo')!;
    expect(admin).toBeTruthy();
    if (role === 'admin') {
      await demoMutate(company, user, '/people/' + admin.id, { role: 'admin' }, 'PATCH');
      Object.assign(w, await readDemoWorkspace(company, user));
    }
    const target = w.people.find((p) => p.role === 'member')!;
    const p: any = await demoMutate(company, admin.id, '/people/access-reviews/preview', {
      retryKey: 'lower-review',
      reason: 'Reviewed complete graph',
      decisions: w.people.map((p) => ({
        userId: p.id,
        expectedMembershipVersion: p.membershipVersion,
        action: p.id === target.id ? 'change' : 'keep',
        ...(p.id === target.id ? { fields: { title: 'Reviewed title' } } : {}),
      })),
    });
    expect(p.id).toBeTruthy();
  },
);
it('hides and denies original higher-rank presets for lower administrators', async () => {
  const w = await readDemoWorkspace(company, user);
  const admin = w.people.find((p) => p.role === 'admin' || p.role === 'ceo')!;
  const preset: any = await demoMutate(company, user, '/people/presets', {
    retryKey: 'founder-preset',
    name: 'Founder-only preset',
    membership: { role: 'founder', departmentId: '', managerId: '', title: '', capacityHours: 40 },
    templateIds: [],
  });
  const list: any = await executionRead('demo', company, admin.id, '/people/presets');
  expect(list.items.some((p: any) => p.id === preset.id)).toBe(false);
  await expect(
    executionRead('demo', company, admin.id, '/people/presets/' + preset.id),
  ).rejects.toThrow();
  await expect(
    demoMutate(
      company,
      admin.id,
      '/people/presets/' + preset.id,
      {
        retryKey: 'lower-edit',
        expectedVersion: 1,
        name: 'Lower defaults',
        membership: { ...preset.membership, role: 'member' },
        templateIds: [],
      },
      'PATCH',
    ),
  ).rejects.toThrow();
  await expect(
    demoMutate(company, admin.id, '/people/onboarding/preview', {
      retryKey: 'lower-use',
      name: 'Fictional',
      email: 'rank@example.invalid',
      presetId: preset.id,
      expectedPresetVersion: 1,
      membership: { ...preset.membership, role: 'member' },
      tasks: [],
    }),
  ).rejects.toThrow();
});
it('requires explicit rejoin for an inactive company membership', async () => {
  const w = await readDemoWorkspace(company, user);
  const person = w.people.find((p) => p.role === 'member')!;
  await demoMutate(company, user, '/people/' + person.id, { active: false }, 'PATCH');
  await expect(
    demoMutate(company, user, '/people/onboarding/preview', {
      retryKey: 'inactive-onboard',
      name: person.name,
      email: person.email,
      membership: { role: 'member', departmentId: '', managerId: '', title: '', capacityHours: 40 },
      tasks: [],
    }),
  ).rejects.toThrow(/reactivat|rejoin/i);
  expect(
    (await readDemoWorkspace(company, user)).people.find((p) => p.id === person.id)?.active,
  ).toBe(false);
});

it('rechecks current original preset grants before canonical demo replay', async () => {
  const w = await readDemoWorkspace(company, user);
  const admin = w.people.find((p) => p.role === 'ceo')!;
  const body = {
    retryKey: 'original-lower-preset',
    name: 'Current preset',
    membership: { role: 'member', departmentId: '', managerId: '', title: '', capacityHours: 40 },
    templateIds: [],
  };
  const preset: any = await demoMutate(company, admin.id, '/people/presets', body);
  await demoMutate(
    company,
    user,
    '/people/presets/' + preset.id,
    {
      ...body,
      retryKey: 'higher-preset',
      expectedVersion: 1,
      membership: { ...body.membership, role: 'founder' },
    },
    'PATCH',
  );
  await expect(demoMutate(company, admin.id, '/people/presets', body)).rejects.toThrow();
});
