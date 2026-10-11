import { entityRecoveryError } from '../../../shared/business/recoveryCopy';
import { frozenGoalDraft } from '../../../shared/goals/recovery';
import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../store';
import { useExecutionInput } from '../data/executionInput';
import { localDeadline, deadlineCandidates } from '../data/deadlines';
import {
  useGoalMutation,
  type MeasuredGoal,
  type GoalMeasurement,
  type GoalEvidenceInput,
  type GoalMutationResult,
} from '../data/goals';
import GoalEvidencePicker from './GoalEvidencePicker';
import { Field, ErrorMessage } from './UI';
export default function GoalMeasurementForm({
  goal,
  ready,
  correction,
  onSaved,
}: {
  goal: MeasuredGoal;
  ready: boolean;
  correction?: GoalMeasurement;
  onSaved?: () => void;
}) {
  const w = useWorkspace();
  const zone = w.data!.company.timezone;
  const form = '$goal-measure:' + goal.id + ':' + (correction?.id ?? 'new');
  const [storedDraft, setDraft, prefill, retire] = useExecutionInput(form, 'draft', () => ({
    expectedVersion: goal.version,
    value: String(correction?.value ?? goal.current),
    local: localDeadline(new Date().toISOString(), zone),
    instant: '',
    reason: '',
    evidence: [] as GoalEvidenceInput[],
    authored: false,
  }));
  const sources = [
    '/goals/' + goal.id,
    ...storedDraft.evidence.map(
      (e) =>
        `/goals/${goal.id}/evidence-preview?kind=${e.kind}&sourceId=${encodeURIComponent(e.sourceId)}&parentId=${encodeURIComponent(e.parentId)}`,
    ),
  ];
  const action = useGoalMutation(form, sources);
  const draft = frozenGoalDraft(storedDraft, action.attempt, 'measurement', (instant) => ({
    local: localDeadline(instant, zone),
    instant,
  }));
  useEffect(() => {
    if (ready && !draft.authored)
      prefill({
        ...draft,
        expectedVersion: goal.version,
        value: String(correction?.value ?? goal.current),
      });
  }, [ready, goal.version]);

  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const set = (key: string, value: unknown) =>
    setDraft((v) => ({ ...v, [key]: value, authored: true }));
  const candidates = deadlineCandidates(draft.local, zone);
  const at = correction?.effectiveAt ?? (candidates.length === 1 ? candidates[0] : draft.instant);
  const locked = action.busy || !!action.attempt;
  const submitButton = useRef<HTMLButtonElement>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!ready || submitButton.current?.disabled) return;
    if (!action.attempt && (!draft.value.trim() || !Number.isFinite(Number(draft.value)))) {
      setError('Enter an explicit measured value.');
      return;
    }
    const submitted = draft;
    const payload = action.attempt?.payload ?? {
      expectedVersion: draft.expectedVersion,
      value: Number(draft.value),
      effectiveAt: at,
      reason: draft.reason,
      evidence: draft.evidence,
      ...(correction ? { correctsId: correction.id } : {}),
    };
    try {
      await action.execute<GoalMutationResult>(
        `/goals/${goal.id}/measurements`,
        payload,
        'POST',
        () => {
          retire(submitted);
          setSaved('Measurement recorded.');
          onSaved?.();
        },
      );
    } catch (e) {
      setError(entityRecoveryError(e, 'goal'));
    }
  }
  return (
    <form onSubmit={submit} className="execution-panel" aria-label="Measured goal update">
      <h3>{correction ? 'Correct recorded observation' : 'Record an independent measurement'}</h3>
      <p>
        {correction
          ? correction.id === goal.currentMeasurementId
            ? 'This correction changes the current result.'
            : 'This correction preserves the current result and appends to older history.'
          : 'Task completion and reminders do not measure this outcome.'}
      </p>
      <p>Reason is shared with the goal audience. Evidence retains separate current access.</p>
      <Field label="Measured value">
        <input
          type="number"
          step="any"
          required
          value={ready || draft.authored ? draft.value : ''}
          disabled={locked}
          onChange={(e) => set('value', e.target.value)}
        />
      </Field>
      {correction ? (
        <p>Inherited observation: {ready ? correction.effectiveAt : 'Checking current history…'}</p>
      ) : (
        <>
          <Field label={'Observation time in ' + zone}>
            <input
              type="datetime-local"
              required
              value={draft.local}
              disabled={locked}
              onChange={(e) => {
                set('local', e.target.value);
                set('instant', '');
              }}
            />
          </Field>
          {candidates.length === 0 && (
            <p role="alert">This local time does not exist. Choose another observation time.</p>
          )}
          {candidates.length > 1 && (
            <Field label="Repeated-time instant">
              <select value={draft.instant} onChange={(e) => set('instant', e.target.value)}>
                <option value="">Choose the observed occurrence</option>
                {candidates.map((at) => (
                  <option key={at} value={at}>
                    {at}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <p>{at ? 'Observation instant: ' + at : 'Choose a valid observation instant.'}</p>
        </>
      )}
      <Field label="Reason shared with goal audience">
        <textarea
          required
          maxLength={4000}
          value={draft.reason}
          disabled={locked}
          onChange={(e) => set('reason', e.target.value)}
        />
      </Field>
      {!ready && (
        <p role="status">Checking current goal authority. Your authored input stays here.</p>
      )}
      <ErrorMessage error={error} />
      {saved && <p role="status">{saved}</p>}
      <GoalEvidencePicker
        goalId={goal.id}
        ready={ready}
        editable={ready && !locked}
        value={draft.evidence}
        onChange={(value) => {
          set('evidence', value);
          if (!value.length) action.abandon?.();
        }}
        onDenied={() => {
          action.abandon();
          retire(storedDraft);
          setError('');
          setSaved('');
        }}
        footer={(evidenceReady) => (
          <button
            ref={submitButton}
            className="button button-primary"
            disabled={
              !ready ||
              !evidenceReady ||
              action.busy ||
              (!action.attempt &&
                (!draft.value.trim() ||
                  !draft.reason.trim() ||
                  !at ||
                  !Number.isFinite(Number(draft.value))))
            }
          >
            {action.attempt
              ? 'Retry same measurement'
              : correction
                ? 'Record correction'
                : 'Record measurement'}
          </button>
        )}
      />

      {!action.busy && ready && (
        <button
          type="button"
          className="button"
          onClick={() => {
            action.abandon?.();
            setDraft({
              ...draft,
              expectedVersion: goal.version,
              value: String(correction?.value ?? goal.current),
              evidence: [],
              authored: true,
            });
          }}
        >
          Load latest value and version
        </button>
      )}
      {!!action.attempt && (
        <button type="button" className="button" onClick={() => action.abandon?.()}>
          Abandon submitted intent
        </button>
      )}
    </form>
  );
}
