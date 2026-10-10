import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoLogin, demoMutate, readDemoWorkspace, resetDemo } from './demo';
import { addDays, todayInTimezone } from './metrics';
import fixture from './sample.json';
describe('working local demo adapter', () => {
  beforeEach(async () => {
    await resetDemo();
  });
  it('upgrades stored v1 demo work without replacing tasks or inventing financial records', async () => {
    const legacy = JSON.parse(
      JSON.stringify({
        schema: 1,
        sessions: fixture.sessions,
        workspaces: fixture.workspaces,
        passwords: {},
        generated: {},
      }),
    );
    for (const workspace of legacy.workspaces) {
      for (const field of [
        'financeScope',
        'expenseCategories',
        'budgets',
        'expenses',
        'financeEvents',
      ])
        delete workspace[field];
      delete workspace.company.currency;
      delete workspace.company.fiscalYearStartMonth;
      workspace.notifications = workspace.notifications.filter(
        (notice: { expenseId?: string }) => !notice.expenseId,
      );
    }
    for (const session of legacy.sessions)
      for (const company of session.companies) {
        delete company.currency;
        delete company.fiscalYearStartMonth;
      }
    legacy.workspaces[0].tasks[0].title = 'User-entered work retained across the finance upgrade';
    const originalTask = structuredClone(legacy.workspaces[0].tasks[0]);
    const records = new Map<string, string>([['schach.workspace.demo.v1', JSON.stringify(legacy)]]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => records.get(key) ?? null,
      setItem: (key: string, value: string) => records.set(key, value),
    });
    try {
      const workspace = await readDemoWorkspace('c-schach', 'u-founder');
      expect(workspace.tasks[0]).toEqual(originalTask);
      expect(workspace.company).toMatchObject({ currency: 'INR', fiscalYearStartMonth: 4 });
      expect(workspace.expenseCategories).toHaveLength(7);
      expect(workspace.budgets).toEqual([]);
      expect(workspace.expenses).toEqual([]);
      await demoMutate('c-schach', 'u-founder', `/tasks/${originalTask.id}/comments`, {
        body: 'Existing task is still editable after the upgrade.',
      });
      const persisted = JSON.parse(records.get('schach.workspace.demo.v1')!);
      expect(persisted.workspaces[0].tasks[0].title).toBe(originalTask.title);
      expect(persisted.workspaces[0].expenses).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('keeps a member out of a second company and other employees work', async () => {
    await expect(readDemoWorkspace('c-meridian', 'u-member')).rejects.toThrow(/access/i);
    const w = await readDemoWorkspace('c-schach', 'u-member');
    expect(
      w.tasks.every((t) =>
        [t.ownerId, t.createdBy, t.reviewerId, ...t.collaborators].includes('u-member'),
      ),
    ).toBe(true);
  });
  it('rejects a stale update and records baseline changes with a reason', async () => {
    const w = await readDemoWorkspace('c-schach', 'u-founder');
    const task = w.tasks[0];
    await expect(
      demoMutate(
        'c-schach',
        'u-founder',
        `/tasks/${task.id}`,
        { version: 0, progress: 25 },
        'PATCH',
      ),
    ).rejects.toThrow(/changed/i);
    const due = addDays(todayInTimezone('Asia/Kolkata'), 7);
    await expect(
      demoMutate(
        'c-schach',
        'u-founder',
        `/tasks/${task.id}`,
        { version: task.version, dueDate: due },
        'PATCH',
      ),
    ).rejects.toThrow(/why/i);
    await demoMutate(
      'c-schach',
      'u-founder',
      `/tasks/${task.id}`,
      { version: task.version, dueDate: due, deadlineChangeReason: 'Revised delivery input' },
      'PATCH',
    );
    const changed = (await readDemoWorkspace('c-schach', 'u-founder')).tasks[0];
    expect(changed.originalDueDate).toBe(task.originalDueDate);
    expect(changed.version).toBe(task.version + 1);
    expect(changed.dueDate).toBe(due);
  });
  it('rejects self approval and allows its independent reviewer', async () => {
    const w = await readDemoWorkspace('c-schach', 'u-founder');
    const t = w.tasks.find((t) => t.status === 'in_review')!;
    await expect(
      demoMutate('c-schach', t.ownerId, `/tasks/${t.id}/review`, {
        version: t.version,
        decision: 'approve',
      }),
    ).rejects.toThrow(/own task/i);
    await demoMutate('c-schach', t.reviewerId, `/tasks/${t.id}/review`, {
      version: t.version,
      decision: 'approve',
    });
    expect(
      (await readDemoWorkspace('c-schach', 'u-founder')).tasks.find((x) => x.id === t.id)?.status,
    ).toBe('done');
  });
  it('prevents a department head from removing review on their own work', async () => {
    const w = await readDemoWorkspace('c-schach', 'u-head');
    const t = w.tasks.find((t) => t.ownerId === 'u-head' && t.status !== 'done')!;
    await expect(
      demoMutate(
        'c-schach',
        'u-head',
        `/tasks/${t.id}`,
        {
          version: t.version,
          requiresApproval: false,
          status: 'done',
          progress: 100,
          checklist: t.checklist.map((c) => ({ ...c, done: true })),
        },
        'PATCH',
      ),
    ).rejects.toThrow(/own.*review|review.*own/i);
  });
  it('preserves a required review even when company leadership edits the task', async () => {
    const w = await readDemoWorkspace('c-schach', 'u-founder');
    const t = w.tasks.find((t) => t.requiresApproval && t.status !== 'done')!;
    await expect(
      demoMutate(
        'c-schach',
        'u-founder',
        `/tasks/${t.id}`,
        { version: t.version, requiresApproval: false },
        'PATCH',
      ),
    ).rejects.toThrow(/required review/i);
  });
  it('does not let an owner remove management-assigned dependencies', async () => {
    const w = await readDemoWorkspace('c-schach', 'u-founder');
    const t = w.tasks.find((t) => t.ownerId === 'u-member' && t.status !== 'done')!;
    const dependency = await demoMutate('c-schach', 'u-founder', '/tasks', {
      title: 'Management-approved prerequisite',
      ownerId: 'u-member',
      departmentId: t.departmentId,
      dueDate: addDays(todayInTimezone('Asia/Kolkata'), 7),
      requiresApproval: false,
    });
    await demoMutate(
      'c-schach',
      'u-founder',
      `/tasks/${t.id}`,
      { version: t.version, dependencies: [dependency.id] },
      'PATCH',
    );
    await expect(
      demoMutate(
        'c-schach',
        'u-member',
        `/tasks/${t.id}`,
        { version: t.version + 1, dependencies: [] },
        'PATCH',
      ),
    ).rejects.toThrow(/manager/i);
  });
  it('does not repeat generated recurring work or reminders on a second run', async () => {
    const first = await demoMutate('c-schach', 'u-founder', '/automations/run');
    const second = await demoMutate('c-schach', 'u-founder', '/automations/run');
    expect(first.created).toBeGreaterThan(0);
    expect(second.created).toBe(0);
    expect(second.reminders).toBe(0);
  });
  it('atomically refuses mixed valid and invalid import rows', async () => {
    const w = await readDemoWorkspace('c-schach', 'u-founder');
    const input = {
      ...w.tasks[0],
      status: 'todo',
      dueDate: addDays(todayInTimezone('Asia/Kolkata'), 2),
      startDate: '',
      dependencies: [],
    };
    await expect(
      demoMutate('c-schach', 'u-founder', '/tasks/import', {
        rows: [input, { ...input, ownerId: 'cross-company' }],
      }),
    ).rejects.toThrow(/Row 3/i);
    expect((await readDemoWorkspace('c-schach', 'u-founder')).tasks).toHaveLength(w.tasks.length);
  });
  it('creates a real separate environment and retains founder access', async () => {
    const res = await demoMutate('c-schach', 'u-founder', '/companies', {
      name: 'New Company',
      slug: 'new-company',
      timezone: 'Asia/Kolkata',
    });
    const w = await readDemoWorkspace(res.id!, 'u-founder');
    expect(w.tasks).toHaveLength(0);
    expect(w.me.role).toBe('founder');
    const s = await demoLogin('founder@schach.demo', 'SchachDemo!2026');
    expect(s.companies).toHaveLength(3);
  });
});
