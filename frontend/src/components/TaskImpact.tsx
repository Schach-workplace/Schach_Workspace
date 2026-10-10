import { commitmentLabel } from '../../../shared/business/types';
import { useExecutionRead, type TaskImpactView } from '../data/execution';
import AttentionInbox from './AttentionInbox';
export default function TaskImpact({
  taskId,
  onTask = () => {},
}: {
  taskId: string;
  onTask?: (id: string) => void;
}) {
  const q = useExecutionRead<TaskImpactView>(`/tasks/${taskId}/impact`);
  return (
    <section className="panel execution-panel" aria-label="Dependency impact">
      <h3>Dependency impact</h3>
      {q.loading && <p role="status">Checking current linked work…</p>}
      {q.error && (
        <>
          <p role="alert">{q.error.message}</p>
          <button className="button" onClick={() => void q.retry()}>
            Retry impact
          </button>
        </>
      )}
      {q.data && (
        <>
          <p>{q.data.notice}</p>
          {q.data.nodes.map((n) => (
            <article key={n.id}>
              <button className="button" onClick={() => onTask(n.id)}>
                {n.code} · {n.title}
              </button>
              <p>Original: {commitmentLabel(n.originalCommitment)}</p>
              <p>Current: {commitmentLabel(n.currentCommitment)}</p>
            </article>
          ))}
          {q.data.edges.map((e) => (
            <p key={e.from + e.to}>
              {q.data!.nodes.find((n) => n.id === e.from)?.code} →{' '}
              {q.data!.nodes.find((n) => n.id === e.to)?.code}
            </p>
          ))}
          {q.data.nextCursor && (
            <p>
              More authorized linked work is available; narrow the selected work before scheduling.
            </p>
          )}
          <AttentionInbox onTask={onTask} onExpense={() => {}} sourceTaskId={taskId} />
        </>
      )}
    </section>
  );
}
