import { useSyncExternalStore } from 'react';
import { useWorkspace } from '../store';
import {
  readAttempt,
  subscribeAttempts,
  type BusinessAttemptScope,
} from '../../../shared/business/attempts';
export * from '../../../shared/business/attempts';
export function useBusinessAttempt<T>(formId: string) {
  const store = useWorkspace();
  const scope: BusinessAttemptScope = {
    serverOrigin: (import.meta.env.VITE_API_URL ?? window.location.origin) + ':' + store.mode,
    companyId: store.companyId,
    userId: store.session?.user.id ?? '',
    formId,
  };
  const attempt = useSyncExternalStore(subscribeAttempts, () => readAttempt<T>(scope));
  return { scope, attempt };
}
export const businessKey = () => crypto.randomUUID();
