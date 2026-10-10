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
