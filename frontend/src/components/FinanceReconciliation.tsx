import { useState } from 'react';
import { useWorkspace } from '../store';
import { useExecutionRead, useExecutionMutation } from '../data/execution';
import { useExecutionInput } from '../data/executionInput';
import {
  formatExactMoney,
  type ReconciliationRead,
  type StatementImport,
  type ReconciliationHistory,
} from '../data/financeAssistance';
function RowReview({
  item,
  expenses,
  onChanged,
}: {
  item: ReconciliationRead['items'][number];
  expenses: ReconciliationRead['unallocatedExpenses'];
  onChanged: () => void;
}) {
  const [reason, setReason] = useExecutionInput('$bank-row:' + item.row.id, 'reason', '');
  const [selected, setSelected] = useExecutionInput('$bank-row:' + item.row.id, 'selected', '');
  const m = useExecutionMutation('$bank-row:' + item.row.id, [
    '/finance/statement-imports/' + item.row.importId,
  ]);
  const expense = expenses.find((e) => e.id === selected);
  const [showHistory, setShowHistory] = useState(false);
  const history = useExecutionRead<ReconciliationHistory>(
    '/finance/reconciliation/rows/' + item.row.id + '/history',
    showHistory,
  );
  return (
    <section>
      <p>
        Record {item.row.recordOrdinal} · {item.row.bookedDate} ·{' '}
        {formatExactMoney(item.row.signedAmountMinor, item.row.currency)} · {item.row.reference}
      </p>
      <label>
        Recorded paid expense
        <select
          value={selected}
          disabled={!!m.attempt || m.busy}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Choose deliberately</option>
          {expenses.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title} · {formatExactMoney(e.amountMinor, e.currency)}
            </option>
          ))}
        </select>
      </label>
      {item.suggestions.map((s) => (
        <p key={s.expenseId}>
          {expenses.find((e) => e.id === s.expenseId)?.title ?? 'Recorded paid expense'} ·{' '}
          {s.reason.replaceAll('_', ' ')}
        </p>
      ))}
      <label>
        Accounting review reason
        <input
          value={reason}
          disabled={!!m.attempt || m.busy}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button
        disabled={
          !expense ||
          m.busy ||
          reason.trim().length < 12 ||
          (!!m.attempt && m.attempt.target?.path !== '/finance/reconciliation/matches')
        }
        onClick={() =>
          void m
            .execute(
              '/finance/reconciliation/matches',
              m.attempt?.payload ?? {
                rowId: item.row.id,
                expectedRowVersion: item.row.version,
                expenseId: expense!.id,
                expectedExpenseVersion: expense!.version,
                reason,
              },
            )
            .then(onChanged)
            .catch(() => {})
        }
      >
        Match full recorded payment
      </button>
      <button
        disabled={
          m.busy ||
          reason.trim().length < 12 ||
          (!!m.attempt &&
            m.attempt.target?.path !== '/finance/reconciliation/rows/' + item.row.id + '/dismiss')
        }
        onClick={() =>
          void m
            .execute(
              '/finance/reconciliation/rows/' + item.row.id + '/dismiss',
              m.attempt?.payload ?? {
                expectedRowVersion: item.row.version,
                suggestionBasis: item.suggestionBasis,
                reason,
              },
            )
            .then(onChanged)
            .catch(() => {})
        }
      >
        Record discrepancy / dismiss suggestion
      </button>
      <button onClick={() => setShowHistory(!showHistory)}>
        {showHistory ? 'Close complete history' : 'Review complete association history'}
      </button>
      {history.loading && <p>Checking current history access…</p>}
      {history.error && <p role="alert">{history.error.message}</p>}
      {(showHistory ? (history.data?.items ?? []) : item.history).map((h, i) => (
        <p key={i}>
          {h.action}: {h.reason}
        </p>
      ))}
      {history.data?.allocations.map((a) => (
        <Allocation
          key={a.id}
          allocation={a}
          onChanged={() => {
            void history.retry();
            onChanged();
          }}
        />
      ))}
      {m.error && <p role="alert">{m.error}. Retry the same frozen decision.</p>}
    </section>
  );
}
function Allocation({
  allocation,
  onChanged,
}: {
  allocation: ReconciliationRead['allocations'][number];
  onChanged: () => void;
}) {
  const [reason, setReason] = useExecutionInput('$allocation:' + allocation.id, 'reason', '');
  const m = useExecutionMutation('$unmatch:' + allocation.id);
  return (
    <section>
      <p>
        {allocation.active ? 'Active full association' : 'Reversed association'} ·{' '}
        {allocation.reason}
      </p>
      {allocation.active && (
        <>
          <label>
            Reversal reason
            <input
              value={reason}
              disabled={!!m.attempt || m.busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            disabled={m.busy || reason.trim().length < 12}
            onClick={() =>
              void m
                .execute(
                  '/finance/reconciliation/matches/' + allocation.id + '/unmatch',
                  m.attempt?.payload ?? { expectedVersion: allocation.version, reason },
                )
                .then(onChanged)
                .catch(() => {})
            }
          >
            Unmatch reviewed association
          </button>
        </>
      )}
      {m.error && <p role="alert">{m.error}</p>}
    </section>
  );
}
export default function FinanceReconciliation({ initialImport = '' }: { initialImport?: string }) {
  const w = useWorkspace();
  const [importId, setImport] = useState(
    initialImport || new URLSearchParams(window.location.hash.split('?')[1]).get('import') || '',
  );
  const [state, setState] = useState('all');
  const list = useExecutionRead<{ items: StatementImport[] }>('/finance/statement-imports');
  const q = useExecutionRead<ReconciliationRead>(
    '/finance/reconciliation?state=' + state + '&importId=' + encodeURIComponent(importId),
  );
  const authority = ['founder', 'ceo', 'admin', 'finance'].includes(w.data?.me.role ?? '');
  if (!authority) return null;
  return (
    <section>
      <h3>Statement reconciliation</h3>
      <p>
        Match one exact full negative row to an already recorded paid expense. Credits, partial
        amounts and ambiguous matches remain reviewable. This does not pay or edit expenses.
      </p>
      <label>
        Statement import
        <select value={importId} onChange={(e) => setImport(e.target.value)}>
          <option value="">All authorized imports</option>
          {list.data?.items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.createdAt} · {i.rowCount} records
            </option>
          ))}
        </select>
      </label>
      <label>
        Queue state
        <select value={state} onChange={(e) => setState(e.target.value)}>
          {['all', 'unmatched', 'matched', 'dismissed'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      {q.loading && <p>Checking current bank access…</p>}
      {q.data?.items.map((item) => (
        <RowReview
          key={item.row.id}
          item={item}
          expenses={q.data!.unallocatedExpenses}
          onChanged={() => void q.retry()}
        />
      ))}
      {q.data?.allocations.map((a) => (
        <Allocation key={a.id} allocation={a} onChanged={() => void q.retry()} />
      ))}
      <p role="alert">{q.error?.message}</p>
    </section>
  );
}
