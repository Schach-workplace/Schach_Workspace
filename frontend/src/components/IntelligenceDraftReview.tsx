import { useEffect, useRef, useState } from 'react';
import type { IntelligenceJob } from '../data/intelligence';
import { useWorkspace } from '../store';
import { useExecutionInput, clearExecutionForm } from '../data/executionInput';
import { executionRead, useExecutionMutation, useExecutionRead } from '../data/execution';
import { useBusinessAttempt, clearAttemptScope } from '../data/businessAttempts';
import {
  emptyIntelligenceAuthored,
  intelligenceReviewRequest,
  intelligencePublicationOperation,
  type IntelligenceAuthored,
} from '../../../shared/intelligence/publication';
export default function IntelligenceDraftReview({
  jobId,
  index,
  job,
  denied,
  current: authorized,
}: {
  jobId: string;
  index: number;
  job?: IntelligenceJob;
  denied: boolean;
  current: boolean;
}) {
  const w = useWorkspace();
  const form = '$intelligence-review:' + jobId + ':' + index;
  const [authored, setAuthored] = useExecutionInput<IntelligenceAuthored>(
    form,
    'authored',
    emptyIntelligenceAuthored,
  );
  const candidate =
    job?.result?.operation === 'action_draft' ? job.result.candidates[index] : undefined;
  const mutation = useExecutionMutation(form, ['/intelligence/jobs/' + jobId]);
  const frozen = useBusinessAttempt<Record<string, unknown>>(form);
  const unknown = frozen.attempt?.state === 'unknown';
  const proof = useExecutionRead<{ current: boolean; committed: boolean }>(
    '/intelligence/jobs/' + jobId + '/publication-access',
    unknown,
    {
      intelligenceBasis: frozen.attempt?.payload?.intelligenceBasis,
      retryKey: frozen.attempt?.retryKey,
      operation: intelligencePublicationOperation(frozen.attempt?.target?.path),
    },
  );
  const sourceDenied = unknown ? !!proof.denied : denied;
  const canConfirm = unknown ? proof.ready && !!proof.data?.current : authorized && !denied;
  useEffect(() => {
    if (!unknown) return;
    const timer = setInterval(() => void proof.retry(), 5000);
    return () => clearInterval(timer);
  }, [unknown, proof.retry]);
  const [preview, setPreview] = useState<{
    audienceUserIds: string[];
    notice: string;
    intelligenceReviewHash: string;
  }>();
  const [ack, setAck] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const scope = w.companyId + ':' + w.session?.user.id;
  const current = useRef(scope);
  current.current = scope;
  const revision = useRef(0);
  const lastJob = useRef(job);
  if (lastJob.current !== job) {
    lastJob.current = job;
    revision.current++;
  }
  useEffect(() => {
    setPreview(undefined);
    setAck(false);
  }, [job]);
  useEffect(() => {
    if (sourceDenied) {
      clearAttemptScope(frozen.scope);
      revision.current++;
      clearExecutionForm(w.companyId, w.session?.user.id ?? '', form);
      setPreview(undefined);
      setAck(false);
    }
  }, [sourceDenied, form, scope]);
  const write = (key: keyof IntelligenceAuthored, value: string) => {
    revision.current++;
    setAuthored({ ...authored, [key]: value });
    setPreview(undefined);
    setAck(false);
  };
  const resolved = {
    ...authored,
    title: authored.title || candidate?.title || '',
    description: authored.description || candidate?.description || '',
  };
  async function review() {
    if (!job || !candidate) return;
    try {
      const plan = intelligenceReviewRequest(job, candidate, resolved);
      const body = plan.previewPath.endsWith('/task-preview')
        ? plan.previewPayload
        : { ...plan.previewPayload, retryKey: 'intelligence-review' };
      const captured = scope;
      const serial = revision.current;
      const p = await executionRead<typeof preview>(
        w.mode,
        w.companyId,
        w.session?.user.id ?? '',
        plan.previewPath,
        body,
      );
      if (current.current === captured && revision.current === serial) setPreview(p);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function confirm() {
    if (!canConfirm) return;
    try {
      if (frozen.attempt?.state === 'unknown' && frozen.attempt.target) {
        await mutation.execute<{ id: string }>(
          frozen.attempt.target.path,
          frozen.attempt.payload,
          'POST',
          (r) => setSuccess(r.id),
        );
        return;
      }
      if (!job || !candidate || !preview || !ack) return;
      const plan = intelligenceReviewRequest(
        job,
        candidate,
        resolved,
        preview.intelligenceReviewHash,
      );
      await mutation.execute<{ id: string }>(plan.path, plan.payload, 'POST', (r) =>
        setSuccess(r.id),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const pending = !job;
  return (
    <section
      aria-label="Review intelligence draft"
      style={{ display: 'grid', gap: 12, minWidth: 0 }}
    >
      <h3>Review selected draft</h3>
      {pending && <p role="status">Checking current sources. Authored fields remain here.</p>}
      {success ? (
        <p role="status">Created work successfully.</p>
      ) : (
        <>
          <label>
            Reviewed title
            <input
              aria-label="Reviewed intelligence title"
              value={resolved.title}
              onChange={(e) => write('title', e.target.value)}
            />
          </label>
          <label>
            Reviewed description
            <textarea
              aria-label="Reviewed intelligence description"
              value={resolved.description}
              onChange={(e) => write('description', e.target.value)}
            />
          </label>
          {(['ownerId', 'reviewerId'] as const).map((key) => (
            <label key={key}>
              {key === 'ownerId' ? 'Owner' : 'Independent reviewer'}
              <select
                aria-label={key === 'ownerId' ? 'Intelligence owner' : 'Intelligence reviewer'}
                value={authored[key]}
                onChange={(e) => write(key, e.target.value)}
              >
                <option value="">Choose explicitly</option>
                {job &&
                  w.data?.people
                    .filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
              </select>
            </label>
          ))}
          <label>
            Deadline
            <input
              aria-label="Intelligence deadline"
              type="date"
              value={authored.dueDate}
              onChange={(e) => write('dueDate', e.target.value)}
            />
          </label>
          <label>
            Department
            <select
              value={authored.departmentId}
              onChange={(e) => write('departmentId', e.target.value)}
            >
              <option value="">Choose department</option>
              {job &&
                w.data?.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </label>
          {candidate?.kind === 'expense' && (
            <>
              <label>
                Category
                <select
                  value={authored.categoryId}
                  onChange={(e) => write('categoryId', e.target.value)}
                >
                  <option value="">Choose category</option>
                  {w.data?.expenseCategories
                    .filter((c) => c.active)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              {(['vendor', 'amount', 'currency', 'expenseDate'] as const).map((key) => (
                <label key={key}>
                  {key}
                  <input
                    value={authored[key]}
                    type={key === 'expenseDate' ? 'date' : 'text'}
                    onChange={(e) => write(key, e.target.value)}
                  />
                </label>
              ))}
            </>
          )}
          <button
            className="button"
            disabled={pending || mutation.busy || !!frozen.attempt}
            onClick={() => void review()}
          >
            Preview content and audience
          </button>
          {job && preview && (
            <>
              <p>{preview.notice}</p>
              <p>
                {preview.audienceUserIds
                  .map(
                    (id) =>
                      w.data?.people.find((p) => p.id === id)?.name ?? 'Current audience member',
                  )
                  .join(', ')}
              </p>
              <label>
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I
                reviewed these fields and this audience.
              </label>
            </>
          )}
          <button
            className="button"
            disabled={
              mutation.busy || !canConfirm || (!frozen.attempt && (pending || !preview || !ack))
            }
            onClick={() => void confirm()}
          >
            {frozen.attempt ? 'Retry original submitted draft' : 'Confirm reviewed creation'}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
