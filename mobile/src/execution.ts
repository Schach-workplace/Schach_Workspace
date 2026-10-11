import { mergeExecutionPage } from "../../shared/business/pagination";
import { useRamInput } from "./ramInput";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { client, NativeApiError } from "./client";
import { useWorkspace } from "./Workspace";
import {
  useBusinessAttempt,
  beginAttempt,
  businessKey,
  markAttemptCommitted,
  retireAttempt,
  clearAttemptScope,
  clearAttemptsForSource,
} from "./businessAttempts";
import {
  readDraft,
  clearDraft,
  clearConversationDrafts,
  clearFormPrefix,
} from "./conversationDrafts";
export * from "../../shared/business/types";
export function useExecutionRead<T>(
  path: string,
  enabled = true,
  body?: unknown,
) {
  const w = useWorkspace();
  const [epoch, setEpoch] = useState(0);
  const bodyKey = JSON.stringify(body);
  const scope = [
    client.endpoint,
    client.generation,
    w.company,
    w.session?.user.id,
    w.work?.readBasis,
    w.policyEpoch,
    w.recordEpoch,
    w.attentionEpoch,
    w.executionEpoch,
    w.foreground,
    path,
    bodyKey,
    epoch,
    enabled,
  ].join(":");
  const [loaded, setLoaded] = useState<{
    scope: string;
    data?: T;
    error?: string;
    denied?: boolean;
  }>();
  useEffect(() => {
    let alive = true;
    const generation = client.generation;
    if (!enabled || !w.foreground || !w.work) return;
    (async () => {
      try {
        let data =
          bodyKey === undefined
            ? await client.request<T>(`/companies/${w.company}${path}`)
            : await client.request<T>(
                `/companies/${w.company}${path}`,
                "POST",
                JSON.parse(bodyKey),
              );
        if (
          data &&
          typeof data === "object" &&
          ("nextCursor" in data || "cursor" in data)
        ) {
          let cursor =
            (data as { nextCursor?: string; cursor?: string }).nextCursor ??
            (data as { cursor?: string }).cursor;
          const seen = new Set<string>();
          while (cursor && !seen.has(cursor)) {
            seen.add(cursor);
            const next = await client.request<T>(
              `/companies/${w.company}${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`,
            );
            mergeExecutionPage(
              data as Record<string, unknown>,
              next as Record<string, unknown>,
            );
            cursor =
              (next as { nextCursor?: string; cursor?: string }).nextCursor ??
              (next as { cursor?: string }).cursor;
          }
        }
        if (alive && generation === client.generation)
          setLoaded({ scope, data });
      } catch (e) {
        if (
          alive &&
          generation === client.generation &&
          e instanceof NativeApiError &&
          ([401, 403, 404].includes(e.status) ||
            ((path.startsWith("/reports/") || path.includes("/evidence-")) &&
              e.status === 409 &&
              e.code === "access_changed"))
        ) {
          clearAttemptsForSource(
            client.endpoint,
            w.company,
            w.session?.user.id ?? "",
            path.split("?")[0],
          );
          const goal = path.match(/^\/goals\/([^/?]+)$/);
          if (goal)
            for (const prefix of [
              "$goal-measure:" + goal[1] + ":",
              "$goal-metadata:" + goal[1],
              "$goal-reminder:" + goal[1],
            ])
              clearFormPrefix(w.company, w.session?.user.id ?? "", prefix);
          const finance = path.match(
            /^\/finance\/(receipt-extractions|intakes|duplicate-candidates|statement-previews)\/([^/?]+)/,
          );
          if (finance) {
            const family = finance[1],
              id = finance[2];
            for (const form of family === "receipt-extractions"
              ? ["$receipt-review:", "$receipt-accept:"]
              : family === "intakes"
                ? ["$intake:", "$statement-map:"]
                : family === "duplicate-candidates"
                  ? ["$duplicate:"]
                  : ["$statement-map:"])
              clearConversationDrafts(
                w.company,
                w.session?.user.id ?? "",
                form + id,
              );
          }
          const project = path.match(/^\/projects\/([^/?]+)$/);
          const milestone = path.match(/^\/project-milestones\/([^/?]+)$/);
          if (project) {
            clearConversationDrafts(
              w.company,
              w.session?.user.id ?? "",
              "$milestone:" + project[1],
            );
            clearConversationDrafts(
              w.company,
              w.session?.user.id ?? "",
              "$project:" + project[1],
            );
          }
          if (milestone)
            clearConversationDrafts(
              w.company,
              w.session?.user.id ?? "",
              "$milestone:" + milestone[1],
            );
        }
        if (alive && generation === client.generation)
          setLoaded({
            scope,
            error:
              e instanceof NativeApiError
                ? e.message
                : "Unable to load current access. Retry when connected.",
            denied:
              e instanceof NativeApiError &&
              ([401, 403, 404].includes(e.status) ||
                ((path.startsWith("/reports/") ||
                  path.includes("/evidence-")) &&
                  e.status === 409 &&
                  e.code === "access_changed")),
          });
      }
    })();
    return () => {
      alive = false;
    };
  }, [
    scope,
    bodyKey,
    w.company,
    w.foreground,
    w.work,
    w.session?.user.id,
    enabled,
    path,
  ]);
  const denied = loaded?.scope === scope && loaded.denied;
  useEffect(() => {
    if (denied)
      clearAttemptsForSource(
        client.endpoint,
        w.company,
        w.session?.user.id ?? "",
        path.startsWith("/reports/") ? path.split("/rows")[0] : path,
      );
  }, [denied, path, w.company, w.session?.user.id]);
  const current =
    enabled && w.foreground && !!w.work && loaded?.scope === scope;
  return {
    data: current ? loaded.data : undefined,
    error: current ? loaded.error : undefined,
    denied: current && loaded.denied,
    ready: current && !loaded.error,
    loading: enabled && w.foreground && !current,
    retry: () => setEpoch((e) => e + 1),
  };
}
export function useExecutionMutation(formId: string, sources: string[] = []) {
  const w = useWorkspace();
  const business = useBusinessAttempt<Record<string, unknown>>(formId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  const scope = JSON.stringify(business.scope);
  const current = useRef(scope);
  useLayoutEffect(() => {
    current.current = scope;
  }, [scope]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function execute<T = Record<string, unknown>>(
    path: string,
    payload: Record<string, unknown>,
    method: "POST" | "PATCH" = "POST",
    onCommitted?: (result: T) => void,
  ): Promise<T> {
    if (pending.current || !w.foreground || !w.work)
      throw Error("Open the current company before submitting.");
    pending.current = true;
    setBusy(true);
    setError("");
    const captured = scope;
    const generation = client.generation;
    try {
      // Existing project PATCH uses the accepted positive-version CAS contract.
      const keyed = !(method === "PATCH" && /^\/projects\/[^/]+$/.test(path));
      const attempt = keyed
        ? beginAttempt(
            business.scope,
            business.attempt?.payload ?? payload,
            businessKey(),
            { path, method, ...(sources.length ? { sources } : {}) },
          )
        : undefined;
      const result = await client.request<T>(
        `/companies/${w.company}${path}`,
        method,
        attempt ? { ...attempt.payload, retryKey: attempt.retryKey } : payload,
      );
      if (generation !== client.generation || current.current !== captured)
        throw Error("Company changed. Open the current workspace.");
      const r = result as { id?: string; ids?: string[] };
      if (attempt) {
        markAttemptCommitted(business.scope, attempt.retryKey, {
          ids: r.ids ?? (r.id ? [r.id] : []),
        });
        retireAttempt(business.scope, attempt.retryKey);
      }
      onCommitted?.(result);
      if (!path.endsWith("/preview")) {
        try {
          await w.refresh(
            path.startsWith("/finance") ||
              path.startsWith("/expenses") ||
              path.startsWith("/expense-receipts")
              ? "finance"
              : path.includes("task")
                ? "tasks"
                : "attention",
          );
        } catch {
          if (alive.current)
            setError("Saved. Refresh to inspect the current result.");
        }
      }
      return result;
    } catch (e) {
      if (
        e instanceof NativeApiError &&
        ([401, 403, 404].includes(e.status) ||
          (e.status === 409 && e.code === "access_changed"))
      )
        clearAttemptScope(business.scope);
      if (alive.current && current.current === captured)
        setError(
          e instanceof NativeApiError
            ? e.message
            : method === "PATCH" && /^\/projects\/[^/]+$/.test(path)
              ? "Result unknown. Close and inspect current project defaults before saving again."
              : "The result is unknown. Retry this same submission when connected.",
        );
      throw e;
    } finally {
      pending.current = false;
      if (alive.current && current.current === captured) setBusy(false);
    }
  }
  return {
    ...business,
    busy,
    error,
    execute,
    abandon: () => clearAttemptScope(business.scope),
  };
}
/** Async authored previews may commit state only while this exact source is current. */
export function useExecutionGuard(identity: string) {
  const w = useWorkspace();
  const scope = [
    client.endpoint,
    client.generation,
    w.company,
    w.session?.user.id,
    w.foreground,
    w.work?.readBasis,
    w.policyEpoch,
    identity,
  ].join(":");
  const current = useRef(scope);
  useLayoutEffect(() => {
    current.current = scope;
  }, [scope]);
  useEffect(
    () => () => {
      current.current = "";
    },
    [],
  );
  return () => {
    const captured = scope;
    return () => current.current === captured;
  };
}
export function useAuthoredRetirement(form: string) {
  const w = useWorkspace();
  const scope = {
    serverOrigin: client.endpoint,
    companyId: w.company,
    userId: w.session?.user.id ?? "",
    conversationId: form,
  };
  return (submitted: Record<string, unknown>) => {
    for (const [field, value] of Object.entries(submitted)) {
      const key = { ...scope, threadRootId: "input:" + field };
      const body = readDraft(key).body;
      if (body && body === JSON.stringify(value)) clearDraft(key);
    }
  };
}
export function useExecutionBasis<T>(form: string, initial: T) {
  const [basis, remember] = useRamInput(form, "expectedBasis", initial);
  return { basis, freeze: () => remember(basis) };
}
