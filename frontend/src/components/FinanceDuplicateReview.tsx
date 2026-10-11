import { useState } from 'react';
import { useExecutionRead, useExecutionMutation } from '../data/execution';
import { useExecutionInput } from '../data/executionInput';
import type { FinanceDuplicate } from '../data/financeAssistance';
import { useWorkspace } from '../store';
function Candidate({ id }: { id: string }) {
  const q = useExecutionRead<FinanceDuplicate>('/finance/duplicate-candidates/' + id);
  const [reason, setReason] = useExecutionInput('$duplicate:' + id, 'reason', '');
  const m = useExecutionMutation('$duplicate-dismiss:' + id, [
    '/finance/duplicate-candidates/' + id,
  ]);
  return (
    <section>
      {q.data && (
        <p>
          {q.data.reason.replaceAll('_', ' ')}. Equal evidence alone does not prove duplicate
          spending.
        </p>
      )}
      <label>
        Reason to dismiss
        <input
          value={reason}
          disabled={!!m.attempt || m.busy}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button
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
      {m.error && <p role="alert">{m.error}. Retry the same frozen decision.</p>}
    </section>
  );
}
export default function FinanceDuplicateReview() {
  const w = useWorkspace();
  const q = useExecutionRead<{ items: FinanceDuplicate[] }>('/finance/duplicate-candidates');
  const [source, setSource] = useExecutionInput('$duplicate-review', 'source', '');
  const [selected, setSelected] = useExecutionInput('$duplicate-review', 'selected', '');
  const m = useExecutionMutation('$duplicate-review');
  const expense = w.data?.expenses.find((e) => e.id === source);
  return (
    <section>
      <h3>Duplicate suggestions</h3>
      <p>
        Suggestions never waive the exact vendor and nonblank invoice rule. Dismissals do not merge,
        void or pay records.
      </p>
      <label>
        Expense to compare
        <select
          disabled={!!m.attempt || m.busy}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">Choose an authorized expense</option>
          {w.data?.expenses.map((e) => (
            <option key={e.id} value={e.id}>
              {e.code} · {e.title}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={!expense || m.busy}
        onClick={() =>
          void m
            .execute(
              '/finance/duplicate-candidates/review',
              m.attempt?.payload ?? {
                sourceKind: 'expense',
                sourceId: expense!.id,
                expectedVersion: expense!.version,
              },
            )
            .then(() => q.retry())
            .catch(() => {})
        }
      >
        Review duplicate suggestions
      </button>
      {q.loading && <p>Checking current pair access…</p>}
      {q.data?.items.map((c) => (
        <button key={c.id} onClick={() => setSelected(c.id)}>
          {w.data?.expenses.find((e) => e.id === c.sourceId)?.title ?? 'Reviewed extraction'} ·{' '}
          {w.data?.expenses.find((e) => e.id === c.comparedExpenseId)?.title ?? 'Expense'} ·{' '}
          {c.reason.replaceAll('_', ' ')}
        </button>
      ))}
      {selected && <Candidate key={selected} id={selected} />}
      <p role="alert">{m.error || q.error?.message}</p>
    </section>
  );
}
