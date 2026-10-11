import IntelligenceLauncher from './IntelligenceLauncher';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '../store';
import { useExecutionMutation, executionRead } from '../data/execution';
import { useHistoricalReport, useReportExport } from '../data/useHistoricalReport';
import { fetchHistoricalCSV } from '../data/api';
import {
  type HistoricalRequest,
  type ReportComparison,
  metricLabels,
  metricValue,
  validHistoricalRequest,
} from '../data/historicalReports';
import { useExecutionInput } from '../data/executionInput';
import { today, addDays } from './UI';

export default function HistoricalReports({
  onTask,
  initialJob = '',
  initialSnapshot = '',
}: {
  onTask: (id: string) => void;
  initialJob?: string;
  initialSnapshot?: string;
}) {
  const store = useWorkspace();
  const data = store.data!;
  const queryClient = useQueryClient();
  const todayValue = today(data.company.timezone);
  const end = addDays(todayValue.slice(0, 7) + '-01', -1);
  const [input, setInput] = useExecutionInput<HistoricalRequest>('$report-capture', 'request', {
    from: end.slice(0, 7) + '-01',
    to: end,
    reportZone: data.company.timezone,
    basis: 'task_history_v1',
    filters: { ownerId: '', departmentId: '', projectId: '' },
  });
  const [id, setId] = useState(initialSnapshot);
  const [jobId, setJobId] = useState(initialJob);
  const [metric, setMetric] = useState('state.cohort');
  const [membership, setMembership] = useState('contributing');
  const [cursor, setCursor] = useState('');
  const [previous, setPrevious] = useState('');
  const [compare, setCompare] = useState(false);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const download = useRef<AbortController | null>(null);
  const cancel = useExecutionMutation('$report-cancel');
  const capture = useExecutionMutation('$report-capture');
  const exportAction = useExecutionMutation(
    '$report-export',
    id ? [`/reports/history/snapshots/${id}`] : [],
  );
  const job = useReportExport(jobId);
  const snapshotId = jobId ? (job.ready ? job.data!.job.snapshotId : '') : id;
  const result = useHistoricalReport(snapshotId, metric, membership, cursor);
  const scope = JSON.stringify([store.companyId, data.me.id, data.readBasis]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const publicationReady =
    job.ready && result.ready && !job.denied && !result.denied && job.data?.job.state === 'ready';
  const authorization = useRef({ scope, ready: false, serial: 0, artifact: '' });
  useLayoutEffect(() => {
    const previous = authorization.current;
    const artifact = job.data?.artifact?.id ?? '';
    const changed =
      previous.scope !== scope ||
      previous.artifact !== artifact ||
      previous.ready !== publicationReady;
    authorization.current = {
      scope,
      ready: publicationReady,
      serial: previous.serial + (changed ? 1 : 0),
      artifact,
    };
    if (!publicationReady || changed) download.current?.abort();
  }, [scope, publicationReady, job.data?.artifact?.id]);
  const comparison = useQuery({
    queryKey: [
      'workspace',
      store.mode,
      data.me.id,
      data.company.id,
      'execution',
      data.readBasis,
      'report-compare',
      previous,
      snapshotId,
    ],
    enabled: compare && !!previous && result.ready && store.mode === 'api',
    retry: false,
    queryFn: ({ signal }) =>
      executionRead<ReportComparison>(
        store.mode,
        data.company.id,
        data.me.id,
        '/reports/history/compare',
        { leftSnapshotId: previous, rightSnapshotId: snapshotId },
        signal,
      ),
  });
  useEffect(() => {
    setCursor('');
  }, [metric, membership, snapshotId]);
  useEffect(() => () => download.current?.abort(), [scope]);
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === 'hidden') download.current?.abort();
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);
  useEffect(() => {
    if (result.denied || job.denied) {
      download.current?.abort();
      setCompare(false);
      queryClient.removeQueries({
        queryKey: ['workspace', store.mode, data.me.id, data.company.id, 'execution'],
        type: 'inactive',
      });
    }
  }, [result.denied, job.denied, queryClient, data.company.id, data.me.id, store.mode]);
  if (store.mode === 'demo')
    return (
      <p className="panel">
        Historical reports require a connected company server. Demo current tasks do not establish
        historical acceptance or effort.
      </p>
    );
  const update = (key: 'from' | 'to' | 'reportZone', value: string) =>
    setInput((x) => ({ ...x, [key]: value }));
  async function generate() {
    setError('');
    try {
      await capture.execute<{ snapshotId: string }>(
        '/reports/history/snapshots',
        capture.attempt?.payload ?? { request: input },
        'POST',
        (r) => {
          setPrevious(snapshotId);
          setId(r.snapshotId);
          setJobId('');
          setCompare(false);
        },
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function queue() {
    try {
      await exportAction.execute<{ job: { id: string } }>(
        '/reports/exports',
        exportAction.attempt?.payload ?? { snapshotId, csvSchemaVersion: 1 },
        'POST',
        (r) => setJobId(r.job.id),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function downloadCSV() {
    if (!job.ready || !job.data?.artifact || !result.ready) return;
    const captured = { ...authorization.current };
    const artifact = job.data.artifact;
    const controller = new AbortController();
    download.current = controller;
    setDownloading(true);
    const valid = () =>
      !controller.signal.aborted &&
      authorization.current.ready &&
      authorization.current.scope === captured.scope &&
      authorization.current.serial === captured.serial &&
      authorization.current.artifact === artifact.id &&
      document.visibilityState !== 'hidden';
    try {
      const blob = await fetchHistoricalCSV(
        `/companies/${encodeURIComponent(data.company.id)}/reports/artifacts/${encodeURIComponent(job.data.artifact.id)}`,
        controller.signal,
        job.data.artifact.length,
      );
      if (!valid()) return;
      // The ready endpoint checks the actual current session and whole source
      // manifest. Publication gets a fresh check after receiving all bytes.
      const final = await executionRead<{
        job: { state: string; snapshotId: string };
        artifact: { id: string; length: number; sha256: string; expiresAt: string } | null;
      }>(
        store.mode,
        data.company.id,
        data.me.id,
        `/reports/exports/${encodeURIComponent(jobId)}`,
        undefined,
        controller.signal,
      );
      if (
        !valid() ||
        final.job.state !== 'ready' ||
        final.job.snapshotId !== snapshotId ||
        final.artifact?.id !== artifact.id ||
        final.artifact.length !== artifact.length ||
        final.artifact.sha256 !== artifact.sha256 ||
        Date.parse(final.artifact.expiresAt) <= Date.now()
      )
        return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'historical-report.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      if (download.current === controller) download.current = null;
      if (currentScope.current === captured.scope) setDownloading(false);
    }
  }
  return (
    <div className="historical-reports">
      <section className="panel report-controls">
        <h2>Generate an immutable report</h2>
        <IntelligenceLauncher
          label="Explain selected report facts"
          operation="report_explanation"
          choices={
            result.ready && snapshotId
              ? [
                  {
                    label: 'Selected historical report',
                    source: {
                      kind: 'report_snapshot',
                      id: snapshotId,
                      selectedFieldSet: 'metrics',
                    },
                  },
                ]
              : []
          }
        />
        <p>
          State at period end, genuine acceptance episodes and dated effort are separate. Choose a
          completed period.
        </p>
        <div className="report-dates">
          <label>
            Historical start date
            <input
              type="date"
              value={input.from}
              onChange={(e) => update('from', e.target.value)}
            />
          </label>
          <label>
            Historical end date
            <input type="date" value={input.to} onChange={(e) => update('to', e.target.value)} />
          </label>
          <label>
            Report timezone
            <input
              value={input.reportZone}
              onChange={(e) => update('reportZone', e.target.value)}
            />
          </label>
        </div>
        <div className="report-filter-row">
          <label>
            Historical owner
            <select
              value={input.filters.ownerId}
              onChange={(e) =>
                setInput((x) => ({ ...x, filters: { ...x.filters, ownerId: e.target.value } }))
              }
            >
              <option value="">All authorized owners</option>
              {data.people
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Historical department
            <select
              value={input.filters.departmentId}
              onChange={(e) =>
                setInput((x) => ({ ...x, filters: { ...x.filters, departmentId: e.target.value } }))
              }
            >
              <option value="">All authorized departments</option>
              {data.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Historical project
            <select
              value={input.filters.projectId}
              onChange={(e) =>
                setInput((x) => ({ ...x, filters: { ...x.filters, projectId: e.target.value } }))
              }
            >
              <option value="">All authorized projects</option>
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="button button-primary"
          disabled={capture.busy || !validHistoricalRequest(input)}
          onClick={() => void generate()}
        >
          {capture.attempt ? 'Retry same report generation' : 'Generate historical report'}
        </button>
        {capture.attempt && (
          <button
            className="button button-secondary"
            onClick={() => {
              if (
                window.confirm(
                  'Abandon this unresolved request? It may already have created a report. A new generation uses a new identity.',
                )
              )
                capture.abandon();
            }}
          >
            Abandon report retry
          </button>
        )}
      </section>
      {(error || capture.error || result.error || job.error) && (
        <p role="alert">{error || capture.error || result.error?.message || job.error?.message}</p>
      )}
      {result.loading && <p role="status">Checking all current report sources…</p>}
      {result.denied && (
        <p>Report access changed. Generate a new report with your current authorized sources.</p>
      )}
      {result.ready && result.snapshot && (
        <>
          <p>
            Immutable snapshot · {result.snapshot.request.reportZone} · labels captured at
            generation · {result.snapshot.rowCount} drilldown rows
          </p>
          <div className="report-metrics">
            {Object.values(result.snapshot.summary.metrics).map((m) => (
              <button
                className="panel metric-card"
                key={m.code}
                onClick={() => {
                  setMetric(m.code);
                  setMembership('contributing');
                }}
              >
                <span>{metricLabels[m.code] ?? m.code}</span>
                <strong>{metricValue(m)}</strong>
                {m.coverage.length > 0 && <small>Incomplete commitment coverage</small>}
              </button>
            ))}
          </div>
          {result.snapshot.summary.coverage.length > 0 && (
            <p>
              Earlier history is unknown for some sources. Unavailable values are never treated as
              perfect performance.
            </p>
          )}
          <label>
            Metric membership
            <select value={membership} onChange={(e) => setMembership(e.target.value)}>
              <option value="contributing">Contributing facts</option>
              <option value="numerator">Numerator facts</option>
              <option value="denominator">Denominator facts</option>
            </select>
          </label>
          <h3>{metricLabels[metric]}</h3>
          {result.rowsReady && result.rows && (
            <>
              <ul>
                {result.rows.rows.map((r) => (
                  <li key={r.rowId}>
                    <button className="button button-ghost" onClick={() => onTask(r.taskId)}>
                      {r.state.code || 'Task'} · {r.state.title || 'Historical coverage'}
                    </button>
                    <span>
                      {r.kind} · version {r.taskVersion} · {r.acceptanceKind?.replaceAll('_', ' ')}{' '}
                      {r.reason?.replaceAll('_', ' ')} {r.entryDate}{' '}
                      {r.hours ? `${r.hours} hours` : ''}{' '}
                      {r.episodeIds?.length
                        ? `Matching acceptance episodes: ${r.episodeIds.join(', ')}`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
              {result.rows.cursor && (
                <button
                  className="button button-secondary"
                  onClick={() => setCursor(result.rows!.cursor)}
                >
                  Load next 100 facts
                </button>
              )}
            </>
          )}
          <button
            className="button button-secondary"
            disabled={exportAction.busy}
            onClick={() => void queue()}
          >
            {exportAction.attempt ? 'Retry same export request' : 'Queue private CSV export'}
          </button>
          {previous && (
            <button className="button button-secondary" onClick={() => setCompare(true)}>
              Compare with previous snapshot
            </button>
          )}
          {compare && comparison.isFetching && (
            <p role="status">Checking both comparison source sets…</p>
          )}
          {compare &&
            comparison.isFetchedAfterMount &&
            !comparison.isFetching &&
            !comparison.error &&
            comparison.data && (
              <section className="panel">
                <h3>Period comparison</h3>
                {Object.entries(comparison.data.comparisons).map(([code, c]) => (
                  <p key={code}>
                    {metricLabels[code]}: {metricValue(c.left)} → {metricValue(c.right)} ·{' '}
                    {c.percentagePoints === null
                      ? 'Rate difference unavailable'
                      : `${c.percentagePoints.toFixed(1)} percentage points`}
                  </p>
                ))}
              </section>
            )}
          {comparison.error && <p role="alert">{comparison.error.message}</p>}
        </>
      )}
      {jobId && (
        <section className="panel">
          <h3>Private export</h3>
          {job.loading && <p role="status">Checking export access…</p>}
          {job.ready && job.data && (
            <>
              <p>
                {job.data.job.state} {job.data.job.failureCode.replaceAll('_', ' ')}
              </p>
              <button className="button button-secondary" onClick={() => void job.retry()}>
                Recheck export
              </button>
              {['queued', 'running', 'ready'].includes(job.data.job.state) && (
                <button
                  className="button button-secondary"
                  disabled={cancel.busy}
                  onClick={() => {
                    void cancel
                      .execute(
                        `/reports/exports/${encodeURIComponent(jobId)}/cancel`,
                        cancel.attempt?.payload ?? {},
                        'POST',
                        () => {
                          download.current?.abort();
                          void job.retry();
                        },
                      )
                      .catch((e) => setError(e.message));
                  }}
                >
                  Cancel export and delivery
                </button>
              )}
              {job.data.artifact && result.ready && (
                <>
                  <p>
                    Expires {new Date(job.data.artifact.expiresAt).toLocaleString()}. Exported
                    copies cannot be recalled.
                  </p>
                  <button
                    className="button button-primary"
                    disabled={downloading}
                    onClick={() => void downloadCSV()}
                  >
                    Download authorized CSV
                  </button>
                </>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
