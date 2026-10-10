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
      <h3>Orphaned schedules</h3>
      <p>
        Inactive owners retain their definitions. Pause or delete stops their exports and Inbox
        links.
      </p>
      {q.loading && <p role="status">Checking orphaned definitions…</p>}
      {q.error && <p role="alert">{q.error.message}</p>}
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
    <div>
      <p>
        Definition {d.id} · version {d.version} · {d.state}
      </p>
      {error && <p role="alert">{error}</p>}
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
  );
}
