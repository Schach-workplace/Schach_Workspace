import { request } from './api';
export async function readPages<T>(
  path: string,
  key: string,
  signal?: AbortSignal,
  read: (path: string, options: { signal?: AbortSignal }) => Promise<unknown> = request,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor = '';
  const seen = new Set<string>();
  do {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const page = (await read(`${path}${path.includes('?') ? '&' : '?'}${params}`, {
      signal,
    })) as Record<string, unknown>;
    rows.push(...(page[key] as T[]));
    if (!page.hasMore) return rows;
    cursor = page.cursor as string;
    if (!cursor || seen.has(cursor)) throw Error('The server returned an invalid page cursor.');
    seen.add(cursor);
  } while (true);
}
export function affectedScopes(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'attention') return ['attention'];
  if (parts[0] === 'tasks') {
    return [
      'tasks',
      'attention',
      ...(parts[1] && !['import'].includes(parts[1]) ? ['task:' + parts[1]] : []),
      'reports',
      'bootstrap',
    ];
  }
  if (parts[0] === 'expenses') {
    return ['attention', 'finance', ...(parts[1] ? ['expense:' + parts[1]] : []), 'bootstrap'];
  }
  if (['budgets', 'expense-categories'].includes(parts[0])) return ['finance', 'bootstrap'];
  if (parts[0] === 'notifications') return ['bootstrap'];
  return ['attention', 'bootstrap', 'tasks', 'finance', 'reports', 'details'];
}
export function eventScopes(kind: string): string[] {
  if (
    [
      'record_created',
      'record_revised',
      'record_response',
      'message_edited',
      'message_removed',
      'request_published',
      'policy_changed',
      'membership_changed',
      'refetch_required',
    ].includes(kind)
  )
    return ['attention', 'bootstrap', 'tasks', 'finance', 'reports', 'details'];
  if (['work_linked', 'work_actions_declared', 'request_published'].includes(kind))
    return ['attention', 'bootstrap', 'tasks', 'reports', 'task-details'];
  if (kind === 'expense_linked') return ['attention', 'bootstrap', 'finance', 'expense-details'];
  if (['policy_changed', 'membership_changed', 'refetch_required'].includes(kind))
    return ['attention', 'bootstrap', 'tasks', 'finance', 'reports', 'details'];
  return [];
}
export async function readDetail<T>(
  path: string,
  key: 'task' | 'expense',
  signal?: AbortSignal,
  read: (path: string, options: { signal?: AbortSignal }) => Promise<unknown> = request,
): Promise<T> {
  const result = (await read(path, { signal })) as Record<string, unknown>;
  const record = result[key] as Record<string, unknown>;
  const evidence = result.evidence as
    Record<string, { hasMore: boolean; cursor: string }> | undefined;
  const people = (result.people ?? []) as { id: string }[];
  for (const field of key === 'task' ? ['comments', 'timeEntries', 'attachments'] : ['receipts']) {
    let meta = evidence?.[field];
    const seen = new Set<string>();
    while (meta?.hasMore) {
      if (!meta.cursor || seen.has(meta.cursor)) throw Error('Invalid evidence cursor.');
      seen.add(meta.cursor);
      const params = new URLSearchParams({ limit: '100', cursor: meta.cursor });
      const endpoint = field === 'timeEntries' ? 'time' : field;
      const page = (await read(`${path}/${endpoint}?${params}`, { signal })) as Record<
        string,
        unknown
      >;
      record[field] = [...(record[field] as unknown[]), ...(page[field] as unknown[])];
      people.push(...((page.people ?? []) as { id: string }[]));
      meta = { hasMore: !!page.hasMore, cursor: String(page.cursor ?? '') };
    }
  }
  result.people = Array.from(new Map(people.map((p) => [p.id, p])).values());
  return result as T;
}
