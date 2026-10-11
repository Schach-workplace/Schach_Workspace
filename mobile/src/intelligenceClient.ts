import { useEffect } from "react";
import { client } from "./client";
import { useExecutionRead } from "./execution";
import { useWorkspace } from "./Workspace";
import type { IntelligenceJob } from "../../shared/intelligence/types";
export * from "../../shared/intelligence/types";
export const intelligenceRequest = <T>(
  company: string,
  path: string,
  body?: unknown,
): Promise<T> =>
  client.request<T>(
    "/companies/" + encodeURIComponent(company) + path,
    body === undefined ? "GET" : "POST",
    body,
  );
export function useIntelligence(id: string, active = true) {
  const w = useWorkspace();
  const q = useExecutionRead<IntelligenceJob>(
    "/intelligence/jobs/" + encodeURIComponent(id),
    !!id && active,
  );
  useEffect(() => {
    if (!id || !active || !w.foreground) return;
    const timer = setInterval(q.retry, 5000);
    return () => clearInterval(timer);
  }, [id, active, w.foreground, q.retry]);
  return q;
}
