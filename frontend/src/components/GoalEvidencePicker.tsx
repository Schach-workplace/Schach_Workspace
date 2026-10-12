import { useEffect, useState, type ReactNode } from 'react';
import { useGoalRead, type GoalEvidenceInput } from '../data/goals';
import { Field } from './UI';
type Option = { sourceId: string; parentId?: string; label: string };
export default function GoalEvidencePicker({
  goalId,
  value,
  onChange,
  onDenied = () => onChange([]),
  ready,
  editable = ready,
  footer,
}: {
  goalId: string;
  value: GoalEvidenceInput[];
  onChange: (value: GoalEvidenceInput[]) => void;
  ready: boolean;
  editable?: boolean;
  onDenied?: () => void;
  footer?: (authorized: boolean) => ReactNode;
}) {
  const [kind, setKind] = useState<GoalEvidenceInput['kind']>('task');
  const [parent, setParent] = useState('');
  const [selected, setSelected] = useState<Option>();
  const tasks = useGoalRead<{ options: Option[] }>(
    `/goals/${goalId}/evidence-options?kind=task`,
    editable && kind === 'task_comment',
  );
  const conversations = useGoalRead<{ conversations: { id: string; title: string }[] }>(
    '/conversations',
    editable && kind === 'message',
  );
  const options = useGoalRead<{ options: Option[] }>(
    `/goals/${goalId}/evidence-options?kind=${kind}${parent ? '&parentId=' + encodeURIComponent(parent) : ''}`,
    editable && ((kind !== 'task_comment' && kind !== 'message') || !!parent),
  );
  const path = selected
    ? `/goals/${goalId}/evidence-preview?kind=${kind}&sourceId=${encodeURIComponent(selected.sourceId)}&parentId=${encodeURIComponent(selected.parentId ?? parent)}`
    : '';
  const preview = useGoalRead<
    GoalEvidenceInput & { label: string; excerpt: string; audienceNotice: string }
  >(path, editable && !!selected);
  useEffect(() => {
    if (options.denied || preview.denied) {
      setSelected(undefined);
      onChange([]);
    }
  }, [options.denied, preview.denied]);
  // Fold all live exact-source checks into submission eligibility.
  let bound: (authorized: boolean) => ReactNode = (authorized) => footer?.(authorized);
  for (let i = value.length - 1; i >= 0; i--) {
    const next = bound;
    const binding = value[i];
    bound = (authorized) => (
      <BoundEvidence
        goalId={goalId}
        binding={binding}
        ready={ready}
        onDenied={() => {
          setParent('');
          setSelected(undefined);
          onDenied();
        }}
      >
        {(current) => next(authorized && current)}
      </BoundEvidence>
    );
  }
  return (
    <section aria-label="Goal evidence" className="goal-evidence">
      <h4>Selected evidence ({value.length}/50)</h4>
      <p className="field-help">
        Evidence keeps its own current access. Your authored reason is shared with the goal
        audience.
      </p>
      <Field label="Evidence kind">
        <select
          disabled={!editable}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as typeof kind);
            setParent('');
            setSelected(undefined);
          }}
        >
          <option value="task">Task</option>
          <option value="task_comment">Task comment</option>
          <option value="message">Message</option>
          <option value="report_snapshot">My historical report</option>
        </select>
      </Field>
      {(kind === 'task_comment' || kind === 'message') && (
        <Field label={kind === 'message' ? 'Conversation' : 'Comment task'}>
          <select
            disabled={!editable}
            value={parent}
            onChange={(e) => {
              setParent(e.target.value);
              setSelected(undefined);
            }}
          >
            <option value="">Choose a currently readable source</option>
            {kind === 'message' &&
              conversations.ready &&
              conversations.data?.conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            {kind === 'task_comment' &&
              tasks.ready &&
              tasks.data?.options.map((t) => (
                <option key={t.sourceId} value={t.sourceId}>
                  {t.label}
                </option>
              ))}
          </select>
        </Field>
      )}
      {!editable || !options.ready ? (
        <p role="status" className="field-help">
          Checking current evidence access…
        </p>
      ) : (
        <div className="goal-evidence-options" role="group" aria-label="Readable evidence sources">
          {options.data?.options.map((o) => (
            <button
              type="button"
              className="button button-secondary"
              key={o.sourceId}
              onClick={() => setSelected(o)}
            >
              {o.label}
            </button>
          ))}
          {!options.data?.options.length && (
            <p className="field-help">No currently readable options.</p>
          )}
        </div>
      )}
      {selected && (
        <div className="goal-evidence-preview">
          {preview.ready && preview.data ? (
            <>
              <p>{preview.data.label}</p>
              <blockquote>{preview.data.excerpt}</blockquote>
              <small>Exact binding: {preview.data.contentHash}</small>
              <button
                type="button"
                className="button button-secondary"
                disabled={!editable || value.length >= 50}
                onClick={() => {
                  const p = preview.data!;
                  const binding: GoalEvidenceInput = {
                    kind: p.kind,
                    sourceId: p.sourceId,
                    parentId: p.parentId,
                    revision: p.revision,
                    contentHash: p.contentHash,
                  };
                  if (
                    !value.some(
                      (v) =>
                        v.kind === binding.kind &&
                        v.sourceId === binding.sourceId &&
                        v.parentId === binding.parentId,
                    )
                  )
                    onChange([...value, binding]);
                  setSelected(undefined);
                }}
              >
                Use selected evidence
              </button>
            </>
          ) : (
            <p role="status">Checking this exact source…</p>
          )}
        </div>
      )}
      {value.length > 0 && (
        <button
          type="button"
          className="button button-secondary"
          disabled={!editable}
          onClick={() => onChange([])}
        >
          Clear selected evidence
        </button>
      )}
      {bound(ready)}
    </section>
  );
}

function BoundEvidence({
  goalId,
  binding,
  ready,
  onDenied,
  children,
}: {
  goalId: string;
  binding: GoalEvidenceInput;
  ready: boolean;
  onDenied: () => void;
  children: (authorized: boolean) => ReactNode;
}) {
  const q = useGoalRead(
    `/goals/${goalId}/evidence-preview?kind=${binding.kind}&sourceId=${encodeURIComponent(binding.sourceId)}&parentId=${encodeURIComponent(binding.parentId)}`,
    ready,
  );
  useEffect(() => {
    if (q.denied) onDenied();
  }, [q.denied]);
  return children(q.ready);
}
