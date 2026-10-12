import { useState } from 'react';
import { useExecutionRead, useExecutionMutation } from '../data/execution';
import { useExecutionInput } from '../data/executionInput';
import type { FinanceDuplicate } from '../data/financeAssistance';
import { useWorkspace } from '../store';
import { AssistListState } from './ReceiptExtractionReview';
import { Field } from './UI';
function Candidate({ id }: { id: string }) {
  const q = useExecutionRead<FinanceDuplicate>('/finance/duplicate-candidates/' + id);
  const [reason, setReason] = useExecutionInput('$duplicate:' + id, 'reason', '');
  const m = useExecutionMutation('$duplicate-dismiss:' + id, [
    '/finance/duplicate-candidates/' + id,
  ]);
  return (
    <section className="finance-assist-card" aria-label="Selected duplicate suggestion">
      <AssistListState
        loading={q.loading && !q.data}
        error={q.error}
        loadingText="Checking current pair access…"
        emptyText=""
      />
      {q.data && (
        <p>
          {q.data.reason.replaceAll('_', ' ')}. Equal evidence alone does not prove duplicate
          spending.
        </p>
      )}
      <div className="finance-assist-form">
        <Field label="Reason to dismiss">
          <input
            value={reason}
            disabled={!!m.attempt || m.busy}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>
      <p className="finance-assist-status">
        At least 12 characters. Dismissal never merges or pays.
      </p>
      <button
        className="button button-secondary"
        aria-busy={m.busy}
        disabled={!q.ready || m.busy || Array.from(reason.trim()).length < 12}
        onClick={() =>
          void m
            .execute(
              '/finance/duplicate-candidates/' + id + '/dismiss',
              m.attempt?.payload ?? { expectedVersion: q.data!.version, reason },
            )
            .then(() => q.retry())
            .catch(() => {})
        }
      >
        Dismiss reviewed suggestion
      </button>
      {m.error && (
        <p className="finance-assist-error" role="alert">
          {m.error}
          {m.attempt ? '. Retry the same frozen decision.' : ''}
        </p>
      )}
    </section>
  );
}
export default function FinanceDuplicateReview({
  initialCandidate = '',
}: {
  initialCandidate?: string;
}) {
  const w = useWorkspace();
  const q = useExecutionRead<{ items: FinanceDuplicate[] }>('/finance/duplicate-candidates');
  const [source, setSource] = useExecutionInput('$duplicate-review', 'source', '');
  const [selected, setSelected] = useExecutionInput(
    '$duplicate-review',
    'selected',
    initialCandidate,
  );
  const m = useExecutionMutation('$duplicate-review');
  const [comparisonCursor, setComparisonCursor] = useExecutionInput(
    '$duplicate-review',
    'comparisonCursor',
    '',
  );
  const expense = w.data?.expenses.find((e) => e.id === source);
  return (
    <section className="finance-assist-card" aria-label="Duplicate suggestions">
      <h3>Duplicate suggestions</h3>
      <p className="finance-assist-meta">
        Suggestions never waive the exact vendor and nonblank invoice rule. Dismissals do not merge,
        void or pay records.
      </p>
      <div className="finance-assist-form">
        <Field label="Expense to compare">
          <select
            disabled={!!m.attempt || m.busy}
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setComparisonCursor('');
            }}
          >
            <option value="">Choose an authorized expense</option>
            {w.data?.expenses.map((e) => (
              <option key={e.id} value={e.id}>
                {e.code} · {e.title}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="finance-assist-actions">
        <button
          className="button button-primary"
          aria-busy={m.busy}
          disabled={!expense || m.busy}
          onClick={() =>
            void m
              .execute<{ nextComparisonCursor: string }>(
                '/finance/duplicate-candidates/review',
                m.attempt?.payload ?? {
                  sourceKind: 'expense',
                  sourceId: expense!.id,
                  expectedVersion: expense!.version,
                },
                'POST',
                (r) => setComparisonCursor(r.nextComparisonCursor),
              )
              .then(() => q.retry())
              .catch(() => {})
          }
        >
          Review duplicate suggestions
        </button>
        {comparisonCursor && (
          <button
            className="button button-secondary"
            disabled={!expense || m.busy || !!m.attempt}
            onClick={() =>
              void m
                .execute<{ nextComparisonCursor: string }>(
                  '/finance/duplicate-candidates/review',
                  {
                    sourceKind: 'expense',
                    sourceId: expense!.id,
                    expectedVersion: expense!.version,
                    comparisonCursor,
                  },
                  'POST',
                  (r) => setComparisonCursor(r.nextComparisonCursor),
                )
                .then(() => q.retry())
                .catch(() => {})
            }
          >
            Compare next expenses
          </button>
        )}
      </div>
      <p role="alert" className="finance-assist-error">
        {m.error}
      </p>
      <h4 className="finance-assist-heading">Open suggestions</h4>
      <AssistListState
        loading={q.loading}
        error={q.error}
        empty={q.ready && !q.data?.items.length}
        loadingText="Checking current pair access…"
        emptyText="No open duplicate suggestions. Choose an expense and review it to check for possible duplicates."
        onRetry={() => void q.retry?.()}
      />
      {!!q.data?.items.length && (
        <ul className="finance-assist-list" aria-label="Open duplicate suggestions">
          {q.data.items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={'finance-assist-item' + (selected === c.id ? ' active' : '')}
                aria-pressed={selected === c.id}
                onClick={() => setSelected(c.id)}
              >
                {w.data?.expenses.find((e) => e.id === c.sourceId)?.title ?? 'Reviewed extraction'}{' '}
                · {w.data?.expenses.find((e) => e.id === c.comparedExpenseId)?.title ?? 'Expense'} ·{' '}
                {c.reason.replaceAll('_', ' ')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && <Candidate key={selected} id={selected} />}
    </section>
  );
}
