// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ store: {} as any, reads: [] as string[], preview: 0, imports: [] as any[] }));
vi.mock('../store', () => ({ useWorkspace: () => h.store }));
vi.mock('../data/execution', async (original) => ({
  ...(await original<any>()),
  useExecutionRead: (path: string, enabled = true) => {
    h.reads.push(path);
    if (!enabled) return { ready: false };
    if (path.startsWith('/finance/intakes/')) return { ready: true, data: { id: 'intake', state: 'clean', version: 4 } };
    return { ready: true, data: { preview: { id: path.split('/')[3].split('?')[0], revision: 1, errors: [], totals: { debit: '130050', credit: '0', net: '-130050' } }, rows: [], rowCount: 101, hasMore: !path.includes('cursor=old-page'), nextPageCursor: 'old-page' } };
  },
}));
import StatementImportReview from './StatementImportReview';
afterEach(cleanup);
function setup(company: string) {
  h.preview = 0; h.imports = []; h.reads = [];
  h.store = { mode: 'api', companyId: company, session: { user: { id: 'user' } }, data: { company: { id: company, currency: 'INR' } }, mutate: vi.fn(async (path, payload, _method, committed) => {
    if (path === '/finance/statement-previews') { const result = { preview: { id: company + '-preview-' + ++h.preview } }; committed?.(result); return result; }
    h.imports.push({ path, payload });
    if (h.imports.length === 1) throw new TypeError('Committed import acknowledgement lost');
    const result = { id: company + '-canonical-import' }; committed?.(result); return result;
  }) };
}
async function mapAndPreview() {
  for (const [label, value] of [['headerRow','yes'],['delimiter','comma'],['dateFormat','YYYY-MM-DD'],['amountMode','signed'],['decimalSeparator','dot'],['groupingSeparator','none'],['dateColumn','1'],['signedAmountColumn','2']]) {
    fireEvent.change(screen.getByLabelText(new RegExp('^' + label)), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Preview exact statement rows' }));
  await screen.findByText(/101 distinct records/);
}
it('keeps every mapping/re-preview action frozen with the original unknown import through remount', async () => {
  setup('unknown-import'); const onImported = vi.fn();
  const first = render(<StatementImportReview intakeId="unknown-source" onImported={onImported} />);
  await mapAndPreview();
  fireEvent.click(screen.getByLabelText('I reviewed the complete mapping and all normalized rows'));
  fireEvent.click(screen.getByRole('button', { name: 'Import reviewed statement' }));
  await screen.findByText(/Committed import acknowledgement lost/);
  expect(screen.getByRole('button', { name: 'Preview exact statement rows' }).hasAttribute('disabled')).toBe(true);
  for (const select of screen.getAllByRole('combobox')) expect((select as HTMLSelectElement).disabled || select.closest('fieldset')?.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Preview exact statement rows' }));
  expect(h.preview).toBe(1);
  first.unmount(); render(<StatementImportReview intakeId="unknown-source" onImported={onImported} />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry same statement import' }));
  await vi.waitFor(() => expect(onImported).toHaveBeenCalledWith('unknown-import-canonical-import'));
  expect(h.imports).toHaveLength(2); expect(h.imports[1]).toEqual(h.imports[0]);
});
it('resets a source-bound page cursor when deliberately remapping into a new preview', async () => {
  setup('remap-cursor'); render(<StatementImportReview intakeId="remap-source" onImported={() => {}} />);
  await mapAndPreview();
  fireEvent.click(screen.getByRole('button', { name: 'Review next rows' }));
  expect(h.reads.at(-1)).toContain('cursor=old-page');
  fireEvent.change(screen.getByLabelText('dateFormat'), { target: { value: 'DD/MM/YYYY' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview exact statement rows' }));
  await vi.waitFor(() => expect(h.preview).toBe(2));
  expect(h.reads.at(-1)).toBe('/finance/statement-previews/remap-cursor-preview-2?cursor=');
});
