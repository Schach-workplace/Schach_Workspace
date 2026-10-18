import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../store';
import { executionRead, useExecutionRead } from '../data/execution';
import { Modal, downloadText } from './UI';
import { expenseCsv, type ExpenseExportRow } from '../../../shared/integrations/expenseCsv';
type Source = { id: string; version: number; title: string };
const path = '/finance/expense-export';
export default function ExpenseExportButton({ expenses }: { expenses: Source[] }) {
  const w = useWorkspace(),
    [open, setOpen] = useState(false);
  const scope = JSON.stringify([w.companyId, w.session?.user.id, w.data?.readBasis, expenses]);
  return (
    <>
      <button
        className="button button-secondary"
        disabled={w.mode === 'demo' || !expenses.length || w.authorizing}
        onClick={() => setOpen(true)}
      >
        Reviewed accounting CSV
      </button>
      {open && <Export key={scope} expenses={expenses} onClose={() => setOpen(false)} />}
    </>
  );
}
function Export({ expenses, onClose }: { expenses: Source[]; onClose: () => void }) {
  const w = useWorkspace();
  const [selected, setSelected] = useState(() => expenses.slice(0, 100).map((e) => e.id));
  const [page, setPage] = useState(0),
    [stage, setStage] = useState<'select' | 'review'>('select');
  const [consent, setConsent] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [blocked, setBlocked] = useState(false);
  const input = {
    expenses: expenses
      .filter((e) => selected.includes(e.id))
      .map((e) => ({ id: e.id, expectedVersion: e.version })),
  };
  const q = useExecutionRead<{ rows: ExpenseExportRow[] }>(path, stage === 'review', input);
  const owner = JSON.stringify([
    w.companyId,
    w.session?.user.id,
    w.data?.readBasis,
    w.authorizing,
    input,
  ]);
  const current = useRef(owner),
    alive = useRef(true),
    pending = useRef(false),
    generation = useRef(0);
  current.current = owner;
  useEffect(() => {
    alive.current = true;
    const hidden = () => {
      if (document.visibilityState === 'hidden') {
        generation.current++;
        setConsent('');
        setBusy(false);
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      alive.current = false;
      generation.current++;
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  const ready = q.ready && !!q.data && !blocked && !w.authorizing;
  const basis = ready ? JSON.stringify(q.data!.rows) : '';
  useEffect(() => {
    setConsent('');
  }, [basis]);
  function matches(rows: ExpenseExportRow[]) {
    return (
      rows.length === input.expenses.length &&
      new Set(rows.map((r) => r.id)).size === rows.length &&
      input.expenses.every((e) =>
        rows.some((r) => r.id === e.id && r.version === e.expectedVersion),
      )
    );
  }
  async function download() {
    if (
      pending.current ||
      !ready ||
      !basis ||
      consent !== basis ||
      !w.data ||
      document.visibilityState === 'hidden'
    )
      return;
    pending.current = true;
    setBusy(true);
    setError('');
    const captured = owner,
      epoch = generation.current;
    const valid = () =>
      alive.current &&
      current.current === captured &&
      generation.current === epoch &&
      document.visibilityState !== 'hidden';
    try {
      const fresh = await executionRead<{ rows: ExpenseExportRow[] }>(
        'api',
        w.companyId ?? w.data.company.id,
        w.session?.user.id ?? w.data.me.id,
        path,
        input,
      );
      if (!valid()) return;
      if (!matches(fresh.rows) || JSON.stringify(fresh.rows) !== basis)
        throw Error(
          'Expenses changed. Close this export and reselect expenses from refreshed data.',
        );
      downloadText('workspace-expenses.csv', expenseCsv(fresh.rows), 'text/csv;charset=utf-8');
      onClose();
    } catch (e) {
      if (valid()) {
        setConsent('');
        setBlocked(true);
        setError(
          `${(e as Error).message} Close this export and reselect expenses from refreshed data.`,
        );
      }
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="Reviewed accounting CSV"
      onClose={() => {
        if (!pending.current) onClose();
      }}
    >
      <div className="development-form">
        <p>
          Independent external copies can be shared and cannot be revoked. This file includes only
          expense code, title, date, currency, exact amount in minor units and status.
        </p>
        {stage === 'select' ? (
          <>
            {expenses.length > 100 && (
              <p>
                First 100 of {expenses.length} expenses selected. Select at most 100 per export.
              </p>
            )}
            <p>{selected.length} selected</p>
            <button onClick={() => setSelected([])}>Clear selection</button>
            {expenses.slice(page * 100, (page + 1) * 100).map((e) => (
              <label className="development-check" key={e.id}>
                <input
                  type="checkbox"
                  aria-label={`Select ${e.title}`}
                  checked={selected.includes(e.id)}
                  disabled={!selected.includes(e.id) && selected.length >= 100}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, e.id]
                        : selected.filter((id) => id !== e.id),
                    )
                  }
                />
                {e.title}
              </label>
            ))}
            <button disabled={!page} onClick={() => setPage(page - 1)}>
              Previous expenses
            </button>
            <span>
              Page {page + 1} of {Math.ceil(expenses.length / 100)}
            </span>
            <button
              disabled={(page + 1) * 100 >= expenses.length}
              onClick={() => setPage(page + 1)}
            >
              Next expenses
            </button>
            <button
              disabled={!selected.length}
              onClick={() => {
                setConsent('');
                setStage('review');
              }}
            >
              Preview accounting CSV
            </button>
          </>
        ) : !ready ? (
          <p role="status">
            {q.error?.message ||
              (blocked
                ? 'Close this export and reselect expenses from refreshed data.'
                : 'Checking current expense access…')}
          </p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  {['Code', 'Title', 'Date', 'Currency', 'Amount (minor units)', 'Status'].map(
                    (x) => (
                      <th key={x}>{x}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {q.data!.rows.map((r) => (
                  <tr key={r.id}>
                    {[r.code, r.title, r.expenseDate, r.currency, r.amountMinor, r.status].map(
                      (v, i) => (
                        <td key={i}>{v}</td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <label className="development-check">
              <input
                type="checkbox"
                disabled={busy}
                checked={consent === basis}
                onChange={(e) => setConsent(e.target.checked ? basis : '')}
              />
              I reviewed these fields and accept the external copy
            </label>
            <button
              disabled={busy || consent !== basis || !matches(q.data!.rows)}
              onClick={() => void download()}
            >
              Download accounting CSV
            </button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
