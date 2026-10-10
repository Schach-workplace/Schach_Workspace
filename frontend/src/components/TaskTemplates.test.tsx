// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { it, expect, vi, afterEach, beforeEach } from 'vitest';
import TaskTemplates from './TaskTemplates';
import sample from '../data/sample.json';
import { clearAllDrafts } from '../communication/drafts';
const state = vi.hoisted(() => ({ execute: vi.fn(), read: vi.fn(), query: vi.fn() }));
vi.mock('../store', () => ({
  useWorkspace: () => ({ data: sample.workspaces[0], mode: 'api', companyId: 'c-schach' }),
}));
vi.mock('../data/execution', () => ({
  useExecutionRead: (path: string) => state.query(path),
  useExecutionMutation: () => ({
    execute: state.execute,
    busy: false,
    error: '',
    attempt: undefined,
  }),
  executionRead: (...a: any[]) => state.read(...a),
}));
beforeEach(() => clearAllDrafts());
afterEach(() => {
  cleanup();
  clearAllDrafts();
});
it('previews a scoped template and confirms one reviewed owner/reviewer task', async () => {
  const template = {
    id: 'tpl',
    version: 1,
    name: 'Delivery',
    kind: 'task',
    defaults: { checklist: ['Verify'], requiresApproval: true },
  };
  state.query.mockImplementation((p: string) => ({
    data: p.includes('/tpl') ? { template } : { templates: [template] },
    ready: true,
    retry: vi.fn(),
  }));
  state.read.mockResolvedValue({
    fields: {
      title: 'Delivery',
      ownerId: 'u-founder',
      reviewerId: 'u-manager',
      requiresApproval: true,
      status: 'todo',
    },
    unresolved: [],
    templateVersion: 1,
  });
  state.execute.mockResolvedValue({ id: 'created' });
  render(<TaskTemplates />);
  fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'tpl' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview template' }));
  await screen.findByLabelText('Reviewed task title');
  fireEvent.click(screen.getByRole('button', { name: 'Create reviewed task' }));
  await waitFor(() => expect(state.execute).toHaveBeenCalledTimes(1));
  expect(state.execute.mock.calls[0][1]).toMatchObject({
    expectedTemplateVersion: 1,
    fields: { requiresApproval: true, ownerId: 'u-founder' },
  });
});
it('renames a captured template without losing typed defaults or silently advancing its version', async () => {
  let template = {
    id: 'tpl',
    version: 4,
    name: 'Delivery',
    kind: 'task',
    scopeOwnerId: 'u-founder',
    scopeDepartmentId: '',
    defaults: {
      title: 'Deliver',
      description: 'Inspect evidence',
      priority: 'high',
      estimatedHours: 3.5,
      tags: ['delivery'],
      status: 'backlog',
      ownerPolicy: 'actor',
      relativeDueDays: 2,
      checklist: ['Verify'],
    },
  };
  state.execute.mockClear();
  state.query.mockImplementation((p: string) => ({
    data: p.includes('/tpl') ? { template } : { templates: [template] },
    ready: true,
    retry: vi.fn(),
  }));
  state.execute.mockResolvedValue({ id: 'tpl' });
  const v = render(<TaskTemplates />);
  fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'tpl' } });
  fireEvent.click(screen.getByRole('button', { name: 'Edit template' }));
  template = { ...template, version: 5 };
  v.rerender(<TaskTemplates />);
  fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Renamed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save scoped template' }));
  await waitFor(() => expect(state.execute).toHaveBeenCalledTimes(1));
  expect(state.execute.mock.calls[0][1]).toMatchObject({
    version: 4,
    name: 'Renamed',
    defaults: {
      title: 'Deliver',
      description: 'Inspect evidence',
      priority: 'high',
      estimatedHours: 3.5,
      tags: ['delivery'],
      status: 'backlog',
      relativeDueDays: 2,
    },
  });
});
it('hides fetched management prefill and prevents an edit becoming a POST during source reauthorization', async () => {
  const source = {
    id: 'scoped',
    version: 4,
    name: 'Private scoped template',
    kind: 'task',
    scopeOwnerId: 'u-founder',
    scopeDepartmentId: '',
    defaults: { title: 'Private task default', checklist: [] },
  };
  let pending = false;
  state.execute.mockClear();
  state.execute.mockResolvedValue({ id: 'scoped' });
  state.query.mockImplementation((p: string) =>
    p.endsWith('/scoped')
      ? { ready: !pending, data: pending ? undefined : { template: source }, retry: vi.fn() }
      : { ready: true, data: { templates: [source] }, retry: vi.fn() },
  );
  const v = render(<TaskTemplates />);
  fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'scoped' } });
  fireEvent.click(screen.getByText('Edit template'));
  fireEvent.change(screen.getByLabelText('Template name'), {
    target: { value: 'Authored rename' },
  });
  pending = true;
  v.rerender(<TaskTemplates />);
  expect(screen.queryByLabelText('Default task title')).toBeNull();
  const save = screen.getByText('Save scoped template');
  expect(save.hasAttribute('disabled')).toBe(true);
  fireEvent.click(save);
  expect(state.execute).not.toHaveBeenCalled();
  pending = false;
  v.rerender(<TaskTemplates />);
  expect((screen.getByLabelText('Template name') as HTMLInputElement).value).toBe(
    'Authored rename',
  );
  fireEvent.click(screen.getByText('Save scoped template'));
  await waitFor(() => expect(state.execute).toHaveBeenCalledTimes(1));
  expect(state.execute.mock.calls[0][0]).toBe('/task-templates/scoped');
  expect(state.execute.mock.calls[0][2]).toBe('PATCH');
  expect(state.execute.mock.calls[0][1].version).toBe(4);
});
