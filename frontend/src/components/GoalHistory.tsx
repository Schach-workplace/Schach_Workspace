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
    <section aria-label="Measurement history">
      <h3>Immutable measurement history</h3>
      {!q.data?.measurements.length && <p>No measurements recorded in this coverage period.</p>}
      {q.data?.measurements.map((m) => (
        <article className="panel" key={m.id}>
          <h4>
            {m.value} {m.unit}
            {m.id === currentMeasurementId ? ' · Current result' : ''}
          </h4>
          <p>{m.reason}</p>
          <p>Observed: {m.effectiveAt}</p>
          <p>
            Recorded: {m.createdAt} · {m.actorName}
          </p>
          <small>
            Metric then: baseline {m.baseline}, target {m.target}
          </small>
          {m.correctsId && <p>Appended correction of an earlier observation.</p>}
          {m.evidence.map((e, i) => (
            <p key={i}>
              {e.status === 'evidence_unavailable'
                ? 'Evidence unavailable'
                : e.status === 'changed_since_measurement'
                  ? 'Evidence changed since measurement'
                  : e.label}
              {e.status === 'matching' && e.excerpt ? ' · ' + e.excerpt : ''}
              {e.status !== 'evidence_unavailable' && e.sourceId && (
                <a
                  className="button"
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
            <button className="button" onClick={() => onCorrect?.(m)}>
              Correct {m.id === currentMeasurementId ? 'current' : 'older'} observation
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
