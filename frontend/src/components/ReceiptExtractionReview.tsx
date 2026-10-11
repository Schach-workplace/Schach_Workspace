import { useState } from 'react';
import { useWorkspace } from '../store';
import { useExecutionRead, useExecutionMutation } from '../data/execution';
import { useExecutionInput } from '../data/executionInput';
import {
  blankFinanceDraft,
  reviewedReceiptIntent,
  type ReceiptExtraction,
} from '../data/financeAssistance';
import { Field, ErrorMessage } from './UI';
export default function ReceiptExtractionReview({
  jobId,
  onCreated,
}: {
  jobId: string;
  onCreated: (id: string) => void;
}) {
  const w = useWorkspace();
  const path = '/finance/receipt-extractions/' + jobId;
  const q = useExecutionRead<ReceiptExtraction>(path);
  const [draft, setDraft] = useExecutionInput(
    '$receipt-review:' + jobId,
    'fields',
    blankFinanceDraft,
  );
  const [confirmed, setConfirmed] = useExecutionInput<string[]>(
    '$receipt-review:' + jobId,
    'uncertainties',
    [],
  );
  const [copy, setCopy] = useExecutionInput('$receipt-review:' + jobId, 'copyEvidence', false);
  const [audienceConfirmed, setAudience] = useExecutionInput(
    '$receipt-review:' + jobId,
    'audience',
    false,
  );
  const [review, setReview] = useState<unknown>();
  const [error, setError] = useState('');
  const m = useExecutionMutation('$receipt-accept:' + jobId, [path]);
  const p = useExecutionRead<{ audienceUserIds: string[]; evidenceNotice: string }>(
    path + '/accept-preview',
    !!review || !!m.attempt,
    m.attempt?.payload ?? review,
  );
  const ready = q.ready && !!q.data?.result;
  const locked = !!m.attempt || m.busy;
  const change = (key: keyof typeof draft, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setReview(undefined);
    setAudience(false);
  };
  function inspect() {
    try {
      if (q.data) {
        setReview(reviewedReceiptIntent(q.data, draft, copy, confirmed));
        setError('');
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function accept() {
    if (!ready || (!m.attempt && (!p.ready || !audienceConfirmed))) return;
    try {
      await m.execute<{ id: string }>(
        path + '/accept',
        (m.attempt?.payload ?? review) as Record<string, unknown>,
        'POST',
        (r) => onCreated(r.id),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section aria-label="Review extracted receipt">
      <h3>Review receipt candidates</h3>
      <ErrorMessage error={error || m.error} />
      {q.loading && <p>Checking current source access…</p>}
      {q.error && <p role="alert">{q.error.message}</p>}
      {q.data && !q.data.result && (
        <>
          <p>{q.data.job.status}. Manual entry remains available.</p>
          <button onClick={() => void q.retry()}>Check extraction progress</button>
        </>
      )}
      {ready && (
        <>
          <p>
            {q.data!.result!.engine} · {q.data!.result!.engineVersion} · {q.data!.result!.language}.
            Candidates require human review.
          </p>
          {Object.entries(q.data!.result!.candidates.fields).map(([field, values]) => (
            <div key={field}>
              <strong>{field}</strong>
              {values.map((value) => (
                <button
                  key={value}
                  disabled={locked}
                  onClick={() => {
                    const key = field === 'amountText' ? 'amount' : field;
                    if (key in draft) change(key as keyof typeof draft, value);
                  }}
                >
                  {value}
                </button>
              ))}
            </div>
          ))}
        </>
      )}
      <fieldset disabled={locked} style={{ border: 0, padding: 0, minWidth: 0 }}>
        {(
          [
            'title',
            'vendor',
            'invoiceNumber',
            'expenseDate',
            'amount',
            'description',
            'receiptExceptionReason',
          ] as const
        ).map((key) => (
          <Field
            key={key}
            label={
              key === 'amount' ? `Reviewed amount (${w.data?.company.currency})` : 'Reviewed ' + key
            }
          >
            <input value={draft[key]} onChange={(e) => change(key, e.target.value)} />
          </Field>
        ))}
        {ready && (
          <>
            <Field label="Reviewed destination department">
              <select
                value={draft.departmentId}
                onChange={(e) => change('departmentId', e.target.value)}
              >
                <option value="">Choose destination</option>
                {w.data?.departments
                  .filter((d) => d.id === q.data!.job.destinationDepartmentId)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Reviewed category">
              <select
                value={draft.categoryId}
                onChange={(e) => change('categoryId', e.target.value)}
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
            </Field>
            <Field label="Reviewed linked project">
              <select value={draft.projectId} onChange={(e) => change('projectId', e.target.value)}>
                <option value="">No project</option>
                {w.data?.projects
                  .filter((p) => p.departmentId === draft.departmentId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Reviewed linked task">
              <select value={draft.taskId} onChange={(e) => change('taskId', e.target.value)}>
                <option value="">No task</option>
                {w.data?.tasks
                  .filter(
                    (t) =>
                      t.departmentId === draft.departmentId &&
                      (!draft.projectId || t.projectId === draft.projectId),
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
              </select>
            </Field>
            {q.data!.result!.candidates.unresolved.map((token) => (
              <label key={token}>
                <input
                  type="checkbox"
                  checked={confirmed.includes(token)}
                  onChange={(e) => {
                    setConfirmed(
                      e.target.checked
                        ? [...confirmed, token]
                        : confirmed.filter((t) => t !== token),
                    );
                    setReview(undefined);
                  }}
                />
                I resolved {token}
              </label>
            ))}
            <label>
              <input
                type="checkbox"
                checked={copy}
                onChange={(e) => {
                  setCopy(e.target.checked);
                  setReview(undefined);
                }}
              />
              Publish a separately retained copy of this receipt to finance
            </label>
          </>
        )}
      </fieldset>
      <button disabled={!ready || locked} onClick={inspect}>
        Review exact draft and evidence audience
      </button>
      {p.ready && (
        <>
          <p>{p.data!.evidenceNotice}</p>
          <p>
            Current finance audience:{' '}
            {p
              .data!.audienceUserIds.map(
                (id) =>
                  w.data?.people.find((p) => p.id === id)?.name ?? 'Current authorized member',
              )
              .join(', ')}
          </p>
          <label>
            <input
              type="checkbox"
              checked={audienceConfirmed}
              onChange={(e) => setAudience(e.target.checked)}
            />
            I confirm this reviewed draft and evidence audience
          </label>
        </>
      )}
      {m.attempt && (
        <p role="alert">
          Result unknown. Retry the same frozen review; prior work may already exist.
        </p>
      )}
      <button
        disabled={!ready || (!m.attempt && (!p.ready || !audienceConfirmed)) || m.busy}
        onClick={() => void accept()}
      >
        {m.attempt
          ? 'Retry same reviewed draft'
          : q.data?.job.targetExpenseId
            ? 'Update reviewed draft'
            : 'Create reviewed draft'}
      </button>
    </section>
  );
}
