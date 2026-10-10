/** Merge authorized cursor pages without dropping cross-page graph relationships. */
export function mergeExecutionPage(
  target: Record<string, unknown>,
  page: Record<string, unknown>,
) {
  for (const key of [
    "templates",
    "projects",
    "milestones",
    "nodes",
    "edges",
    "paths",
  ]) {
    if (!Array.isArray(target[key]) || !Array.isArray(page[key])) continue;
    const seen = new Set<string>();
    target[key] = [...target[key], ...page[key]].filter((value) => {
      const identity =
        key === "edges"
          ? JSON.stringify([value.from, value.to])
          : key === "paths"
            ? JSON.stringify(value)
            : value.id;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }
  target.nextCursor = page.nextCursor;
}
