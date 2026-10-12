import { useExecutionInput } from '../data/executionInput';
import {
  businessAttemptGeneration,
  subscribeAttempts,
  useBusinessAttempt,
} from '../data/businessAttempts';
import IntelligenceGeometry from './IntelligenceGeometry';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useWorkspace } from '../store';
import { executionRead, useExecutionRead, useExecutionMutation } from '../data/execution';
import { useIntelligence } from '../data/useIntelligence';
import type {
  IntelligenceCapabilities,
  IntelligenceJob,
  IntelligenceOperation,
  IntelligencePreview,
  IntelligenceSourceRequest,
} from '../data/intelligence';
import IntelligenceSelection, { type IntelligenceChoice } from './IntelligenceSelection';
import IntelligenceResult from './IntelligenceResult';
import IntelligenceDraftReview from './IntelligenceDraftReview';
import '../styles/shell.css';
import { canonicalSelection } from '../../../shared/intelligence/selection';
export default function IntelligencePanel({
  choices = [],
  initialOperation = 'summary',
  initialJob = '',
  sourceRead,
}: {
  choices?: IntelligenceChoice[];
  initialOperation?: IntelligenceOperation;
  initialJob?: string;
  sourceRead?: { ready: boolean; denied: boolean };
}) {
  const w = useWorkspace();
  const frozen = useBusinessAttempt<Record<string, unknown>>('$intelligence-enqueue');
  const [selected, setSelected] = useState<IntelligenceSourceRequest[]>([]);
  const [operation, setOperation] = useState<IntelligenceOperation>(initialOperation);
  const [preview, setPreview] = useState<IntelligencePreview>();
  const [optIn, setOptIn] = useState(false);
  const [jobId, setJobId] = useExecutionInput(
    '$intelligence-panel',
    'job:' + initialJob,
    initialJob,
  );
  const [draft, setDraft] = useExecutionInput<{
    index: number;
    kind: 'task' | 'expense' | 'intake';
  } | null>('$intelligence-panel', 'draft:' + initialJob, null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState<IntelligenceChoice>();
  const capabilities = useExecutionRead<IntelligenceCapabilities>('/intelligence/capabilities');
  const history = useExecutionRead<{ jobs: IntelligenceJob[] }>('/intelligence/jobs');
  const job = useIntelligence(jobId);
  // Summary GETs issue new handles even for identical facts. Reauthorize the
  // exact human-selected snapshot; only Choose latest may replace its handle.
  const selectedReport = useExecutionRead<IntelligencePreview>(
    '/intelligence/selection-preview',
    !!sourceRead && sourceRead.ready && !sourceRead.denied && selected.length > 0,
    { operation, sources: selected },
  );
  const [expiredProof, setExpiredProof] = useState<string>();
  const proofExpiry = selectedReport.data?.expiresAt;
  useEffect(() => {
    if (!proofExpiry) return;
    const timer = setTimeout(
      () => setExpiredProof(proofExpiry),
      Math.max(0, Date.parse(proofExpiry) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [proofExpiry]);
  const enqueue = useExecutionMutation(
    '$intelligence-enqueue',
    selected.map((s) =>
      s.conversationId ? '/conversations/' + s.conversationId : '/tasks/' + (s.parentId || s.id),
    ),
  );
  const retirement = useSyncExternalStore(subscribeAttempts, businessAttemptGeneration);
  const scope = JSON.stringify([
    w.mode,
    w.companyId,
    w.session?.user.id,
    w.data?.readBasis,
    w.data?.me.memberAccessEpoch,
    retirement,
  ]);
  const latest = useRef(scope);
  latest.current = scope;
  const revision = useRef(0);
  const live = useRef(true);
  const current = !!w.data && !w.authorizing && document.visibilityState !== 'hidden';
  live.current = current;
  const selectionBasis = JSON.stringify([
    selected,
    operation,
    scope,
    current,
    !!sourceRead?.denied,
    !!sourceRead && !!selectedReport.error,
  ]);
  const sourceBinding =
    selectedReport.ready && selectedReport.data
      ? JSON.stringify([selectedReport.data.selectionHash, selectedReport.data.policyVersion])
      : undefined;
  const [previewOwner, setPreviewOwner] = useState({ selectionBasis, sourceBinding });
  if (
    previewOwner.selectionBasis !== selectionBasis ||
    (sourceBinding !== undefined && previewOwner.sourceBinding !== sourceBinding)
  ) {
    setPreviewOwner({ selectionBasis, sourceBinding });
    setPreview(undefined);
    setOptIn(false);
    setBusy(false);
    setError('');
  }
  // A report query may change while an independently authorized original job
  // is running. Withhold fresh choices/consent, keeping its Modal owner alive.
  const reportProofReady =
    !sourceRead ||
    (sourceRead.ready &&
      selectedReport.ready &&
      !!selectedReport.data &&
      selectedReport.data.expiresAt !== expiredProof);
  const reportProofCurrent = () =>
    !sourceRead || (reportProofReady && Date.parse(selectedReport.data!.expiresAt) > Date.now());
  const sourcesCurrent = current && !sourceRead?.denied && reportProofReady;
  const previewCurrent =
    sourcesCurrent &&
    preview &&
    (!sourceRead ||
      (preview.selectionHash === selectedReport.data?.selectionHash &&
        preview.policyVersion === selectedReport.data?.policyVersion));
  const currentChoices =
    current && !sourceRead?.denied && (!sourceRead || sourceRead.ready)
      ? sourceRead && selected.length
        ? sourcesCurrent
          ? selected.map((source) => ({ label: 'Selected report facts', source }))
          : []
        : transcript
          ? [...choices, transcript]
          : choices
      : [];
  function chooseLatestReport() {
    revision.current++;
    setPreview(undefined);
    setOptIn(false);
    setBusy(false);
    setError('');
    setSelected(choices.map((choice) => choice.source));
    void selectedReport.retry();
  }
  useLayoutEffect(() => {
    live.current = current;
    revision.current++;
    return () => {
      live.current = false;
    };
  }, [previewOwner, current]);
  useEffect(() => {
    const hide = () => {
      revision.current++;
      setPreview(undefined);
      setOptIn(false);
      setBusy(false);
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('schach-work-event', hide);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('schach-work-event', hide);
    };
  }, []);
  async function inspect() {
    if (!sourcesCurrent || !reportProofCurrent() || !selected.length) return;
    const captured = scope;
    const serial = revision.current;
    const capturedRetirement = businessAttemptGeneration();
    const owns = () =>
      latest.current === captured &&
      revision.current === serial &&
      live.current &&
      document.visibilityState !== 'hidden' &&
      businessAttemptGeneration() === capturedRetirement;
    try {
      setBusy(true);
      setError('');
      const p = await executionRead<IntelligencePreview>(
        w.mode,
        w.companyId,
        w.session?.user.id ?? '',
        '/intelligence/selection-preview',
        canonicalSelection({ operation, sources: selected }),
      );
      if (owns()) setPreview(p);
    } catch (e) {
      if (owns()) setError((e as Error).message);
    } finally {
      if (owns()) setBusy(false);
    }
  }
  async function generate() {
    if (frozen.attempt?.state === 'unknown') {
      try {
        await enqueue.execute<{ jobId: string }>(
          '/intelligence/jobs',
          frozen.attempt.payload,
          'POST',
          (r) => {
            setJobId(r.jobId);
            setDraft(null);
            setPreview(undefined);
            setOptIn(false);
          },
        );
      } catch (e) {
        setError((e as Error).message);
      }
      return;
    }
    if (!previewCurrent || !reportProofCurrent() || !preview || !optIn) return;
    try {
      await enqueue.execute<{ jobId: string }>(
        '/intelligence/jobs',
        {
          operation,
          sources: selected,
          selectionHash: preview.selectionHash,
          optIn: { accepted: true, policyVersion: preview.policyVersion },
        },
        'POST',
        (r) => {
          setJobId(r.jobId);
          setDraft(null);
          setPreview(undefined);
          setOptIn(false);
        },
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function cancel() {
    try {
      await executionRead(
        w.mode,
        w.companyId,
        w.session?.user.id ?? '',
        '/intelligence/jobs/' + jobId + '/cancel',
        {},
      );
      await job.retry();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const result = job.ready ? job.data : undefined;
  return (
    <section className="intelligence-panel">
      <h2>Local assistance</h2>
      <p>
        {capabilities.data?.notice ??
          'Select sources explicitly. You can continue normal work while local assistance is unavailable.'}
      </p>
      {w.mode === 'demo' && <p>Local inference is unavailable in demo mode. Continue manually.</p>}
      <label>
        Operation
        <select
          value={operation}
          onChange={(e) => setOperation(e.target.value as IntelligenceOperation)}
        >
          <option value="summary">Summarize selected sources</option>
          <option value="transcript">Transcribe selected audio</option>
          <option value="action_draft">Suggest reviewed actions</option>
          <option value="report_explanation">Explain selected facts</option>
        </select>
      </label>
      <IntelligenceSelection
        choices={currentChoices}
        selected={selected}
        onChange={setSelected}
        disabled={!current || busy}
      />
      {sourceRead && selected.length > 0 && (
        <>
          <p>
            {selectedReport.error || (!!proofExpiry && proofExpiry === expiredProof)
              ? 'Selected report facts are unavailable. Choose the latest facts and review again.'
              : 'Your selected report facts stay fixed until you choose the latest facts.'}
          </p>
          <button
            className="button"
            disabled={!current || !sourceRead.ready || sourceRead.denied || !choices.length}
            onClick={chooseLatestReport}
          >
            Choose latest report facts
          </button>
        </>
      )}
      <button
        className="button"
        disabled={
          !sourcesCurrent || busy || !selected.length || !capabilities.data?.operations[operation]
        }
        onClick={() => void inspect()}
      >
        Review selected sources
      </button>
      {previewCurrent && preview && (
        <section>
          <p>{preview.sources.map((s) => s.label).join(' · ')}</p>
          <label style={{ minHeight: 44, display: 'flex', alignItems: 'center' }}>
            <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />I
            agree to process these selected sources with local models.
          </label>
          <button
            className="button"
            disabled={!optIn || enqueue.busy}
            onClick={() => void generate()}
          >
            Generate local result
          </button>
        </section>
      )}
      {frozen.attempt?.state === 'unknown' && (
        <button
          className="button"
          disabled={!current || enqueue.busy}
          onClick={() => void generate()}
        >
          Retry original local request
        </button>
      )}
      {enqueue.error && <p role="alert">{enqueue.error}</p>}
      {jobId && (
        <>
          <p role="status">
            {job.loading
              ? 'Checking current source permissions…'
              : (result?.state ?? 'Result unavailable. Continue manually or retry.')}
          </p>
          <button className="button" onClick={() => void job.retry()}>
            Recheck current result
          </button>
          <button className="button" disabled={!current} onClick={() => void cancel()}>
            Cancel and clear this result
          </button>
          {result?.reasonCode && (
            <p>{result.reasonCode.replaceAll('_', ' ')}. Continue manually or reselect sources.</p>
          )}
          <IntelligenceGeometry visible={result?.state === 'ready' && !!result.result}>
            {result?.state === 'ready' && result.result && (
              <IntelligenceResult
                job={result}
                onReview={(index, kind) => setDraft({ index, kind })}
                onOpenJob={(id) => {
                  setDraft(null);
                  setJobId(id);
                }}
                onTranscript={() => {
                  const source: IntelligenceSourceRequest = {
                    kind: 'transcript',
                    id: result.jobId,
                    selectedFieldSet: 'segments',
                  };
                  setTranscript({ label: 'Selected ready transcript', source });
                  setSelected([source]);
                  setOperation('summary');
                }}
              />
            )}
          </IntelligenceGeometry>
          {draft !== null && (
            <IntelligenceDraftReview
              key={`${jobId}:${draft.kind}:${draft.index}`}
              jobId={jobId}
              index={draft.index}
              kind={draft.kind}
              job={result?.state === 'ready' ? result : undefined}
              current={job.ready}
              denied={!!job.denied || result?.state === 'invalidated'}
            />
          )}
        </>
      )}
      {history.ready && history.data && (
        <details>
          <summary>Your local request history</summary>
          {history.data.jobs.map((j, i) => (
            <button
              className="button"
              key={j.jobId}
              onClick={() => {
                setJobId(j.jobId);
                setDraft(null);
              }}
            >
              {j.operation?.replaceAll('_', ' ') ?? 'Local'} request {i + 1} · {j.state}
            </button>
          ))}
        </details>
      )}
      {error && <p role="alert">{error}</p>}
      <p>Continue manually using the existing conversation, task, finance or report tools.</p>
    </section>
  );
}
