interface NativeReadProjection {
  readBasis?: string;
  me: { role: string; departmentId: string; managerId?: string };
  tasks: unknown[];
  expenses: unknown[];
}
export function sameNativeReadBasis(
  previous: NativeReadProjection | null,
  next: NativeReadProjection,
): boolean {
  return (
    !!previous &&
    previous.readBasis === next.readBasis &&
    previous.me.role === next.me.role &&
    previous.me.departmentId === next.me.departmentId &&
    previous.me.managerId === next.me.managerId
  );
}
export function confirmedNativeWork<T extends NativeReadProjection>(
  previous: T | null,
  bootstrap: T,
): T {
  return {
    ...bootstrap,
    tasks: sameNativeReadBasis(previous, bootstrap) ? previous!.tasks : [],
    expenses: sameNativeReadBasis(previous, bootstrap)
      ? previous!.expenses
      : [],
  };
}
export async function readWorkPages<T>(
  read: <R>(path: string) => Promise<R>,
  company: string,
  key: string,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor = "";
  const seen = new Set<string>();
  do {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const page = await read<Record<string, unknown>>(
      `/companies/${encodeURIComponent(company)}/${key}?${params}`,
    );
    rows.push(...(page[key] as T[]));
    if (!page.hasMore) return rows;
    cursor = page.cursor as string;
    if (!cursor || seen.has(cursor)) throw Error("Invalid work page cursor.");
    seen.add(cursor);
  } while (true);
}
export function nativeEventScope(
  kind: string,
): "tasks" | "finance" | "attention" | "all" | "" {
  if (
    ["work_linked", "work_actions_declared", "request_published"].includes(kind)
  )
    return "tasks";
  if (["record_created", "record_response", "record_revised", "message_edited", "message_removed"].includes(kind)) return "attention";
  if (kind === "expense_linked") return "finance";
  if (
    ["membership_changed", "policy_changed", "refetch_required"].includes(kind)
  )
    return "all";
  return "";
}
export async function readNativeDetail<T>(
  read: <R>(path: string) => Promise<R>,
  path: string,
  key: "task" | "expense",
): Promise<T> {
  const result = await read<Record<string, unknown>>(path);
  const record = result[key] as Record<string, unknown>;
  const field = key === "task" ? "attachments" : "receipts";
  let meta = (
    result.evidence as
      Record<string, { hasMore: boolean; cursor: string }> | undefined
  )?.[field];
  const seen = new Set<string>();
  while (meta?.hasMore) {
    if (!meta.cursor || seen.has(meta.cursor))
      throw Error("Invalid evidence cursor.");
    seen.add(meta.cursor);
    const params = new URLSearchParams({ limit: "100", cursor: meta.cursor });
    const page = await read<Record<string, unknown>>(
      `${path}/${field}?${params}`,
    );
    record[field] = [
      ...(record[field] as unknown[]),
      ...(page[field] as unknown[]),
    ];
    meta = { hasMore: !!page.hasMore, cursor: String(page.cursor ?? "") };
  }
  return result as T;
}
