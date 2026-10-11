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
