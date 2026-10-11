import { useState } from 'react';
import { useWorkspace } from '../store';
import { useExecutionInput } from '../data/executionInput';
import { useExecutionRead, useExecutionMutation } from '../data/execution';
import type { Expense } from '../types';
import ReceiptExtractionReview from './ReceiptExtractionReview';
export default function ExpenseReceiptAssistance({
  expenseId,
  receiptId,
}: {
  expenseId: string;
  receiptId: string;
}) {
  const w = useWorkspace();
  const q = useExecutionRead<{ expense: Expense }>('/expenses/' + expenseId);
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
  const current = q.data?.expense;
  const exists = current?.receipts.some((r) => r.id === receiptId);
  return (
    <section>
      {q.ready && exists && (
        <>
          <label>
            Reviewed extraction destination
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
          </label>
          <button
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
          <p>{done}</p>
          <label>
            <input
              type="checkbox"
              checked={optIn}
              disabled={!!extract.attempt || extract.busy}
              onChange={(e) => setOptIn(e.target.checked)}
            />
            Use local extraction and review all candidates
          </label>
          <button
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
      <p role="alert">{assess.error || extract.error || q.error?.message}</p>
    </section>
  );
}
