// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import AttentionInbox from './AttentionInbox';
const env = vi.hoisted(() => ({ items: [] as any[], setItems: (_: any[]) => {} }));
vi.mock('../store', () => ({
  useWorkspace: () => ({
    mode: 'api',
    companyId: 'c',
    session: { user: { id: 'u' } },
    data: { company: { id: 'c', timezone: 'UTC' }, me: { id: 'u' } },
  }),
}));
vi.mock('../data/attention', async () => {
  const { useState } = await import('react');
  return {
    attentionDetail: vi.fn(),
    useAttention: () => {
      const [items, setItems] = useState(env.items);
      env.setItems = setItems;
      return {
        ready: true,
        loading: false,
        denied: false,
        foreground: true,
        items,
        retry: vi.fn(),
      };
    },
  };
});
vi.mock('./AttentionSource', () => ({
  default: ({ id }: { id: string }) => <div role="dialog" aria-label={'Source ' + id} />,
}));
const decision = (state: string) => ({
  id: 'd1',
  sourceKind: 'intake',
  sourceId: 's1',
  kind: 'decision',
  state,
  sourceVersion: 1,
  title: 'Approve intake',
  canDecide: true,
  snoozedUntil: null,
  dueAt: null,
  link: '',
});
afterEach(cleanup);
const filter = (label: RegExp) =>
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Decision filter' })).getByRole('button', {
      name: label,
    }),
  );
it('clears the open business decision when the user filters its item out', () => {
  env.items = [decision('open')];
  render(<AttentionInbox decisionsOnly onTask={vi.fn()} onExpense={vi.fn()} />);
  fireEvent.click(screen.getByText('Open business decision'));
  expect(screen.getByRole('dialog', { name: 'Source d1' })).toBeTruthy();
  filter(/^Snoozed/);
  expect(screen.queryByRole('dialog', { name: 'Source d1' })).toBeNull();
  expect(screen.queryByText('Approve intake')).toBeNull();
});
it('keeps the selected decision visible when its state changes underneath the filter', () => {
  env.items = [decision('open')];
  render(<AttentionInbox decisionsOnly onTask={vi.fn()} onExpense={vi.fn()} />);
  filter(/^Awaiting you/);
  fireEvent.click(screen.getByText('Open business decision'));
  act(() => env.setItems([decision('resolved')]));
  expect(screen.getByRole('dialog', { name: 'Source d1' })).toBeTruthy();
  expect(screen.getByText('Approve intake')).toBeTruthy();
});
