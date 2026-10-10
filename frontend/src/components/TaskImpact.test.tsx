// @vitest-environment happy-dom
import { render, screen, cleanup } from '@testing-library/react';
import { it, expect, vi, afterEach } from 'vitest';
import TaskImpact from './TaskImpact';
vi.mock('../data/execution', () => ({
  useExecutionRead: () => ({
    ready: true,
    data: {
      nodes: [
        {
          id: 'one',
          title: 'Authorized work',
          code: 'ONE',
          currentCommitment: { dueDate: '2026-10-22' },
          originalCommitment: { dueDate: '2026-10-20' },
        },
      ],
      edges: [],
      notice: 'Only authorized linked work is shown.',
    },
  }),
}));
vi.mock('./AttentionInbox', () => ({ default: () => null }));
afterEach(cleanup);
it('labels current and original commitments with authorized coverage', () => {
  render(<TaskImpact taskId="one" />);
  expect(screen.getByText('Only authorized linked work is shown.')).toBeTruthy();
  expect(screen.getByText(/Original:.*2026-10-20/)).toBeTruthy();
  expect(screen.getByText(/Current:.*2026-10-22/)).toBeTruthy();
});
