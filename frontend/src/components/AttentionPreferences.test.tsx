// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import AttentionPreferences from './AttentionPreferences';
const env = vi.hoisted(() => ({ mutate: vi.fn(), request: vi.fn() }));
vi.mock('../store', () => ({
  useWorkspace: () => ({
    mode: 'api',
    companyId: 'c',
    session: { user: { id: 'u' } },
    data: {
      company: { timezone: 'Asia/Kolkata' },
      people: [{ id: 'v', name: 'Sam', active: true }],
    },
    mutate: env.mutate,
  }),
}));
vi.mock('../data/api', () => ({ request: env.request }));
it('saves explicit company-local policies with the captured preference version', async () => {
  env.request.mockResolvedValue({
    preferences: {
      version: 3,
      workingHoursEnabled: false,
      workingDays: [],
      workingStart: '',
      workingEnd: '',
      quietStart: '',
      quietEnd: '',
      escalationEnabled: false,
      escalationAfterMinutes: 0,
      escalationUserId: '',
    },
  });
  env.mutate.mockResolvedValue({ ok: true });
  render(<AttentionPreferences />);
  try {
    await screen.findByLabelText('Quiet hours start');
    fireEvent.change(screen.getByLabelText('Quiet hours start'), { target: { value: '22:00' } });
    fireEvent.change(screen.getByLabelText('Quiet hours end'), { target: { value: '07:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save attention preferences' }));
    await waitFor(() => expect(env.mutate).toHaveBeenCalledTimes(1));
    expect(env.mutate.mock.calls[0][1]).toMatchObject({
      version: 3,
      quietStart: '22:00',
      quietEnd: '07:00',
    });
    expect(screen.getByText(/Asia\/Kolkata/)).toBeTruthy();
  } finally {
    cleanup();
  }
});
