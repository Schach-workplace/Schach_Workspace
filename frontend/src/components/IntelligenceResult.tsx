import { useState } from 'react';
import type { IntelligenceJob } from '../data/intelligence';
import { intelligenceSourcePath } from '../../../shared/intelligence/resultLifecycle';
import { useWorkspace } from '../store';
import { executionRead } from '../data/execution';
export default function IntelligenceResult({
  job,
  onReview,
  onTranscript,
  onOpenJob,
}: {
  job: IntelligenceJob;
  onReview: (index: number) => void;
  onTranscript: () => void;
  onOpenJob: (id: string) => void;
}) {
  const w = useWorkspace();
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const result = job.result;
  if (!result) return null;
  const cite = async (key: string) => {
    const source = job.sources?.find((s) => s.sourceKey === key);
    if (!source) return;
    try {
      await executionRead(
        w.mode,
        w.companyId,
        w.session?.user.id ?? '',
        source.kind === 'report_current'
          ? '/intelligence/selection-preview'
          : intelligenceSourcePath(source),
        source.kind === 'report_current'
          ? {
              operation: 'report_explanation',
              sources: [{ kind: source.kind, id: source.id, selectedFieldSet: 'metrics' }],
            }
          : undefined,
      );
      const params = new URLSearchParams();
      if (source.kind === 'transcript') {
        onOpenJob(source.id);
      } else if (source.conversationId) {
        params.set('conversation', source.conversationId);
        params.set('message', source.kind === 'message' ? source.id : (source.parentId ?? ''));
        if (source.kind === 'record') params.set('record', source.id);
        window.location.hash = 'connect?' + params;
      } else if (source.kind === 'task_fields' || source.kind === 'task_comment') {
        window.dispatchEvent(
          new CustomEvent('schach-open-task', {
            detail: { id: source.kind === 'task_fields' ? source.id : source.parentId },
          }),
        );
      } else if (source.kind === 'expense_fields') {
        window.dispatchEvent(new CustomEvent('schach-open-expense', { detail: { id: source.id } }));
      } else if (source.kind === 'report_current') {
        window.location.hash = 'reports';
      } else if (source.kind === 'planning_projection') {
        window.location.hash = 'planning';
      } else if (source.kind === 'report_snapshot')
        window.location.hash =
          'report?company=' +
          encodeURIComponent(w.companyId) +
          '&snapshot=' +
          encodeURIComponent(source.id);
      else if (source.kind === 'goal_fields' || source.kind === 'goal_measurement')
        window.location.hash =
          'goals?goal=' +
          encodeURIComponent(source.kind === 'goal_fields' ? source.id : (source.parentId ?? ''));
    } catch {
      setError('This source is unavailable. Reselect current sources.');
    }
  };
  const citations = (keys: string[]) => (
    <div>
      {keys.map((key) => (
        <button className="button" key={key} onClick={() => void cite(key)}>
          Open {job.sources?.find((s) => s.sourceKey === key)?.label || 'selected source'}
        </button>
      ))}
    </div>
  );
  return (
    <section aria-label="Current local assistance result">
      {result.limitations.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
      {error && <p role="alert">{error}</p>}
      {result.operation === 'transcript' && (
        <>
          <ol>
            {result.segments.slice(page * 40, (page + 1) * 40).map((s, i) => (
              <li key={i}>
                {(s.startMs / 1000).toFixed(1)}–{(s.endMs / 1000).toFixed(1)}s: {s.text}
                {citations([s.sourceKey])}
              </li>
            ))}
          </ol>
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous segments
          </button>
          <button
            disabled={(page + 1) * 40 >= result.segments.length}
            onClick={() => setPage(page + 1)}
          >
            Next segments
          </button>
          <button className="button" onClick={onTranscript}>
            Select this transcript for a new summary
          </button>
        </>
      )}
      {result.operation === 'summary' &&
        result.claims.map((c, i) => (
          <article key={i}>
            <p>
              {c.text} · {c.confidence}
            </p>
            {citations(c.sourceKeys)}
          </article>
        ))}
      {result.operation === 'report_explanation' &&
        result.items.map((item, i) => (
          <article key={i}>
            <p>{item.text}</p>
            {citations(item.sourceKeys)}
          </article>
        ))}
      {result.operation === 'action_draft' &&
        result.candidates.map((c, i) => (
          <article key={i}>
            <h3>{c.title}</h3>
            <p>{c.description}</p>
            <p>Resolve: {c.unresolved.join(', ')}</p>
            {citations(c.sourceKeys)}
            <button
              className="button"
              disabled={
                !job.publication?.allowed || (c.kind !== 'task' && !job.publication.conversationId)
              }
              onClick={() => onReview(i)}
            >
              Review {c.kind} draft
            </button>
          </article>
        ))}
      {job.publication?.allowed === false && (
        <p>This selection combines private conversations and is read-only.</p>
      )}
    </section>
  );
}
