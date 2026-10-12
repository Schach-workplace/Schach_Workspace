import { useGoalRead, type GoalMeasurement } from '../data/goals';
export default function GoalHistory({
  goalId,
  companyId = '',
  currentMeasurementId,
  canMeasure,
  onCorrect,
}: {
  goalId: string;
  companyId?: string;
  currentMeasurementId: string;
  canMeasure: boolean;
  onCorrect?: (m: GoalMeasurement) => void;
}) {
  const q = useGoalRead<{ measurements: GoalMeasurement[] }>(`/goals/${goalId}/measurements`);
  if (!q.ready)
    return <p role="status">{q.error?.message ?? 'Checking current measurement history…'}</p>;
  const corrected = new Set(q.data?.measurements.map((m) => m.correctsId).filter(Boolean));
  return (
    <section aria-label="Measurement history" className="goal-history">
      <h3 className="goal-subhead">
        Immutable measurement history
        {!!q.data?.measurements.length && (
          <span className="count-badge">{q.data.measurements.length}</span>
        )}
      </h3>
      {!q.data?.measurements.length && (
        <p className="goal-history-empty">No measurements recorded in this coverage period.</p>
      )}
      <ol>
        {q.data?.measurements.map((m) => (
          <li className="goal-history-item" key={m.id}>
            <div className="goal-history-value">
              <strong>
                {m.value} {m.unit}
              </strong>
              {m.id === currentMeasurementId && (
                <span className="pill pill-green">Current result</span>
              )}
              {m.correctsId && <span className="pill pill-purple">Correction</span>}
            </div>
            <p className="goal-history-reason">{m.reason}</p>
            <dl className="goal-history-meta">
              <div>
                <dt>Observed:</dt> <dd>{m.effectiveAt}</dd>
              </div>
              <div>
                <dt>Recorded:</dt>{' '}
                <dd>
                  {m.createdAt} · {m.actorName}
                </dd>
              </div>
              <div>
                <dt>Metric then:</dt>{' '}
                <dd>
                  baseline {m.baseline}, target {m.target}
                </dd>
              </div>
            </dl>
            {m.correctsId && (
              <p className="field-help">Appended correction of an earlier observation.</p>
            )}
            {m.evidence.map((e, i) => (
              <p key={i} className="goal-history-evidence">
                {e.status === 'evidence_unavailable'
                  ? 'Evidence unavailable'
                  : e.status === 'changed_since_measurement'
                    ? 'Evidence changed since measurement'
                    : e.label}
                {e.status === 'matching' && e.excerpt ? ' · ' + e.excerpt : ''}
                {e.status !== 'evidence_unavailable' && e.sourceId && (
                  <a
                    className="text-button"
                    href={
                      e.kind === 'report_snapshot'
                        ? '#report?company=' +
                          encodeURIComponent(companyId) +
                          '&snapshot=' +
                          encodeURIComponent(e.sourceId)
                        : e.kind === 'message'
                          ? '#connect?company=' +
                            encodeURIComponent(companyId) +
                            '&conversation=' +
                            encodeURIComponent(e.parentId ?? '')
                          : '#tasks?task=' +
                            encodeURIComponent(
                              e.kind === 'task_comment' ? (e.parentId ?? '') : e.sourceId,
                            )
                    }
                  >
                    Open evidence source
                  </a>
                )}
              </p>
            ))}
            {canMeasure && !corrected.has(m.id) && (
              <button
                className="button button-secondary button-small"
                onClick={() => onCorrect?.(m)}
              >
                Correct {m.id === currentMeasurementId ? 'current' : 'older'} observation
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
