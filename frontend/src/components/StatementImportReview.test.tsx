// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as React from 'react';
const h = vi.hoisted(() => ({ execute: vi.fn().mockResolvedValue({}) }));
vi.mock('../store', () => ({ useWorkspace: () => ({ data: { company: { currency: 'USD' } } }) }));
vi.mock('../data/execution', () => ({
  useExecutionRead: (_path: string, enabled = true) =>
    enabled
      ? { ready: true, data: { id: 'intake', purpose: 'statement', state: 'clean', version: 4 } }
      : { ready: false },
  useExecutionMutation: () => ({ execute: h.execute, error: '', busy: false }),
}));
vi.mock('../data/executionInput', () => ({
  useExecutionInput: (_f: string, _k: string, v: any) =>
    React.useState(typeof v === 'function' ? v() : v),
}));
import StatementImportReview from './StatementImportReview';
afterEach(cleanup);
it('does not guess bank mapping or permit an import from unreviewed defaults', async () => {
  render(<StatementImportReview intakeId="intake" onImported={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Import reviewed statement' })).toBeNull();
  for (const select of screen.getAllByRole('combobox'))
    expect((select as HTMLSelectElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Preview exact statement rows' }));
  await screen.findByText(/Explicitly choose/);
  expect(h.execute).not.toHaveBeenCalled();
});
