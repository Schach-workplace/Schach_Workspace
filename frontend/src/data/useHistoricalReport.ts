import { useExecutionRead } from './execution';
import {
  historyPath,
  type HistoricalSnapshot,
  type HistoricalRows,
  type ExportJob,
  type ReportArtifact,
} from './historicalReports';
export function useHistoricalReport(
  id: string,
  metric: string,
  membership = 'contributing',
  cursor = '',
) {
  const path = id ? historyPath(id) : '/reports/history/snapshots/none';
  const snapshot = useExecutionRead<{ snapshot: HistoricalSnapshot }>(path, !!id);
  const query = new URLSearchParams({ metric, membership, limit: '100' });
  if (cursor) query.set('cursor', cursor);
  const rows = useExecutionRead<HistoricalRows>(
    `${path}/rows?${query}`,
    !!id && !!metric && snapshot.ready,
  );
  const ready = snapshot.ready && rows.ready;
  return {
    snapshot: ready ? snapshot.data?.snapshot : undefined,
    rows: ready ? rows.data : undefined,
    ready,
    rowsReady: rows.ready,
    loading: snapshot.loading || rows.loading,
    denied: snapshot.denied || rows.denied,
    error: snapshot.error ?? rows.error,
    retry: snapshot.retry,
  };
}
export function useReportExport(id: string) {
  return useExecutionRead<{ job: ExportJob; artifact: ReportArtifact | null }>(
    `/reports/exports/${encodeURIComponent(id || 'none')}`,
    !!id,
  );
}
