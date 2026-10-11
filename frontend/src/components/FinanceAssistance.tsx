import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../store';
import { useExecutionInput } from '../data/executionInput';
import { useExecutionRead, useExecutionMutation } from '../data/execution';
import {
  financeFileHash,
  uploadFinanceFile,
  type FinanceIntake,
  type ReceiptJob,
} from '../data/financeAssistance';
import ReceiptExtractionReview from './ReceiptExtractionReview';
import FinanceDuplicateReview from './FinanceDuplicateReview';
import StatementImportReview from './StatementImportReview';
import FinanceReconciliation from './FinanceReconciliation';

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
  const extract = useExecutionMutation('$intake-extract:' + id, [path]);
  const [file, setFile] = useState<File>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
  return (
    <section>
      <h3>Private staged {q.data?.purpose ?? 'file'}</h3>
      {q.loading && <p>Checking current owner and source access…</p>}
      {q.data && (
        <>
          <p>
            {q.data.fileName || 'Unbound camera reservation'} · {q.data.state}. Expires{' '}
            {q.data.expiresAt}.
          </p>
          {q.data.state === 'reserved' && (
            <>
              <label>
                Reselect this exact file to stage it
                <input type="file" disabled={busy} onChange={(e) => setFile(e.target.files?.[0])} />
              </label>
              <button disabled={!file || busy} onClick={() => void upload()}>
                Stage exact reserved file
              </button>
            </>
          )}
          {q.data.state === 'uploaded' && (
            <button
              disabled={finalize.busy}
              onClick={() =>
                void finalize
                  .execute(path + '/finalize', { expectedVersion: q.data!.version })
                  .then(() => q.retry())
                  .catch(() => {})
              }
            >
              {finalize.attempt ? 'Retry same clean request' : 'Request clean assessment'}
            </button>
          )}
          {q.data.state === 'scanning' && (
            <button onClick={() => void q.retry()}>Check clean assessment</button>
          )}
          {q.data.state === 'clean' && q.data.purpose === 'receipt' && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={optIn}
                  disabled={!!extract.attempt || extract.busy}
                  onChange={(e) => setOptIn(e.target.checked)}
                />
                Use local receipt extraction; I will review all candidates
              </label>
              <button
                disabled={!optIn || extract.busy}
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
            </>
          )}
          {q.data.state === 'clean' && q.data.purpose === 'statement' && (
            <StatementImportReview intakeId={id} intake={q.data} onImported={onImported} />
          )}
          <button
            disabled={cancel.busy}
            onClick={() =>
              void cancel
                .execute(path + '/cancel', { expectedVersion: q.data!.version })
                .then(() => q.retry())
                .catch(() => {})
            }
          >
            Cancel private intake
          </button>
        </>
      )}
      <p role="alert">
        {error || finalize.error || cancel.error || extract.error || q.error?.message}
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
  const [tab, setTab] = useState(
    new URLSearchParams(window.location.hash.split('?')[1]).get('tool') ?? 'receipt',
  );
  const [intake, setIntake] = useExecutionInput('$finance-assistance', 'intake', initialIntake);
  const [job, setJob] = useExecutionInput('$finance-assistance', 'job', initialJob);
  const [importId, setImport] = useExecutionInput('$finance-assistance', 'import', '');
  const [department, setDepartment] = useExecutionInput('$finance-assistance', 'destination', '');
  const [file, setFile] = useState<File>();
  const [error, setError] = useState('');
  const m = useExecutionMutation('$finance-intake-reserve');
  const list = useExecutionRead<{ items: FinanceIntake[] }>('/finance/intakes');
  const jobs = useExecutionRead<{ items: ReceiptJob[] }>('/finance/receipt-extractions');
  const authority = ['founder', 'ceo', 'admin', 'finance'].includes(w.data?.me.role ?? '');
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
  return (
    <section className="panel" aria-label="Finance assistance">
      <h2>Finance assistance</h2>
      <p>
        Manual expense entry remains available. Receipt candidates and statement associations
        require your review.
      </p>
      <nav aria-label="Finance assistance tools">
        {['receipt', 'duplicates', ...(authority ? ['statement', 'reconciliation'] : [])].map(
          (t) => (
            <button key={t} disabled={!!m.attempt} onClick={() => setTab(t)}>
              {t === 'receipt'
                ? 'Receipt extraction'
                : t === 'statement'
                  ? 'Import bank CSV'
                  : t === 'duplicates'
                    ? 'Duplicate review'
                    : 'Reconciliation'}
            </button>
          ),
        )}
      </nav>
      {(tab === 'receipt' || tab === 'statement') && (
        <>
          <fieldset disabled={!!m.attempt || m.busy}>
            <label>
              Choose {tab === 'receipt' ? 'JPEG, PNG or PDF receipt' : 'UTF-8 bank CSV'}
              <input
                type="file"
                accept={tab === 'receipt' ? '.jpg,.jpeg,.png,.pdf' : '.csv'}
                onChange={(e) => setFile(e.target.files?.[0])}
              />
            </label>
            {tab === 'receipt' && (
              <label>
                Reviewed destination department
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
              </label>
            )}
          </fieldset>
          <button
            disabled={m.busy || (!m.attempt && (!file || (tab === 'receipt' && !department)))}
            onClick={() => void reserve()}
          >
            {m.attempt ? 'Retry same file reservation' : 'Reserve private file'}
          </button>
          {m.attempt && (
            <p>
              Confirmation unavailable. This frozen reservation may already exist. Retry it or
              inspect current private sources.
            </p>
          )}
          <p role="alert">{error || m.error}</p>
          <h3>Your current private sources</h3>
          {list.data?.items.map((i) => (
            <button
              key={i.id}
              onClick={() => {
                setIntake(i.id);
                setJob('');
              }}
            >
              {i.fileName || 'Camera reservation'} · {i.state}
            </button>
          ))}
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
          <h3>Your extraction requests</h3>
          {jobs.data?.items.map((j) => (
            <button key={j.id} onClick={() => setJob(j.id)}>
              {j.status}
            </button>
          ))}
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
      {authority && tab === 'reconciliation' && <FinanceReconciliation initialImport={importId} />}
    </section>
  );
}
