import { useExecutionInput } from '../data/executionInput';
import { useBusinessAttempt } from '../data/businessAttempts';
import IntelligenceGeometry from './IntelligenceGeometry';
import { useEffect, useRef, useState } from 'react';
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
import { canonicalSelection } from '../../../shared/intelligence/selection';
export default function IntelligencePanel({
  choices = [],
  initialOperation = 'summary',
  initialJob = '',
}: {
  choices?: IntelligenceChoice[];
  initialOperation?: IntelligenceOperation;
  initialJob?: string;
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
  const [draft, setDraft] = useExecutionInput<number | null>(
    '$intelligence-panel',
    'draft:' + initialJob,
    null,
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState<IntelligenceChoice>();
  const capabilities = useExecutionRead<IntelligenceCapabilities>('/intelligence/capabilities');
  const history = useExecutionRead<{ jobs: IntelligenceJob[] }>('/intelligence/jobs');
  const job = useIntelligence(jobId);
  const enqueue = useExecutionMutation(
    '$intelligence-enqueue',
    selected.map((s) =>
      s.conversationId ? '/conversations/' + s.conversationId : '/tasks/' + (s.parentId || s.id),
    ),
  );
  const scope = w.companyId + ':' + w.session?.user.id + ':' + w.data?.me.memberAccessEpoch;
  const latest = useRef(scope);
  latest.current = scope;
  const revision = useRef(0);
  const live = useRef(true);
  const current = !!w.data && !w.authorizing && document.visibilityState !== 'hidden';
  live.current = current;
  useEffect(() => {
    revision.current++;
    setPreview(undefined);
    setOptIn(false);
  }, [selected, operation, scope]);
  useEffect(() => {
    const hide = () => {
      revision.current++;
      setPreview(undefined);
      setOptIn(false);
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('schach-work-event', hide);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('schach-work-event', hide);
    };
  }, []);
  async function inspect() {
    try {
      setBusy(true);
      setError('');
      const captured = scope;
      const serial = revision.current;
      const p = await executionRead<IntelligencePreview>(
        w.mode,
        w.companyId,
        w.session?.user.id ?? '',
        '/intelligence/selection-preview',
        canonicalSelection({ operation, sources: selected }),
      );
      if (
        latest.current === captured &&
        revision.current === serial &&
        live.current &&
        document.visibilityState !== 'hidden'
      )
        setPreview(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
    if (!preview || !optIn) return;
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
    <section
      className="intelligence-panel"
      style={{
        display: 'grid',
        gap: 12,
        padding: 20,
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        overflowWrap: 'anywhere',
      }}
    >
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
        choices={current ? (transcript ? [...choices, transcript] : choices) : []}
        selected={selected}
        onChange={setSelected}
        disabled={!current || busy}
      />
      <button
        className="button"
        disabled={!current || busy || !selected.length || !capabilities.data?.operations[operation]}
        onClick={() => void inspect()}
      >
        Review selected sources
      </button>
      {current && preview && (
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
                onReview={setDraft}
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
              jobId={jobId}
              index={draft}
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
