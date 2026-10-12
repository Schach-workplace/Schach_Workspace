import { useState } from 'react';
import { useWorkspace } from '../store';
import { useExecutionRead, useExecutionMutation } from '../data/execution';
import { useExecutionInput } from '../data/executionInput';
import {
  blankFinanceDraft,
  reviewedReceiptIntent,
  type FinanceDuplicate,
  type ReceiptExtraction,
} from '../data/financeAssistance';
import { Field, ErrorMessage } from './UI';
// Shared loading / error / empty line for the finance assistance lists.
export function AssistListState({
  loading,
  error,
  empty,
  loadingText,
  emptyText,
  onRetry,
}: {
  loading?: boolean;
  error?: Error | null;
  empty?: boolean;
  loadingText: string;
  emptyText: string;
  onRetry?: () => void;
}) {
  if (error)
    return (
      <p className="finance-assist-status finance-assist-status-error" role="alert">
        {error.message}{' '}
        {onRetry && (
          <button type="button" className="text-button" onClick={onRetry}>
            Check again
          </button>
        )}
      </p>
    );
  if (loading)
    return (
      <p className="finance-assist-status" role="status">
        {loadingText}
      </p>
    );
  if (empty) return <p className="finance-assist-status">{emptyText}</p>;
  return null;
}
// Accessible-name friendly timestamp; an unparseable value is shown as sent.
export function assistTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
const fieldNames: Record<string, string> = {
  title: 'title',
  vendor: 'vendor',
  invoiceNumber: 'invoice number',
  expenseDate: 'expense date',
  amountText: 'amount',
  currencyText: 'currency',
  description: 'description',
  receiptExceptionReason: 'receipt exception reason',
  currencyMismatch: 'currency mismatch',
};
const fieldName = (key: string) => fieldNames[key] ?? key;
type DuplicatePreview = {
  items: FinanceDuplicate[];
  nextComparisonCursor: string;
  hasMoreComparisons: boolean;
};
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
  // Read-only duplicate preview of the exact reviewed draft. It never blocks,
  // dismisses or creates anything; a changed draft discards it.
  const [duplicateCheck, setDuplicateCheck] = useState<{ review: unknown; cursor: string }>();
  const reviewed = review as
    { expectedResultRevision: number; fields: Record<string, unknown> } | undefined;
  const checking = !!reviewed && duplicateCheck?.review === review && !m.attempt;
  const d = useExecutionRead<DuplicatePreview>(
    '/finance/duplicates/preview',
    checking,
    checking
      ? {
          sourceExtractionId: jobId,
          expectedResultRevision: reviewed!.expectedResultRevision,
          fields: reviewed!.fields,
          ...(duplicateCheck!.cursor ? { comparisonCursor: duplicateCheck!.cursor } : {}),
        }
      : undefined,
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
    <section className="finance-assist-card" aria-label="Review extracted receipt">
      <h3>Review receipt candidates</h3>
      <ErrorMessage error={error || m.error} />
      <AssistListState
        loading={q.loading && !q.data}
        error={q.error}
        loadingText="Checking current source access…"
        emptyText=""
        onRetry={() => void q.retry?.()}
      />
      {q.data && !q.data.result && (
        <>
          <p className="finance-assist-meta">
            {q.data.job.status.replaceAll('_', ' ')}. Manual entry remains available.
          </p>
          <div className="finance-assist-actions">
            <button className="button button-secondary" onClick={() => void q.retry()}>
              Check extraction progress
            </button>
          </div>
        </>
      )}
      {ready && (
        <>
          <p className="finance-assist-meta">
            {q.data!.result!.engine} · {q.data!.result!.engineVersion} · {q.data!.result!.language}.
            Candidates require human review.
          </p>
          {Object.entries(q.data!.result!.candidates.fields).map(([field, values]) => (
            <div key={field} className="finance-assist-candidates">
              <strong>{fieldName(field)}</strong>
              {values.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="button button-secondary button-small"
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
      <fieldset disabled={locked} className="plain-fieldset finance-assist-form">
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
              key === 'amount'
                ? `Reviewed amount (${w.data?.company.currency})`
                : 'Reviewed ' + fieldName(key)
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
              <label key={token} className="check-field finance-assist-check">
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
                I resolved {fieldName(token)}
              </label>
            ))}
            <label className="check-field finance-assist-check">
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
      <div className="finance-assist-actions">
        <button className="button button-secondary" disabled={!ready || locked} onClick={inspect}>
          Review exact draft and evidence audience
        </button>
        {!!review && !m.attempt && (
          <button
            className="button button-secondary"
            aria-pressed={checking}
            disabled={checking && d.loading}
            onClick={() => setDuplicateCheck({ review, cursor: '' })}
          >
            Preview possible duplicates
          </button>
        )}
      </div>
      {checking && (
        <div className="finance-assist-card" aria-label="Possible duplicates">
          <AssistListState
            loading={d.loading}
            error={d.error}
            empty={d.ready && !d.data?.items.length}
            loadingText="Comparing this reviewed draft with expenses you can see…"
            emptyText="No possible duplicates among the expenses you can see. This check is advisory only."
            onRetry={() => void d.retry?.()}
          />
          {!!d.data?.items.length && (
            <ul className="finance-assist-suggestions" aria-label="Possible duplicate expenses">
              {d.data.items.map((c) => (
                <li key={c.comparedExpenseId + c.reason}>
                  Possible duplicate of{' '}
                  {w.data?.expenses.find((e) => e.id === c.comparedExpenseId)?.title ??
                    'an expense you can see'}{' '}
                  · {c.reason.replaceAll('_', ' ')}
                </li>
              ))}
            </ul>
          )}
          {d.data?.hasMoreComparisons && (
            <button
              className="button button-secondary"
              onClick={() => setDuplicateCheck({ review, cursor: d.data!.nextComparisonCursor })}
            >
              Compare next expenses
            </button>
          )}
          <p className="finance-assist-status">
            Equal evidence alone does not prove duplicate spending. Nothing is merged, rejected or
            paid.
          </p>
        </div>
      )}
      {p.ready && (
        <>
          <p className="finance-assist-meta">{p.data!.evidenceNotice}</p>
          <p className="finance-assist-meta">
            Current finance audience:{' '}
            {p
              .data!.audienceUserIds.map(
                (id) =>
                  w.data?.people.find((p) => p.id === id)?.name ?? 'Current authorized member',
              )
              .join(', ')}
          </p>
          <label className="check-field finance-assist-check">
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
        <p role="alert" className="finance-notice finance-notice-warning">
          Result unknown. Retry the same frozen review; prior work may already exist.
        </p>
      )}
      <button
        className="button button-primary"
        aria-busy={m.busy}
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
