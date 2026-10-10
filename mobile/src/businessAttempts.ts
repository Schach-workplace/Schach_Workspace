import { useSyncExternalStore } from "react";
import { randomUUID } from "expo-crypto";
import { client } from "./client";
import { useWorkspace } from "./Workspace";
import {
  readAttempt,
  subscribeAttempts,
  type BusinessAttemptScope,
} from "../../shared/business/attempts";
export * from "../../shared/business/attempts";
export const businessKey = () => randomUUID();
export function useBusinessAttempt<T>(formId: string) {
  const w = useWorkspace();
  const scope: BusinessAttemptScope = {
    serverOrigin: client.endpoint,
    companyId: w.company,
    userId: w.session?.user.id ?? "",
    formId,
  };
  const attempt = useSyncExternalStore(subscribeAttempts, () =>
    readAttempt<T>(scope),
  );
  return { scope, attempt };
}
