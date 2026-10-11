import { useState } from 'react';
import { useWorkspace } from '../store';
import { useExecutionRead, useExecutionMutation } from '../data/execution';
import { useExecutionInput } from '../data/executionInput';
import {
  blankStatementMapping,
  statementMapping,
  formatExactMoney,
  type StatementPreview,
  type FinanceIntake,
} from '../data/financeAssistance';
export default function StatementImportReview({
  intakeId,
  onImported,
  intake,
}: {
  intakeId: string;
  onImported: (id: string) => void;
  intake?: FinanceIntake;
}) {
  const w = useWorkspace();
  const ownQuery = useExecutionRead<FinanceIntake>('/finance/intakes/' + intakeId, !intake);
  const q = intake ? { data: intake, ready: true, error: null } : ownQuery;
  const [choices, setChoices] = useExecutionInput(
    '$statement-map:' + intakeId,
    'mapping',
    blankStatementMapping,
  );
  const [preview, setPreview] = useExecutionInput('$statement-map:' + intakeId, 'preview', '');
  const [pageCursor, setPageCursor] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useExecutionInput(
    '$statement-map:' + intakeId,
    'duplicateReason',
    '',
  );
  const [error, setError] = useState('');
  const m = useExecutionMutation('$statement-preview:' + intakeId, [
    '/finance/intakes/' + intakeId,
  ]);
  const imported = useExecutionMutation('$statement-import:' + preview, [
    '/finance/statement-previews/' + preview,
  ]);
  const p = useExecutionRead<StatementPreview>(
    '/finance/statement-previews/' + preview + '?cursor=' + encodeURIComponent(pageCursor),
    !!preview,
  );
  const frozen = !!m.attempt || m.busy || !!imported.attempt || imported.busy;
  const set = (key: keyof typeof choices, value: string) => {
    if (frozen) return;
    setChoices((v) => ({ ...v, [key]: value }));
    setConfirmed(false);
    setPreview('');
    setPageCursor('');
  };
  async function prepare() {
    if (imported.attempt || imported.busy) return;
    try {
      await m.execute<{ preview: { id: string } }>(
        '/finance/statement-previews',
        m.attempt?.payload ?? {
          intakeId,
          expectedIntakeVersion: q.data!.version,
          mapping: statementMapping(choices),
        },
        'POST',
        (r) => {
          setPageCursor('');
          setConfirmed(false);
          setPreview(r.preview.id);
        },
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section>
      <h3>Map and review bank CSV</h3>
      <p>
        Choose every mapping explicitly. Debits/outflows are negative. This import records statement
        evidence and never initiates payment.
      </p>
      <fieldset disabled={frozen} style={{ border: 0, padding: 0, minWidth: 0 }}>
        {Object.entries({
          headerRow: ['yes', 'no'],
          delimiter: ['comma', 'semicolon', 'tab'],
          dateFormat: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'],
          amountMode: ['signed', 'debit_credit'],
          decimalSeparator: ['dot', 'comma'],
          groupingSeparator: ['none', 'comma', 'dot', 'space'],
        }).map(([key, values]) => (
          <label key={key}>
            {key}
            <select
              value={choices[key as keyof typeof choices]}
              onChange={(e) => set(key as keyof typeof choices, e.target.value)}
            >
              <option value="">Choose explicitly</option>
              {values.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        ))}
        {(
          [
            'dateColumn',
            ...(choices.amountMode === 'debit_credit'
              ? ['debitColumn', 'creditColumn']
              : ['signedAmountColumn']),
            'referenceColumn',
            'descriptionColumn',
            'currencyColumn',
          ] as (keyof typeof choices)[]
        ).map((key) => (
          <label key={key}>
            {key} (file column number, optional where noted)
            <input
              inputMode="numeric"
              min="1"
              max="32"
              value={choices[key]}
              onChange={(e) => set(key, e.target.value)}
            />
          </label>
        ))}
      </fieldset>
      <button
        disabled={
          !q.ready || q.data?.state !== 'clean' || m.busy || !!imported.attempt || imported.busy
        }
        onClick={() => void prepare()}
      >
        {m.attempt ? 'Retry same mapping preview' : 'Preview exact statement rows'}
      </button>
      {p.loading && <p>Checking current preview access…</p>}
      {p.data && (
        <>
          <p>
            Debit {formatExactMoney(p.data.preview.totals.debit, w.data!.company.currency)} · credit{' '}
            {formatExactMoney(p.data.preview.totals.credit, w.data!.company.currency)} · net{' '}
            {formatExactMoney(p.data.preview.totals.net, w.data!.company.currency)}.{' '}
            {p.data.rowCount} distinct records.
          </p>
          {p.data.preview.errors.slice(0, 100).map((e) => (
            <p key={e.row} role="alert">
              Record {e.row}: {e.message}
            </p>
          ))}
          {p.data.rows.map((r) => (
            <p key={r.recordOrdinal}>
              Record {r.recordOrdinal} · {r.bookedDate} ·{' '}
              {formatExactMoney(r.signedAmountMinor, r.currency)} · {r.reference}
            </p>
          ))}
          {p.data.hasMore && (
            <button onClick={() => setPageCursor(p.data!.nextPageCursor)}>Review next rows</button>
          )}
          {!!pageCursor && <button onClick={() => setPageCursor('')}>First rows</button>}
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!!imported.attempt || imported.busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed the complete mapping and all normalized rows
          </label>
          <label>
            Reason for a deliberate repeated file import (if applicable)
            <input
              value={reason}
              disabled={!!imported.attempt || imported.busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            disabled={
              !p.ready ||
              !q.ready ||
              (!confirmed && !imported.attempt) ||
              p.data.preview.errors.length > 0 ||
              imported.busy
            }
            onClick={() =>
              void imported
                .execute<{ id: string }>(
                  '/finance/statement-previews/' + preview + '/import',
                  imported.attempt?.payload ?? {
                    expectedPreviewRevision: p.data!.preview.revision,
                    ...(reason ? { duplicateReason: reason } : {}),
                  },
                  'POST',
                  (r) => onImported(r.id),
                )
                .catch(() => {})
            }
          >
            {imported.attempt ? 'Retry same statement import' : 'Import reviewed statement'}
          </button>
        </>
      )}
      <p role="alert">
        {error || m.error || imported.error || p.error?.message || q.error?.message}
      </p>
    </section>
  );
}
