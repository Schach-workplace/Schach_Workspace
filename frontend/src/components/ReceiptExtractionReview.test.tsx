import { expect, it } from 'vitest';
import { reviewedReceiptIntent, blankFinanceDraft } from '../data/financeAssistance';
it('requires human category/department and uncertainty confirmation before exact acceptance', () => {
  const source = {
    job: {
      id: 'j',
      status: 'ready',
      version: 2,
      sourceKind: 'intake' as const,
      sourceId: 'i',
      sourceVersion: 4,
      destinationDepartmentId: 'd',
    },
    result: {
      id: 'r',
      revision: 1,
      engine: 'tesseract',
      engineVersion: '5',
      language: 'eng',
      candidates: { fields: { amountText: ['1300.50'] }, unresolved: ['title'] },
    },
  };
  const d = blankFinanceDraft();
  expect(() => reviewedReceiptIntent(source, d, true, [])).toThrow();
  Object.assign(d, {
    title: 'Supplies',
    vendor: 'Demo',
    expenseDate: '2026-10-10',
    amount: '1300.50',
    categoryId: 'c',
    departmentId: 'd',
  });
  expect(() => reviewedReceiptIntent(source, d, true, [])).toThrow('Confirm');
  const out = reviewedReceiptIntent(source, d, true, ['title']);
  expect(out.fields.amountMinor).toBe(130050);
  expect(out).not.toHaveProperty('status');
  expect(out).not.toHaveProperty('currency');
  expect(out).not.toHaveProperty('approval');
});
