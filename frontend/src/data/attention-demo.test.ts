import { beforeEach, expect, it } from 'vitest';
import {
  resetDemo,
  demoAttentionRead,
  demoAttentionDetail,
  demoMutate,
  readDemoWorkspace,
} from './demo';
import sample from './sample.json';
beforeEach(() => resetDemo());
it('persists separate local resolution and canonical retries while the business decision stays pending', async () => {
  const company = sample.workspaces[0].company.id;
  const user = sample.sessions[0].user.id;
  const items = await demoAttentionRead(company, user);
  const item = items.find((i) => i.canDecide)!;
  expect(item).toBeTruthy();
  const source = (await readDemoWorkspace(company, user)).tasks.find((t) => t.id === item.sourceId);
  const body = {
    expectedVersion: item.version,
    retryKey: 'demo-resolve',
    action: 'resolve',
    reason: 'Handled separately',
  };
  await demoMutate(company, user, `/attention/${encodeURIComponent(item.id)}/transition`, body);
  await demoMutate(company, user, `/attention/${encodeURIComponent(item.id)}/transition`, body);
  expect((await demoAttentionDetail(company, user, item.id)).state).toBe('resolved');
  expect((await demoAttentionRead(company, user, 'open', true)).some((i) => i.id === item.id)).toBe(
    true,
  );
  if (source)
    expect(
      (await readDemoWorkspace(company, user)).tasks.find((t) => t.id === item.sourceId)?.status,
    ).toBe(source.status);
  await expect(
    demoMutate(company, user, `/attention/${encodeURIComponent(item.id)}/transition`, {
      ...body,
      reason: 'Different',
    }),
  ).rejects.toMatchObject({ status: 409 });
});
it('replays an authorized resolved task action after the business decision completes', async () => {
  const company = sample.workspaces[0].company.id;
  const user = sample.sessions[0].user.id;
  const item = (await demoAttentionRead(company, user)).find(
    (i) => i.sourceKind === 'task' && i.canDecide,
  )!;
  const input = {
    expectedVersion: item.version,
    retryKey: 'after-approval',
    action: 'resolve',
    reason: 'Handled independently',
  };
  await demoMutate(company, user, `/attention/${encodeURIComponent(item.id)}/transition`, input);
  await demoMutate(company, user, `/tasks/${item.sourceId}/review`, {
    version: item.sourceVersion,
    decision: 'approve',
    comment: 'Accepted current work',
  });
  await expect(
    demoMutate(company, user, `/attention/${encodeURIComponent(item.id)}/transition`, input),
  ).resolves.toMatchObject({ ok: true });
  expect((await demoAttentionRead(company, user, 'all', true)).some((i) => i.id === item.id)).toBe(
    false,
  );
});

it('routes an owner update to an eligible independent recipient without changing task ownership', async () => {
  const company = sample.workspaces[0].company.id,
    leader = sample.sessions[0].user.id;
  const workspace = await readDemoWorkspace(company, leader);
  const owner = workspace.people.find(
    (p) =>
      p.id !== leader &&
      p.active &&
      workspace.tasks.some(
        (t) =>
          t.ownerId === p.id && !['done', 'cancelled', 'blocked', 'in_review'].includes(t.status),
      ),
  )!;
  expect(owner).toBeTruthy();
  const item = (await demoAttentionRead(company, owner.id)).find(
    (i) => i.kind === 'update' && i.routePeople.some((p) => p.id === leader),
  )!;
  expect(item).toBeTruthy();
  const result = await demoMutate(company, owner.id, `/attention/${item.id}/transition`, {
    expectedVersion: item.version,
    retryKey: 'owner-route',
    action: 'route',
    reason: 'Independent attention handoff',
    recipientId: leader,
  });
  expect((await demoAttentionRead(company, leader)).some((i) => i.id === result.id)).toBe(true);
  expect(
    (await readDemoWorkspace(company, leader)).tasks.find((t) => t.id === item.sourceId)?.ownerId,
  ).toBe(owner.id);
});
it('reuses only a currently projected target and denies replay after recipient revocation', async () => {
  const company = sample.workspaces[0].company.id,
    user = sample.sessions[0].user.id;
  const item = (await demoAttentionRead(company, user)).find(
    (i) => i.kind === 'task_review' && i.routePeople.length,
  )!;
  expect(item).toBeTruthy();
  const target = item.routePeople[0].id;
  await demoMutate(company, user, `/attention/${item.id}/transition`, {
    expectedVersion: item.version,
    retryKey: 'old-target',
    action: 'route',
    reason: 'First reviewed handoff',
    recipientId: target,
  });
  await demoMutate(
    company,
    user,
    `/tasks/${item.sourceId}`,
    { version: item.sourceVersion, title: 'Changed current review source' },
    'PATCH',
  );
  const next = (await demoAttentionRead(company, user)).find(
    (i) => i.sourceId === item.sourceId && i.sourceVersion > item.sourceVersion,
  )!;
  expect(next).toBeTruthy();
  const input = {
    expectedVersion: next.version,
    retryKey: 'fresh-target',
    action: 'route',
    reason: 'Current reviewed handoff',
    recipientId: target,
  };
  const result = await demoMutate(company, user, `/attention/${next.id}/transition`, input);
  expect((await demoAttentionDetail(company, target, result.id!)).sourceVersion).toBe(
    next.sourceVersion,
  );
  await demoMutate(company, user, `/people/${target}`, { active: false }, 'PATCH');
  await expect(
    demoMutate(company, user, `/attention/${next.id}/transition`, input),
  ).rejects.toMatchObject({ status: 404 });
  await expect(demoAttentionDetail(company, target, result.id!)).rejects.toBeTruthy();
});

it('hides a routed collaborator update and denies canonical route replay after task source access changes', async () => {
  const company = sample.workspaces[0].company.id,
    user = sample.sessions[0].user.id;
  const workspace = await readDemoWorkspace(company, user);
  const target = workspace.people.find((p) => p.active && p.role === 'member' && p.id !== user)!;
  expect(target).toBeTruthy();
  const base = workspace.tasks[0];
  const created = await demoMutate(company, user, '/tasks', {
    ...base,
    title: 'Owned fictional source revocation',
    dueDate: '2026-10-20',
    startDate: '',
    deadlineMode: 'all_day',
    dueAt: '',
    dueTimezone: '',
    estimatedHours: 1,
    ownerId: user,
    reviewerId: '',
    requiresApproval: false,
    status: 'todo',
    collaborators: [target.id],
    parentId: '',
    dependencies: [],
    checklist: [],
  });
  const item = (await demoAttentionRead(company, user)).find(
    (i) => i.sourceId === created.id && i.kind === 'update',
  )!;
  const input = {
    expectedVersion: item.version,
    retryKey: 'source-revoke-route',
    action: 'route',
    reason: 'Current collaborator handoff',
    recipientId: target.id,
  };
  const routed = await demoMutate(company, user, `/attention/${item.id}/transition`, input);
  expect((await demoAttentionRead(company, target.id)).some((i) => i.id === routed.id)).toBe(true);
  await demoMutate(
    company,
    user,
    `/tasks/${created.id}`,
    { version: item.sourceVersion, collaborators: [] },
    'PATCH',
  );
  expect((await demoAttentionRead(company, target.id)).some((i) => i.id === routed.id)).toBe(false);
  await expect(demoAttentionDetail(company, target.id, routed.id!)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    demoMutate(company, user, `/attention/${item.id}/transition`, input),
  ).rejects.toMatchObject({ status: 404 });
});
