import { useState } from 'react';
import { useWorkspace } from '../store';
import { useExecutionInput } from '../data/executionInput';
import { useExecutionMutation, demoUnavailableMessage } from '../data/execution';
import { Field } from './UI';
import type { Expense } from '../types';
import ReceiptExtractionReview from './ReceiptExtractionReview';
export default function ExpenseReceiptAssistance({
  expense,
  receiptId,
}: {
  expense: Expense;
  receiptId: string;
}) {
  const w = useWorkspace();
  const expenseId = expense.id;
  const [job, setJob] = useExecutionInput('$existing-receipt:' + receiptId, 'job', '');
  const [department, setDepartment] = useExecutionInput(
    '$existing-receipt:' + receiptId,
    'destination',
    '',
  );
  const [optIn, setOptIn] = useExecutionInput('$existing-receipt:' + receiptId, 'optIn', false);
  const [done, setDone] = useState('');
  const assess = useExecutionMutation('$receipt-assess:' + receiptId, ['/expenses/' + expenseId]);
  const extract = useExecutionMutation('$receipt-extract:' + receiptId, ['/expenses/' + expenseId]);
  const authority = ['founder', 'ceo', 'admin', 'finance'].includes(w.data?.me.role ?? '');
  const current = expense;
  const exists = current?.receipts.some((r) => r.id === receiptId);
  if (w.mode === 'demo')
    return (
      <p className="finance-assist-status finance-assist-receipt">
        {demoUnavailableMessage('/expense-receipts/')}
      </p>
    );
  return (
    <section className="finance-assist-card finance-assist-receipt" aria-label="Receipt extraction">
      {exists && (
        <>
          <div className="finance-assist-form">
            <Field label="Reviewed extraction destination">
              <select
                disabled={!!extract.attempt || extract.busy}
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                <option value="">Choose department</option>
                {w.data?.departments
                  .filter((d) => authority || d.id === w.data?.me.departmentId)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <button
            className="button button-secondary"
            aria-busy={assess.busy}
            disabled={assess.busy}
            onClick={() =>
              void assess
                .execute(
                  '/expense-receipts/' + receiptId + '/assessment',
                  assess.attempt?.payload ?? { expectedExpenseVersion: current!.version },
                )
                .then(() =>
                  setDone(
                    'Clean assessment requested. Check extraction when the scanner completes.',
                  ),
                )
                .catch(() => {})
            }
          >
            Request clean assessment for extraction
          </button>
          {done && (
            <p className="finance-assist-status" role="status">
              {done}
            </p>
          )}
          <label className="check-field finance-assist-check">
            <input
              type="checkbox"
              checked={optIn}
              disabled={!!extract.attempt || extract.busy}
              onChange={(e) => setOptIn(e.target.checked)}
            />
            Use local extraction and review all candidates
          </label>
          <button
            className="button button-primary"
            aria-busy={extract.busy}
            disabled={!optIn || !department || extract.busy}
            onClick={() =>
              void extract
                .execute<{ id: string }>(
                  '/finance/receipt-extractions',
                  extract.attempt?.payload ?? {
                    source: {
                      kind: 'expense_receipt',
                      id: receiptId,
                      expectedVersion: current!.version,
                    },
                    destinationDepartmentId: department,
                    optIn: true,
                    ...(current!.createdBy === w.data?.me.id &&
                    current!.status === 'draft' &&
                    current!.departmentId === department
                      ? { targetExpenseId: expenseId, expectedTargetVersion: current!.version }
                      : {}),
                  },
                  'POST',
                  (r) => setJob(r.id),
                )
                .catch(() => {})
            }
          >
            {extract.attempt ? 'Retry same extraction' : 'Extract assessed receipt'}
          </button>
        </>
      )}
      {job && (
        <ReceiptExtractionReview
          jobId={job}
          onCreated={(id) => {
            window.location.hash = '#finance?expense=' + encodeURIComponent(id);
          }}
        />
      )}
      <p role="alert" className="finance-assist-error">
        {assess.error || extract.error}
      </p>
    </section>
  );
}
