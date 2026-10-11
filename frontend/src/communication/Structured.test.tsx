// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Structured from './Structured';
vi.mock('../components/IntelligenceLauncher', () => ({ default: () => null }));
afterEach(cleanup);
const held = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const people = [
  { id: 'actor', name: 'Actor', active: true, role: 'member' },
  { id: 'eligible', name: 'Eligible', active: true, role: 'member' },
  { id: 'later', name: 'Joined later', active: true, role: 'member' },
  { id: 'outside', name: 'Outside conversation', active: true, role: 'member' },
  { id: 'viewer', name: 'Conversation viewer', active: true, role: 'member' },
  { id: 'inactive', name: 'Inactive', active: false, role: 'member' },
];
const members = [
  { userId: 'actor', active: true, role: 'member', historyFromSequence: 1 },
  { userId: 'eligible', active: true, role: 'member', historyFromSequence: 1 },
  { userId: 'later', active: true, role: 'member', historyFromSequence: 10 },
  { userId: 'viewer', active: true, role: 'viewer', historyFromSequence: 1 },
];
const props = (
  command = vi.fn().mockResolvedValue({ records: [], responses: [] }),
  publicChannel = false,
): any => ({
  conversation: { id: 'conversation', public: publicChannel, version: 1 },
  source: { id: 'source', conversationId: 'conversation', revision: 2, sequence: 5 },
  members,
  sourceReady: true,
  data: { me: people[0], people, company: { timezone: 'Asia/Kolkata' } },
  command,
  onClose: vi.fn(),
});
it('offers only current source readers in a private conversation and independent non-viewer reviewers', async () => {
  render(<Structured {...props()} />);
  expect(screen.queryByLabelText('Outside conversation')).toBeNull();
  expect(screen.queryByLabelText('Joined later')).toBeNull();
  expect(screen.queryByLabelText('Inactive')).toBeNull();
  expect(screen.getByLabelText('Eligible')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'decision' } });
  const reviewer = screen.getByLabelText('Independent reviewer');
  expect(reviewer.textContent).toContain('Eligible');
  expect(reviewer.textContent).not.toContain('Actor');
  expect(reviewer.textContent).not.toContain('Conversation viewer');
});
it('searches public source readers while public history overrides a later explicit interval', async () => {
  render(<Structured {...props(undefined, true)} />);
  expect(screen.getByLabelText('Outside conversation')).toBeTruthy();
  expect(screen.getByLabelText('Joined later')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search eligible people'), {
    target: { value: 'Eligible' },
  });
  expect(screen.getByLabelText('Eligible')).toBeTruthy();
  expect(screen.queryByLabelText('Outside conversation')).toBeNull();
});
it('freezes a company-zone deadline and the entire unknown request, then retries the same intent', async () => {
  const command = vi
    .fn()
    .mockImplementation((_path, _body, method) =>
      method === 'GET'
        ? Promise.resolve({ records: [], responses: [] })
        : Promise.reject(Error('Result unknown')),
    );
  const p = props(command);
  const view = render(<Structured {...p} />);
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Frozen record' } });
  fireEvent.click(screen.getByLabelText('Eligible'));
  fireEvent.change(screen.getByLabelText('Response deadline (Asia/Kolkata, optional)'), {
    target: { value: '2030-01-02T10:00' },
  });
  fireEvent.click(screen.getByText('Create structured record'));
  await screen.findByText('Result unknown');
  const submitted = command.mock.calls.find((c) => c[1]?.retryKey)![1];
  expect(submitted.dueAt).toBe('2030-01-02T04:30:00.000Z');
  expect((screen.getByLabelText('Title') as HTMLInputElement).disabled).toBe(true);
  view.rerender(<Structured {...p} data={{ ...p.data, company: { timezone: 'UTC' } }} />);
  fireEvent.click(screen.getByText('Retry same structured record'));
  await waitFor(() => expect(command.mock.calls.filter((c) => c[1]?.retryKey)).toHaveLength(2));
  expect(command.mock.calls.filter((c) => c[1]?.retryKey)[1][1]).toEqual(submitted);
});
it('leaves an omitted deadline empty and withholds fresh creation while source access is checking', async () => {
  const command = vi.fn().mockResolvedValue({ records: [], responses: [] });
  const p = props(command);
  const view = render(<Structured {...p} />);
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'No deadline' } });
  fireEvent.click(screen.getByLabelText('Eligible'));
  view.rerender(<Structured {...p} sourceReady={false} />);
  expect((screen.getByText('Create structured record') as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<Structured {...p} />);
  fireEvent.click(screen.getByText('Create structured record'));
  await waitFor(() => expect(command.mock.calls.some((c) => c[1]?.retryKey)).toBe(true));
  expect(command.mock.calls.find((c) => c[1]?.retryKey)![1].dueAt).toBe('');
});
it('accepts a known canonical ACK after temporary readiness checking with unchanged semantic owner', async () => {
  const ack = held();
  const command = vi
    .fn()
    .mockImplementation((_path, _body, method) =>
      method === 'GET' ? Promise.resolve({ records: [], responses: [] }) : ack.promise,
    );
  const p = props(command);
  const view = render(<Structured {...p} />);
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Held known ACK' } });
  fireEvent.click(screen.getByLabelText('Eligible'));
  fireEvent.click(screen.getByText('Create structured record'));
  await waitFor(() => expect(command.mock.calls.filter((c) => c[1]?.retryKey)).toHaveLength(1));
  view.rerender(<Structured {...p} sourceReady={false} />);
  expect((screen.getByText('Retry same structured record') as HTMLButtonElement).disabled).toBe(
    true,
  );
  view.rerender(<Structured {...p} />);
  ack.resolve({});
  await waitFor(() => expect(p.onClose).toHaveBeenCalledTimes(1));
  expect(command.mock.calls.filter((c) => c[1]?.retryKey)).toHaveLength(1);
});
it('still fences a late known ACK when the semantic read authority changes', async () => {
  const ack = held();
  const command = vi
    .fn()
    .mockImplementation((_path, _body, method) =>
      method === 'GET' ? Promise.resolve({ records: [], responses: [] }) : ack.promise,
    );
  const p = props(command);
  const view = render(<Structured {...p} />);
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Original authority' } });
  fireEvent.click(screen.getByLabelText('Eligible'));
  fireEvent.click(screen.getByText('Create structured record'));
  await waitFor(() => expect(command.mock.calls.filter((c) => c[1]?.retryKey)).toHaveLength(1));
  view.rerender(<Structured {...p} data={{ ...p.data, readBasis: 'changed-authority' }} />);
  ack.resolve({});
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(p.onClose).not.toHaveBeenCalled();
  expect(command.mock.calls.filter((c) => c[1]?.retryKey)).toHaveLength(1);
});
