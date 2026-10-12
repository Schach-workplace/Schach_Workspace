import type { FrozenBusinessAttempt } from '../data/businessAttempts';
import { RotateCcw } from 'lucide-react';
import '../styles/work.css';
export default function ExecutionRecovery({
  action,
  onReconcile,
}: {
  action: { attempt?: FrozenBusinessAttempt; busy: boolean; abandon?: () => void };
  onReconcile?: () => void;
}) {
  if (!action.attempt) return null;
  return (
    <div role="alert" className="notice notice-warning wk-recovery">
      <p>
        This submission may already have succeeded. Inspect the current result before abandoning it.
        Retrying uses the original submission.
      </p>
      <button
        type="button"
        className="button button-secondary button-small"
        disabled={action.busy}
        onClick={() => {
          action.abandon?.();
          onReconcile?.();
        }}
      >
        <RotateCcw size={13} />
        Abandon retry after inspection; prior result may exist
      </button>
    </div>
  );
}
