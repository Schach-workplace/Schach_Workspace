// @vitest-environment happy-dom
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CalendarExportButton from './CalendarExport';
const h = vi.hoisted(() => ({
  read: vi.fn(),
  authorizing: false,
  download: vi.fn(),
  data: {
    tasks: [{ id: 't', title: 'Drawings', dueDate: '2026-10-20', deadlineMode: 'all_day' }],
    complete: true,
    timezone: 'Asia/Kolkata',
  },
}));
vi.mock('../store', () => ({
  useWorkspace: () => ({
    mode: 'api',
    authorizing: h.authorizing,
    companyId: 'co',
    session: { user: { id: 'me' } },
    data: { company: { id: 'co' }, readBasis: 'basis' },
  }),
}));
vi.mock('../data/execution', () => ({
  useExecutionRead: () => ({ ready: true, data: h.data, retry: vi.fn() }),
  executionRead: h.read,
}));
vi.mock('./UI', () => ({
  Modal: ({ children, open }: any) => (open ? <section>{children}</section> : null),
  downloadText: h.download,
}));
afterEach(() => {
  cleanup();
  h.authorizing = false;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  h.read.mockReset();
  h.download.mockReset();
});
it.each(['current', 'changed'])(
  'rechecks %s calendar after explicit audience consent',
  async (mode) => {
    h.read.mockResolvedValue(mode === 'current' ? h.data : { ...h.data, tasks: [] });
    render(
      <CalendarExportButton
        path="/planning/calendar?from=2026-10-18&to=2026-11-14"
        from="2026-10-18"
        to="2026-11-14"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export calendar' }));
    expect(
      (screen.getByRole('button', { name: 'Download calendar file' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByLabelText('I reviewed the export fields and external audience'));
    fireEvent.click(screen.getByRole('button', { name: 'Download calendar file' }));
    if (mode === 'current') {
      await screen.findByRole('button', { name: 'Export calendar' });
      expect(h.download).toHaveBeenCalledOnce();
      expect(h.download.mock.calls[0]?.[1]).toContain('SUMMARY:Drawings');
    } else {
      await screen.findByRole('alert');
      expect(h.download).not.toHaveBeenCalled();
      expect(screen.getByRole('alert').textContent).toContain('Calendar changed');
    }
  },
);

it.each(['visibility', 'authorization'])(
  'invalidates a deferred download and consent across %s restoration',
  async (cause) => {
    let resolve!: (v: typeof h.data) => void;
    h.read.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const props = {
      path: '/planning/calendar?from=2026-10-18&to=2026-11-14',
      from: '2026-10-18',
      to: '2026-11-14',
    };
    const view = render(<CalendarExportButton {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export calendar' }));
    fireEvent.click(screen.getByLabelText('I reviewed the export fields and external audience'));
    fireEvent.click(screen.getByRole('button', { name: 'Download calendar file' }));
    if (cause === 'visibility') {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      fireEvent(document, new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      fireEvent(document, new Event('visibilitychange'));
    } else {
      h.authorizing = true;
      view.rerender(<CalendarExportButton {...props} />);
      expect(screen.queryByRole('button', { name: 'Download calendar file' })).toBeNull();
      h.authorizing = false;
      view.rerender(<CalendarExportButton {...props} />);
    }
    await act(async () => resolve(h.data));
    expect(h.download).not.toHaveBeenCalled();
    expect(
      (
        screen.getByLabelText(
          'I reviewed the export fields and external audience',
        ) as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(
      (screen.getByRole('button', { name: 'Download calendar file' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    h.read.mockResolvedValue(h.data);
    fireEvent.click(screen.getByLabelText('I reviewed the export fields and external audience'));
    fireEvent.click(screen.getByRole('button', { name: 'Download calendar file' }));
    await vi.waitFor(() => expect(h.download).toHaveBeenCalledOnce());
  },
);
