import type { FrozenBusinessAttempt } from '../data/businessAttempts';
export default function ExecutionRecovery({
  action,
  onReconcile,
}: {
  action: { attempt?: FrozenBusinessAttempt; busy: boolean; abandon?: () => void };
  onReconcile?: () => void;
}) {
  if (!action.attempt) return null;
  return (
    <div role="alert">
      <p>
        This submission may already have succeeded. Inspect the current result before abandoning it.
        Retrying uses the original submission.
      </p>
      <button
        type="button"
        className="button"
        disabled={action.busy}
        onClick={() => {
          action.abandon?.();
          onReconcile?.();
        }}
      >
        Abandon retry after inspection; prior result may exist
      </button>
    </div>
  );
}
