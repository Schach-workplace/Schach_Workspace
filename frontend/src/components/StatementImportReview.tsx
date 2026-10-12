import { useState } from 'react';
import { statementLabels } from '../../../shared/finance/labels';
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
import { AssistListState } from './ReceiptExtractionReview';
import { Field } from './UI';
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
    <section className="finance-assist-card" aria-label="Map and review bank CSV">
      <h3>Map and review bank CSV</h3>
      <p className="finance-assist-meta">
        Choose every mapping explicitly. Debits/outflows are negative. This import records statement
        evidence and never initiates payment.
      </p>
      <fieldset disabled={frozen} className="plain-fieldset finance-assist-form">
        {Object.entries({
          headerRow: ['yes', 'no'],
          delimiter: ['comma', 'semicolon', 'tab'],
          dateFormat: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'],
          amountMode: ['signed', 'debit_credit'],
          decimalSeparator: ['dot', 'comma'],
          groupingSeparator: ['none', 'comma', 'dot', 'space'],
        }).map(([key, values]) => (
          <Field key={key} label={statementLabels[key]}>
            <select
              value={choices[key as keyof typeof choices]}
              onChange={(e) => set(key as keyof typeof choices, e.target.value)}
            >
              <option value="">Choose explicitly</option>
              {values.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
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
          <Field
            key={key}
            label={statementLabels[key] + ' (file column number, optional where noted)'}
          >
            <input
              inputMode="numeric"
              min="1"
              max="32"
              value={choices[key]}
              onChange={(e) => set(key, e.target.value)}
            />
          </Field>
        ))}
      </fieldset>
      <div className="finance-assist-actions">
        <button
          className="button button-primary"
          aria-busy={m.busy}
          disabled={
            !q.ready || q.data?.state !== 'clean' || m.busy || !!imported.attempt || imported.busy
          }
          onClick={() => void prepare()}
        >
          {m.attempt ? 'Retry same mapping preview' : 'Preview exact statement rows'}
        </button>
      </div>
      {preview && (
        <AssistListState
          loading={p.loading}
          error={null}
          empty={p.ready && !p.data?.rows.length && !p.data?.preview.errors.length}
          loadingText="Checking current preview access…"
          emptyText="This mapping produced no statement records. Check the header row and column numbers."
        />
      )}
      {p.data && (
        <>
          <p className="finance-assist-row-title">
            Debit {formatExactMoney(p.data.preview.totals.debit, w.data!.company.currency)} · credit{' '}
            {formatExactMoney(p.data.preview.totals.credit, w.data!.company.currency)} · net{' '}
            {formatExactMoney(p.data.preview.totals.net, w.data!.company.currency)}.{' '}
            {p.data.rowCount} distinct records.
          </p>
          {p.data.preview.errors.slice(0, 100).map((e) => (
            <p key={e.row} role="alert" className="finance-assist-error">
              Record {e.row}: {e.message}
            </p>
          ))}
          {p.data.rows.length > 0 && (
            <ul className="finance-assist-suggestions" aria-label="Normalized statement rows">
              {p.data.rows.map((r) => (
                <li key={r.recordOrdinal}>
                  Record {r.recordOrdinal} · {r.bookedDate} ·{' '}
                  {formatExactMoney(r.signedAmountMinor, r.currency)} · {r.reference}
                </li>
              ))}
            </ul>
          )}
          <div className="finance-assist-actions">
            {p.data.hasMore && (
              <button
                className="button button-secondary"
                onClick={() => setPageCursor(p.data!.nextPageCursor)}
              >
                Review next rows
              </button>
            )}
            {!!pageCursor && (
              <button className="button button-secondary" onClick={() => setPageCursor('')}>
                First rows
              </button>
            )}
          </div>
          <label className="check-field finance-assist-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!!imported.attempt || imported.busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed the complete mapping and all normalized rows
          </label>
          <div className="finance-assist-form">
            <Field label="Reason for a deliberate repeated file import (if applicable)">
              <input
                value={reason}
                disabled={!!imported.attempt || imported.busy}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
          <button
            className="button button-primary"
            aria-busy={imported.busy}
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
      <p role="alert" className="finance-assist-error">
        {error || m.error || imported.error || p.error?.message || q.error?.message}
      </p>
    </section>
  );
}
