import { LoaderCircle } from 'lucide-react';
import { commitmentLabel } from '../../../shared/business/types';
import { useExecutionRead, type TaskImpactView } from '../data/execution';
import AttentionInbox from './AttentionInbox';
import '../styles/work.css';
export default function TaskImpact({
  taskId,
  onTask = () => {},
  embedded = false,
}: {
  taskId: string;
  onTask?: (id: string) => void;
  embedded?: boolean;
}) {
  const q = useExecutionRead<TaskImpactView>(`/tasks/${taskId}/impact`);
  const code = (id: string) => q.data?.nodes.find((n) => n.id === id)?.code;
  return (
    <section className={`wk-card${embedded ? ' wk-embedded' : ''}`} aria-label="Dependency impact">
      <header className={embedded ? 'sr-only' : 'wk-head'}>
        <div>
          <h3>Dependency impact</h3>
          {!embedded && <p>Linked work and how its commitments compare with the original.</p>}
        </div>
      </header>
      {q.loading && (
        <p role="status" className="wk-status">
          <LoaderCircle size={14} className="spin" />
          Checking current linked work…
        </p>
      )}
      {q.error && (
        <div className="wk-error">
          <p role="alert">{q.error.message}</p>
          <button className="button button-secondary button-small" onClick={() => void q.retry()}>
            Retry impact
          </button>
        </div>
      )}
      {q.data && (
        <>
          <p className="wk-caption">{q.data.notice}</p>
          {q.data.nodes.length > 0 && (
            <ul className="wk-list">
              {q.data.nodes.map((n) => {
                const original = commitmentLabel(n.originalCommitment);
                const current = commitmentLabel(n.currentCommitment);
                return (
                  <li key={n.id}>
                    <button className="wk-link" onClick={() => onTask(n.id)}>
                      {n.code} · {n.title}
                    </button>
                    <div className="wk-commit">
                      <p>Original: {original}</p>
                      <p className={original !== current ? 'wk-proposed' : undefined}>
                        Current: {current}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {q.data.edges.length > 0 && (
            <div className="wk-chips" aria-label="Dependency links">
              <b>Links</b>
              {q.data.edges.map((e) => (
                <span className="wk-chip" key={e.from + e.to}>
                  {code(e.from)} → {code(e.to)}
                </span>
              ))}
            </div>
          )}
          {q.data.nextCursor && (
            <p className="notice">
              More authorized linked work is available; narrow the selected work before scheduling.
            </p>
          )}
          <div className="wk-inbox">
            <AttentionInbox onTask={onTask} onExpense={() => {}} sourceTaskId={taskId} />
          </div>
        </>
      )}
    </section>
  );
}
