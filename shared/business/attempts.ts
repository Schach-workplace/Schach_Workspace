export interface BusinessAttemptScope {
  serverOrigin: string;
  companyId: string;
  userId: string;
  formId: string;
}
export interface BusinessActorBasis {
  memberAccessEpoch: number;
  role: string;
  departmentId: string;
  managerId: string;
}
export interface BusinessAttemptTarget {
  canonical?: true;
  path: string;
  method: "POST" | "PATCH";
  sources?: string[];
}
export interface FrozenBusinessAttempt<T = unknown> {
  retryKey: string;
  actorBasis?: BusinessActorBasis;
  target?: BusinessAttemptTarget;
  payload: T;
  state: "unknown" | "committed";
  result?: { ids: string[] };
}
const attempts = new Map<string, FrozenBusinessAttempt>();
const listeners = new Set<() => void>();
let hardGeneration = 0;
export const businessAttemptGeneration = () => hardGeneration;
const identity = (scope: BusinessAttemptScope) =>
  JSON.stringify([
    scope.serverOrigin,
    scope.companyId,
    scope.userId,
    scope.formId,
  ]);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonical((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const changed = () => listeners.forEach((fn) => fn());
export function subscribeAttempts(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function beginAttempt<T>(
  scope: BusinessAttemptScope,
  payload: T,
  key: string,
  target?: BusinessAttemptTarget,
  actorBasis?: BusinessActorBasis,
): FrozenBusinessAttempt<T> {
  const previous = readAttempt<T>(scope);
  if (previous) {
    if (
      canonical(previous.payload) !== canonical(payload) ||
      canonical(previous.target) !== canonical(target)
    )
      throw Error(
        "This attempt may already have created work. Retry its frozen intent before starting another.",
      );
    return previous;
  }
  if (!key.trim() || key.length > 100) throw Error("Choose a valid retry key.");
  const attempt = freeze({
    retryKey: key,
    ...(validBusinessActorBasis(actorBasis)
      ? { actorBasis: { ...actorBasis } }
      : {}),
    ...(target
      ? {
          target: {
            ...target,
            ...(target.sources ? { sources: [...target.sources] } : {}),
          },
        }
      : {}),
    payload: JSON.parse(JSON.stringify(payload)) as T,
    state: "unknown" as const,
  });
  attempts.set(identity(scope), attempt);
  changed();
  return attempt;
}
export function readAttempt<T = unknown>(scope: BusinessAttemptScope) {
  return attempts.get(identity(scope)) as FrozenBusinessAttempt<T> | undefined;
}
export function markAttemptCommitted(
  scope: BusinessAttemptScope,
  key: string,
  result: { ids: string[] },
) {
  const a = readAttempt(scope);
  if (a?.retryKey !== key) return false;
  attempts.set(
    identity(scope),
    freeze({
      ...a,
      payload: null,
      state: "committed" as const,
      result: { ids: [...result.ids] },
    }),
  );
  changed();
  return true;
}
export function retireAttempt(
  scope: BusinessAttemptScope,
  key: string,
): boolean {
  if (readAttempt(scope)?.retryKey !== key) return false;
  attempts.delete(identity(scope));
  changed();
  return true;
}
export function clearAttemptScope(scope: BusinessAttemptScope) {
  hardGeneration++;
  if (attempts.delete(identity(scope))) changed();
}
export function clearAttemptsForPrincipal(
  serverOrigin: string,
  companyId: string,
  userId: string,
) {
  hardGeneration++;
  for (const key of attempts.keys()) {
    const [s, c, u] = JSON.parse(key);
    if (s === serverOrigin && c === companyId && u === userId)
      attempts.delete(key);
  }
  changed();
}
export function clearAttemptsForSource(
  serverOrigin: string,
  companyId: string,
  userId: string,
  sourcePath: string,
) {
  hardGeneration++;
  for (const [key, attempt] of attempts) {
    const [s, c, u] = JSON.parse(key);
    const path = attempt.target?.path;
    if (
      s === serverOrigin &&
      c === companyId &&
      u === userId &&
      ((path && (path === sourcePath || path.startsWith(sourcePath + "/"))) ||
        attempt.target?.sources?.includes(sourcePath))
    )
      attempts.delete(key);
  }
  changed();
}
export function clearAllBusinessAttempts() {
  hardGeneration++;
  attempts.clear();
  changed();
}

export function validBusinessActorBasis(
  value: unknown,
): value is BusinessActorBasis {
  const a = value as BusinessActorBasis | undefined;
  return (
    !!a &&
    Number.isSafeInteger(a.memberAccessEpoch) &&
    a.memberAccessEpoch > 0 &&
    typeof a.role === "string" &&
    a.role.length > 0 &&
    typeof a.departmentId === "string" &&
    typeof a.managerId === "string"
  );
}
export function sameBusinessActorBasis(a: unknown, b: unknown): boolean {
  return (
    validBusinessActorBasis(a) &&
    validBusinessActorBasis(b) &&
    a.memberAccessEpoch === b.memberAccessEpoch &&
    a.role === b.role &&
    a.departmentId === b.departmentId &&
    a.managerId === b.managerId
  );
}
// This registry describes actual canonical mutation adapters; POST/PATCH alone
// never qualifies. In particular ordinary project PATCH is not registered.
export function canonicalBusinessTarget(
  path: string,
  method: "POST" | "PATCH",
): boolean {
  if (method === "PATCH")
    return (
      /^\/(goals|task-templates|project-milestones|people\/presets)\/[^/?]+$/.test(
        path,
      ) || /^\/goals\/[^/?]+\/reminder-preference$/.test(path)
    );
  return (
    /^\/goals(?:\/[^/?]+\/measurements)?$/.test(path) ||
    /^\/task-templates(?:\/[^/?]+\/apply)?$/.test(path) ||
    /^\/projects\/[^/?]+\/milestones$/.test(path) ||
    /^\/project-milestones\/[^/?]+\/transition$/.test(path) ||
    /^\/(?:task-bulk|task-schedule)\/(?:preview|apply)$/.test(path) ||
    /^\/people\/(?:presets|onboarding\/(?:preview|apply)|access-reviews\/preview|access-reviews\/[^/?]+\/complete|[^/?]+\/departure\/(?:preview|apply))$/.test(
      path,
    )
  );
}
// One existing-map graph filter. Undefined current basis quarantines a valid
// submitted request during bootstrap; callers still block all sends/projections.
export function filterBusinessAttemptsForGraph(
  serverOrigin: string,
  companyId: string,
  userId: string,
  currentBasis?: BusinessActorBasis,
) {
  for (const [key, a] of attempts) {
    const [s, c, u] = JSON.parse(key);
    if (s !== serverOrigin || c !== companyId || u !== userId) continue;
    const target = a.target;
    if (
      a.state !== "unknown" ||
      !target?.canonical ||
      !canonicalBusinessTarget(target.path, target.method) ||
      !validBusinessActorBasis(a.actorBasis) ||
      (currentBasis !== undefined &&
        !sameBusinessActorBasis(a.actorBasis, currentBasis))
    )
      attempts.delete(key);
  }
  changed();
}
