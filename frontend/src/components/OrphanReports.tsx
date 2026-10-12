import { useState } from 'react';
import { useWorkspace } from '../store';
import { useExecutionRead, useExecutionMutation } from '../data/execution';
import type { OrphanDefinition } from '../../../shared/reports/types';
export default function OrphanReports() {
  const w = useWorkspace();
  const leader = ['founder', 'ceo', 'admin'].includes(w.data?.me.role ?? '');
  const q = useExecutionRead<{ orphans: OrphanDefinition[] }>(
    '/reports/definitions/orphans',
    leader,
  );
  if (!leader) return null;
  return (
    <section className="panel">
      <div className="section-header">
        <div>
          <h3>Orphaned schedules</h3>
          <p>
            Inactive owners retain their definitions. Pause or delete stops their exports and Inbox
            links.
          </p>
        </div>
      </div>
      {q.loading && (
        <p role="status" className="saved-empty">
          Checking orphaned definitions…
        </p>
      )}
      {q.error && (
        <div role="alert" className="inline-error">
          {q.error.message}
        </div>
      )}
      {q.ready && !q.data?.orphans.length && (
        <p className="saved-empty">No orphaned definitions.</p>
      )}
      {q.ready &&
        q.data?.orphans.map((d) => (
          <OrphanRow key={d.id} definition={d} changed={() => void q.retry()} />
        ))}
    </section>
  );
}
function OrphanRow({
  definition: d,
  changed,
}: {
  definition: OrphanDefinition;
  changed: () => void;
}) {
  const action = useExecutionMutation('$report-orphan:' + d.id, ['/reports/definitions/orphans']);
  const [error, setError] = useState('');
  async function apply(state: 'paused' | 'deleted') {
    if (
      !window.confirm(
        'Stop this orphaned definition’s exports and Inbox links? Ownership and report contents remain private.',
      )
    )
      return;
    try {
      await action.execute(
        `/reports/definitions/${encodeURIComponent(d.id)}/orphan-state`,
        action.attempt?.payload ?? { expectedVersion: d.version, state },
        'PATCH',
        changed,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="orphan-row">
      <p>
        Definition {d.id} · version {d.version} · <span className="pill pill-slate">{d.state}</span>
      </p>
      {error && (
        <div role="alert" className="inline-error">
          {error}
        </div>
      )}
      <div>
        {action.attempt ? (
          <button
            className="button button-secondary"
            disabled={action.busy}
            onClick={() => void apply(action.attempt!.payload.state as 'paused' | 'deleted')}
          >
            Retry original orphan action
          </button>
        ) : (
          <>
            <button
              className="button button-secondary"
              disabled={action.busy}
              onClick={() => void apply('paused')}
            >
              Pause orphan
            </button>
            <button
              className="button button-secondary"
              disabled={action.busy}
              onClick={() => void apply('deleted')}
            >
              Delete orphan
            </button>
          </>
        )}
      </div>
    </div>
  );
}
