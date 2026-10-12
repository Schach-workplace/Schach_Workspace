import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../store';
import { useExecutionInput } from '../data/executionInput';
import {
  useExecutionRead,
  useExecutionMutation,
  demoUnavailableMessage,
  downloadFinanceFile,
} from '../data/execution';
import {
  financeFileHash,
  financeAssessmentMessage,
  uploadFinanceFile,
  type FinanceIntake,
  type ReceiptJob,
} from '../data/financeAssistance';
import ReceiptExtractionReview, { AssistListState, assistTime } from './ReceiptExtractionReview';
import { Field, SectionHeader } from './UI';
import FinanceDuplicateReview from './FinanceDuplicateReview';
import StatementImportReview from './StatementImportReview';
import FinanceReconciliation from './FinanceReconciliation';

type ListedReceiptJob = ReceiptJob & { createdAt?: string };
function Intake({
  id,
  onExtracted,
  onImported,
}: {
  id: string;
  onExtracted: (id: string) => void;
  onImported: (id: string) => void;
}) {
  const w = useWorkspace();
  const path = '/finance/intakes/' + id;
  const q = useExecutionRead<FinanceIntake>(path);
  const finalize = useExecutionMutation('$intake-finalize:' + id, [path]);
  const cancel = useExecutionMutation('$intake-cancel:' + id, [path]);
  const assessmentRetry = useExecutionMutation('$intake-assessment-retry:' + id, [path]);
  const extract = useExecutionMutation('$intake-extract:' + id, [path]);
  const [file, setFile] = useState<File>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [optIn, setOptIn] = useExecutionInput('$intake:' + id, 'optIn', false);
  const scope = [w.companyId, w.session?.user.id, w.data?.readBasis].join(':');
  const current = useRef(scope);
  current.current = scope;
  const abort = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === 'hidden') {
        abort.current?.abort();
        setFile(undefined);
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      abort.current?.abort();
      document.removeEventListener('visibilitychange', hide);
    };
  }, [scope]);
  async function upload() {
    if (!q.data || !file || busy) return;
    const captured = scope;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    try {
      await uploadFinanceFile(w.data!.company.id, q.data, file, controller.signal);
      if (current.current === captured) {
        setFile(undefined);
        void q.retry();
      }
    } catch (e) {
      if (current.current === captured) setError((e as Error).message);
    } finally {
      if (current.current === captured) setBusy(false);
    }
  }
  async function download() {
    if (!q.data || downloading) return;
    const captured = scope;
    setDownloading(true);
    setError('');
    try {
      await downloadFinanceFile(
        w.data!.company.id,
        path + '/download',
        q.data.fileName || 'finance-file',
      );
    } catch (e) {
      if (current.current === captured) setError((e as Error).message);
    } finally {
      if (current.current === captured) setDownloading(false);
    }
  }
  return (
    <section className="finance-assist-card" aria-label="Private staged file">
      <h3>Private staged {q.data?.purpose ?? 'file'}</h3>
      {q.loading && !q.data && (
        <p className="finance-assist-status" role="status">
          Checking current owner and source access…
        </p>
      )}
      {q.data && (
        <>
          <p className="finance-assist-meta">
            {q.data.fileName || 'Unbound camera reservation'} · {q.data.state}. Expires{' '}
            {assistTime(q.data.expiresAt)}.
          </p>
          {q.data.state === 'reserved' && (
            <div className="finance-assist-form">
              <Field label="Reselect this exact file to stage it">
                <input type="file" disabled={busy} onChange={(e) => setFile(e.target.files?.[0])} />
              </Field>
            </div>
          )}
          {financeAssessmentMessage(q.data) && (
            <p className="finance-assist-status finance-assist-status-error" role="alert">
              {financeAssessmentMessage(q.data)}
            </p>
          )}
          {q.data.state === 'clean' && q.data.purpose === 'receipt' && (
            <label className="check-field finance-assist-check">
              <input
                type="checkbox"
                checked={optIn}
                disabled={!!extract.attempt || extract.busy}
                onChange={(e) => setOptIn(e.target.checked)}
              />
              Use local receipt extraction; I will review all candidates
            </label>
          )}
          <div className="finance-assist-actions">
            {q.data.state === 'reserved' && (
              <button
                className="button button-primary"
                disabled={!file || busy}
                aria-busy={busy}
                onClick={() => void upload()}
              >
                Stage exact reserved file
              </button>
            )}
            {(q.data.state === 'uploaded' || !!finalize.attempt) && (
              <button
                className="button button-primary"
                disabled={finalize.busy}
                aria-busy={finalize.busy}
                onClick={() =>
                  void finalize
                    .execute(
                      path + '/finalize',
                      finalize.attempt?.payload ?? { expectedVersion: q.data!.version },
                    )
                    .then(() => q.retry())
                    .catch(() => {})
                }
              >
                {finalize.attempt ? 'Retry same clean request' : 'Request clean assessment'}
              </button>
            )}
            {q.data.state === 'scanning' && !financeAssessmentMessage(q.data) && (
              <button className="button button-secondary" onClick={() => void q.retry()}>
                Check clean assessment
              </button>
            )}
            {(q.data.assessment?.retryable || assessmentRetry.attempt) && (
              <button
                className="button button-secondary"
                disabled={!q.ready || assessmentRetry.busy || !!finalize.attempt}
                aria-busy={assessmentRetry.busy}
                onClick={() =>
                  void assessmentRetry
                    .execute(
                      path + '/finalize',
                      assessmentRetry.attempt?.payload ?? {
                        expectedVersion: q.data!.version,
                        retryAssessment: true,
                      },
                    )
                    .then(() => q.retry())
                    .catch(() => {})
                }
              >
                {assessmentRetry.attempt
                  ? 'Retry same clean assessment request'
                  : 'Retry unavailable clean assessment'}
              </button>
            )}
            {q.data.state === 'clean' && q.data.purpose === 'receipt' && (
              <button
                className="button button-primary"
                disabled={!optIn || extract.busy}
                aria-busy={extract.busy}
                onClick={() =>
                  void extract
                    .execute<ReceiptJob>(
                      '/finance/receipt-extractions',
                      {
                        source: { kind: 'intake', id, expectedVersion: q.data!.version },
                        destinationDepartmentId: q.data!.destinationDepartmentId,
                        optIn: true,
                      },
                      'POST',
                      (r) => onExtracted(r.id),
                    )
                    .catch(() => {})
                }
              >
                {extract.attempt ? 'Retry same extraction request' : 'Extract this receipt'}
              </button>
            )}
            {q.data.state === 'clean' && (
              <button
                className="button button-secondary"
                disabled={downloading}
                aria-busy={downloading}
                onClick={() => void download()}
              >
                Download staged file
              </button>
            )}
            <button
              className="button button-secondary"
              disabled={cancel.busy}
              aria-busy={cancel.busy}
              onClick={() =>
                void cancel
                  .execute(path + '/cancel', { expectedVersion: q.data!.version })
                  .then(() => q.retry())
                  .catch(() => {})
              }
            >
              Cancel private intake
            </button>
          </div>
          {q.data.state === 'clean' && q.data.purpose === 'statement' && (
            <StatementImportReview intakeId={id} intake={q.data} onImported={onImported} />
          )}
        </>
      )}
      <p role="alert" className="finance-assist-error">
        {error ||
          finalize.error ||
          assessmentRetry.error ||
          cancel.error ||
          extract.error ||
          q.error?.message}
      </p>
    </section>
  );
}
export default function FinanceAssistance({
  onCreated,
  initialJob = '',
  initialIntake = '',
}: {
  onCreated: (id: string) => void;
  initialJob?: string;
  initialIntake?: string;
}) {
  const w = useWorkspace();
  const demo = w.mode === 'demo';
  const [requestedTool, setTab] = useState(
    new URLSearchParams(window.location.hash.split('?')[1]).get('tool') ?? 'receipt',
  );
  const [intake, setIntake] = useExecutionInput('$finance-assistance', 'intake', initialIntake);
  const [job, setJob] = useExecutionInput('$finance-assistance', 'job', initialJob);
  const [importId, setImport] = useExecutionInput('$finance-assistance', 'import', '');
  const [department, setDepartment] = useExecutionInput('$finance-assistance', 'destination', '');
  const [file, setFile] = useState<File>();
  const [error, setError] = useState('');
  const m = useExecutionMutation('$finance-intake-reserve');
  const list = useExecutionRead<{ items: FinanceIntake[] }>('/finance/intakes', !demo);
  const jobs = useExecutionRead<{ items: ListedReceiptJob[] }>(
    '/finance/receipt-extractions',
    !demo,
  );
  const authority = ['founder', 'ceo', 'admin', 'finance'].includes(w.data?.me.role ?? '');
  // A deep link may name any tool; only tools the current role may use are honoured.
  const tools = ['receipt', 'duplicates', ...(authority ? ['statement', 'reconciliation'] : [])];
  const tab = tools.includes(requestedTool) ? requestedTool : 'receipt';
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === 'hidden') setFile(undefined);
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);
  async function reserve() {
    try {
      if (m.attempt) {
        await m.execute<FinanceIntake>('/finance/intakes', m.attempt.payload, 'POST', (r) =>
          setIntake(r.id),
        );
        return;
      }
      if (!file) throw Error('Choose a file.');
      const max = tab === 'statement' ? 8 : 10;
      if (file.size < 1 || file.size > max * 1048576)
        throw Error(`Choose a nonempty file up to ${max} MiB.`);
      const sha256 = await financeFileHash(file);
      await m.execute<FinanceIntake>(
        '/finance/intakes',
        {
          purpose: tab,
          fileName: file.name,
          size: file.size,
          sha256,
          ...(tab === 'receipt' ? { destinationDepartmentId: department } : {}),
        },
        'POST',
        (r) => setIntake(r.id),
      );
      setFile(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const jobLabel = (j: ListedReceiptJob) =>
    [
      j.sourceKind === 'intake'
        ? list.data?.items.find((i) => i.id === j.sourceId)?.fileName || 'Private staged receipt'
        : 'Existing expense receipt',
      w.data?.departments.find((d) => d.id === j.destinationDepartmentId)?.name,
      j.createdAt && 'requested ' + assistTime(j.createdAt),
      j.status.replaceAll('_', ' '),
    ]
      .filter(Boolean)
      .join(' · ');
  if (demo)
    return (
      <section className="panel finance-assist" aria-label="Finance assistance">
        <SectionHeader
          title="Finance assistance"
          subtitle="Receipt extraction, bank statement import, duplicate review and reconciliation."
        />
        <div className="finance-assist-body">
          <div className="finance-notice">
            <p>{demoUnavailableMessage('/finance/')}</p>
          </div>
        </div>
      </section>
    );
  return (
    <section className="panel finance-assist" aria-label="Finance assistance">
      <SectionHeader
        title="Finance assistance"
        subtitle="Manual expense entry remains available. Receipt candidates and statement associations require your review."
      />
      <div className="finance-assist-body">
        <nav className="segmented finance-assist-tabs" aria-label="Finance assistance tools">
          {tools.map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? 'active' : ''}
              aria-pressed={tab === t}
              disabled={!!m.attempt}
              onClick={() => setTab(t)}
            >
              {t === 'receipt'
                ? 'Receipt extraction'
                : t === 'statement'
                  ? 'Import bank CSV'
                  : t === 'duplicates'
                    ? 'Duplicate review'
                    : 'Reconciliation'}
            </button>
          ))}
        </nav>
        {!!m.attempt && (
          <p className="finance-assist-status">
            Other tools open after this file reservation is retried or confirmed.
          </p>
        )}
        {(tab === 'receipt' || tab === 'statement') && (
          <>
            <fieldset
              className="plain-fieldset finance-assist-form"
              disabled={!!m.attempt || m.busy}
            >
              <Field
                label={`Choose ${tab === 'receipt' ? 'JPEG, PNG or PDF receipt' : 'UTF-8 bank CSV'}`}
              >
                <input
                  type="file"
                  accept={tab === 'receipt' ? '.jpg,.jpeg,.png,.pdf' : '.csv'}
                  onChange={(e) => setFile(e.target.files?.[0])}
                />
              </Field>
              {tab === 'receipt' && (
                <Field label="Reviewed destination department">
                  <select value={department} onChange={(e) => setDepartment(e.target.value)}>
                    <option value="">Choose department</option>
                    {w.data?.departments
                      .filter((d) => authority || d.id === w.data?.me.departmentId)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
            </fieldset>
            <div className="finance-assist-actions">
              <button
                className="button button-primary"
                disabled={m.busy || (!m.attempt && (!file || (tab === 'receipt' && !department)))}
                aria-busy={m.busy}
                onClick={() => void reserve()}
              >
                {m.attempt ? 'Retry same file reservation' : 'Reserve private file'}
              </button>
            </div>
            {m.attempt && (
              <p className="finance-notice finance-notice-warning">
                Confirmation unavailable. This frozen reservation may already exist. Retry it or
                inspect current private sources.
              </p>
            )}
            <p role="alert" className="finance-assist-error">
              {error || m.error}
            </p>
            <h3 className="finance-assist-heading">Your current private sources</h3>
            <AssistListState
              loading={list.loading}
              error={list.error}
              empty={list.ready && !list.data?.items.length}
              loadingText="Checking your private sources…"
              emptyText="No private files staged. Reserve a file above to start."
              onRetry={() => void list.retry?.()}
            />
            {!!list.data?.items.length && (
              <ul className="finance-assist-list" aria-label="Your current private sources">
                {list.data.items.map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      className={'finance-assist-item' + (intake === i.id ? ' active' : '')}
                      aria-pressed={intake === i.id}
                      onClick={() => {
                        setIntake(i.id);
                        setJob('');
                      }}
                    >
                      {i.fileName || 'Camera reservation'} · {i.state}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {intake && (
              <Intake
                key={intake}
                id={intake}
                onExtracted={setJob}
                onImported={(id) => {
                  setImport(id);
                  setTab('reconciliation');
                }}
              />
            )}
            <h3 className="finance-assist-heading">Your extraction requests</h3>
            <AssistListState
              loading={jobs.loading}
              error={jobs.error}
              empty={jobs.ready && !jobs.data?.items.length}
              loadingText="Checking your extraction requests…"
              emptyText="No extraction requests yet. Extract a clean staged receipt to create one."
              onRetry={() => void jobs.retry?.()}
            />
            {!!jobs.data?.items.length && (
              <ul className="finance-assist-list" aria-label="Your extraction requests">
                {jobs.data.items.map((j) => (
                  <li key={j.id}>
                    <button
                      type="button"
                      className={'finance-assist-item' + (job === j.id ? ' active' : '')}
                      aria-pressed={job === j.id}
                      onClick={() => setJob(j.id)}
                    >
                      {jobLabel(j)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {job && <ReceiptExtractionReview key={job} jobId={job} onCreated={onCreated} />}
          </>
        )}
        {tab === 'duplicates' && (
          <FinanceDuplicateReview
            initialCandidate={
              new URLSearchParams(window.location.hash.split('?')[1]).get('candidate') ?? ''
            }
          />
        )}
        {authority && tab === 'reconciliation' && (
          <FinanceReconciliation initialImport={importId} />
        )}
      </div>
    </section>
  );
}
