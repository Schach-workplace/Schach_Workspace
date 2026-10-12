import { useState } from 'react';
import { useWorkspace } from '../store';
import { useExecutionRead, useExecutionMutation, downloadFinanceFile } from '../data/execution';
import { AssistListState, assistTime } from './ReceiptExtractionReview';
import { Field } from './UI';
import { useExecutionInput } from '../data/executionInput';
import {
  formatExactMoney,
  type ReconciliationRead,
  type StatementImport,
  type ReconciliationHistory,
  type StatementRow,
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
    <section className="finance-assist-card" aria-label={'Bank record ' + item.row.recordOrdinal}>
      <p className="finance-assist-row-title">
        Record {item.row.recordOrdinal} · {item.row.bookedDate} ·{' '}
        {formatExactMoney(item.row.signedAmountMinor, item.row.currency)} · {item.row.reference}
      </p>
      {item.suggestions.length > 0 && (
        <ul className="finance-assist-suggestions" aria-label="Suggestions to review">
          {item.suggestions.map((s) => (
            <li key={s.expenseId}>
              Suggestion:{' '}
              {expenses.find((e) => e.id === s.expenseId)?.title ?? 'Recorded paid expense'} ·{' '}
              {s.reason.replaceAll('_', ' ')}
            </li>
          ))}
        </ul>
      )}
      <div className="finance-assist-form">
        <Field label="Recorded paid expense">
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
        </Field>
        <Field label="Accounting review reason">
          <input
            value={reason}
            disabled={!!m.attempt || m.busy}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>
      <div className="finance-assist-actions">
        <button
          className="button button-primary"
          aria-busy={m.busy}
          disabled={
            (!m.attempt && (!expense || reason.trim().length < 12)) ||
            m.busy ||
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
          {m.attempt?.target?.path === '/finance/reconciliation/matches'
            ? 'Retry same full payment match'
            : 'Match full recorded payment'}
        </button>
        <button
          className="button button-secondary"
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
        <button
          className="button button-secondary"
          aria-expanded={showHistory}
          onClick={() => setShowHistory(!showHistory)}
        >
          {showHistory ? 'Close complete history' : 'Review complete association history'}
        </button>
      </div>
      {showHistory && (
        <AssistListState
          loading={history.loading}
          error={history.error}
          empty={history.ready && !history.data?.items.length && !history.data?.allocations.length}
          loadingText="Checking current history access…"
          emptyText="No association history for this record yet."
          onRetry={() => void history.retry?.()}
        />
      )}
      {(showHistory ? (history.data?.items ?? []) : item.history).length > 0 && (
        <ul className="finance-assist-suggestions" aria-label="Association history">
          {(showHistory ? (history.data?.items ?? []) : item.history).map((h, i) => (
            <li key={i}>
              {h.action}: {h.reason}
            </li>
          ))}
        </ul>
      )}
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
      {m.error && (
        <p className="finance-assist-error" role="alert">
          {m.error}
          {m.attempt ? '. Retry the same frozen decision.' : ''}
        </p>
      )}
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
    <section className="finance-assist-card" aria-label="Reviewed association">
      <p className="finance-assist-row-title">
        {allocation.active ? 'Active full association' : 'Reversed association'} ·{' '}
        {allocation.reason}
      </p>
      {(allocation.active || !!m.attempt) && (
        <>
          <div className="finance-assist-form">
            <Field label="Reversal reason">
              <input
                value={reason}
                disabled={!!m.attempt || m.busy}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
          <button
            className="button button-secondary"
            aria-busy={m.busy}
            disabled={m.busy || (!m.attempt && reason.trim().length < 12)}
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
            {m.attempt ? 'Retry same association unmatch' : 'Unmatch reviewed association'}
          </button>
        </>
      )}
      {m.error && (
        <p className="finance-assist-error" role="alert">
          {m.error}
        </p>
      )}
    </section>
  );
}
// Imported statement records for one import, read-only, plus its CSV export.
function ImportRows({ importId }: { importId: string }) {
  const w = useWorkspace();
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const rows = useExecutionRead<{ items: StatementRow[] }>(
    '/finance/statement-imports/' + importId + '/rows',
    open,
  );
  async function exportCSV() {
    if (exporting) return;
    setExporting(true);
    setError('');
    try {
      await downloadFinanceFile(
        w.data!.company.id,
        '/finance/statement-imports/' + importId + '/export',
        'statement-' + importId + '.csv',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="finance-assist-card" aria-label="Imported statement records">
      <div className="finance-assist-actions">
        <button
          className="button button-secondary"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Hide imported records' : 'View imported records'}
        </button>
        <button
          className="button button-secondary"
          disabled={exporting}
          aria-busy={exporting}
          onClick={() => void exportCSV()}
        >
          Export imported records (CSV)
        </button>
      </div>
      {open && (
        <>
          <AssistListState
            loading={rows.loading}
            error={rows.error}
            empty={rows.ready && !rows.data?.items.length}
            loadingText="Checking current statement access…"
            emptyText="This import has no records."
            onRetry={() => void rows.retry?.()}
          />
          {!!rows.data?.items.length && (
            <div className="table-scroll">
              <table className="finance-assist-table">
                <caption className="sr-only">Imported statement records</caption>
                <thead>
                  <tr>
                    <th scope="col">Record</th>
                    <th scope="col">Booked</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Reference</th>
                    <th scope="col">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.data.items.map((r) => (
                    <tr key={r.id}>
                      <td>{r.recordOrdinal}</td>
                      <td>{r.bookedDate}</td>
                      <td>{formatExactMoney(r.signedAmountMinor, r.currency)}</td>
                      <td>{r.reference}</td>
                      <td>{r.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {error && (
        <p className="finance-assist-error" role="alert">
          {error}
        </p>
      )}
    </div>
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
    <section className="finance-assist-card" aria-label="Statement reconciliation">
      <h3>Statement reconciliation</h3>
      <p className="finance-assist-meta">
        Match one exact full negative row to an already recorded paid expense. Credits, partial
        amounts and ambiguous matches remain reviewable. This does not pay or edit expenses.
      </p>
      <div className="finance-assist-form">
        <Field label="Statement import">
          <select value={importId} onChange={(e) => setImport(e.target.value)}>
            <option value="">
              {list.loading
                ? 'Checking statement imports…'
                : list.ready && !list.data?.items.length
                  ? 'No statement imports yet'
                  : 'All authorized imports'}
            </option>
            {list.data?.items.map((i) => (
              <option key={i.id} value={i.id}>
                {assistTime(i.createdAt)} · {i.rowCount} records
              </option>
            ))}
          </select>
        </Field>
        <Field label="Queue state">
          <select value={state} onChange={(e) => setState(e.target.value)}>
            {['all', 'unmatched', 'matched', 'dismissed'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
      {list.error && (
        <p className="finance-assist-error" role="alert">
          {list.error.message}
        </p>
      )}
      {importId && <ImportRows key={importId} importId={importId} />}
      <AssistListState
        loading={q.loading}
        error={q.error}
        empty={q.ready && !q.data?.items.length && !q.data?.allocations.length}
        loadingText="Checking current bank access…"
        emptyText="No statement records in this queue. Import a reviewed bank CSV or choose another queue state."
        onRetry={() => void q.retry?.()}
      />
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
    </section>
  );
}
