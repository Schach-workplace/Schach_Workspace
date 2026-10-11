import { useEffect } from 'react';
import { useExecutionRead } from './execution';
import type { IntelligenceJob } from './intelligence';
export function useIntelligence(id: string, active = true) {
  const query = useExecutionRead<IntelligenceJob>(
    '/intelligence/jobs/' + encodeURIComponent(id),
    !!id && active,
  );
  useEffect(() => {
    if (!id || !active) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void query.retry();
    }, 5000);
    return () => clearInterval(timer);
  }, [id, active, query.retry]);
  return query;
}
