import { frozenGoalDraft } from '../../../shared/goals/recovery';
import { useState } from 'react';
import { useWorkspace } from '../store';
import { useExecutionInput } from '../data/executionInput';
import { useGoalMutation, useGoalRead, type MeasuredGoal, type GoalDetail } from '../data/goals';
import { deadlineCandidates, localDeadline } from '../data/deadlines';
import { Field, ErrorMessage, Modal } from './UI';
export default function GoalMetadataForm({
  item,
  onClose,
  ready = true,
}: {
  ready?: boolean;
  item?: Partial<MeasuredGoal>;
  onClose: () => void;
}) {
  const w = useWorkspace();
  const data = w.data!;
  const form = '$goal-metadata:' + (item?.id ?? 'new');
  const [storedDraft, setDraft, , retire] = useExecutionInput(form, 'draft', () => ({
    version: item?.version ?? 1,
    name: item?.name ?? '',
    description: item?.description ?? '',
    ownerId: item?.ownerId ?? data.me.id,
    departmentId: item?.departmentId ?? data.me.departmentId,
    inspectedUnit: item?.unit ?? '%',
    unit: item?.unit ?? '%',
    baseline: String(item?.baseline ?? 0),
    target: String(item?.target ?? 100),
    dueDate: item?.dueDate ?? '',
    taskIds: item?.taskIds ?? [],
    value: String(item?.current ?? 0),
    local: localDeadline(new Date().toISOString(), data.company.timezone),
    reason: '',
    measurementReason: '',
    instant: '',
    authored: false,
    withMeasurement: !item,
  }));
  const action = useGoalMutation(form, item?.id ? ['/goals/' + item.id] : []);
  const draft = frozenGoalDraft(storedDraft, action.attempt, 'metadata', (instant) => ({
    local: localDeadline(instant, data.company.timezone),
    instant,
  }));
  const latest = useGoalRead<GoalDetail>('/goals/' + (item?.id ?? ''), !!item && ready);
  const loadLatest = () => {
    if (!latest.ready || !latest.data?.canEdit) return;
    const g = latest.data.goal;
    action.abandon();
    setDraft({
      ...draft,
      version: g.version,
      name: g.name,
      description: g.description,
      ownerId: g.ownerId,
      departmentId: g.departmentId,
      unit: g.unit,
      inspectedUnit: g.unit,
      baseline: String(g.baseline),
      target: String(g.target),
      dueDate: g.dueDate,
      taskIds: g.taskIds,
      value: String(g.current),
      withMeasurement: false,
      authored: true,
    });
    setError('');
  };
  const [error, setError] = useState('');
  const set = (key: string, value: unknown) =>
    setDraft((v) => ({ ...v, [key]: value, authored: true }));
  const needMeasurement = draft.withMeasurement || !item || draft.unit !== draft.inspectedUnit;
  const candidates = deadlineCandidates(draft.local, data.company.timezone);
  const instant = draft.instant;
  const setInstant = (value: string) => set('instant', value);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (
      !action.attempt &&
      (!draft.baseline.trim() ||
        !draft.target.trim() ||
        !Number.isFinite(Number(draft.baseline)) ||
        !Number.isFinite(Number(draft.target)) ||
        (needMeasurement && (!draft.value.trim() || !Number.isFinite(Number(draft.value)))))
    ) {
      setError('Enter explicit finite numeric values.');
      return;
    }
    const submitted = draft;
    const metadata = {
      name: draft.name,
      description: draft.description,
      ownerId: draft.ownerId,
      departmentId: draft.departmentId,
      unit: draft.unit,
      baseline: Number(draft.baseline),
      target: Number(draft.target),
      dueDate: draft.dueDate,
      taskIds: draft.taskIds,
    };
    const at = candidates.length === 1 ? candidates[0] : instant;
    if (!action.attempt && needMeasurement && !at) {
      setError('Choose a valid, explicit observation instant.');
      return;
    }
    const measurement = {
      value: Number(draft.value),
      effectiveAt: at,
      reason: draft.measurementReason,
      evidence: [],
    };
    const payload =
      action.attempt?.payload ??
      (item
        ? {
            ...metadata,
            version: draft.version,
            reason: draft.reason,
            ...(needMeasurement
              ? {
                  current: measurement.value,
                  effectiveAt: at,
                  measurementReason: draft.measurementReason,
                  evidence: [],
                }
              : {}),
          }
        : { ...metadata, initialMeasurement: measurement });
    try {
      await action.execute(
        item ? '/goals/' + item.id : '/goals',
        payload,
        item ? 'PATCH' : 'POST',
        () => {
          retire(submitted);
          onClose();
        },
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal open title={item ? 'Edit goal metadata' : 'Create measured goal'} onClose={onClose}>
      {w.mode === 'demo' ? (
        <p>Measured goal editing is available on a connected company server.</p>
      ) : (
        <form className="execution-panel" onSubmit={submit}>
          <Field label="Goal name">
            <input
              required
              value={ready || draft.authored ? draft.name : ''}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={ready || draft.authored ? draft.description : ''}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
          <Field label="Owner">
            <select
              value={ready || draft.authored ? draft.ownerId : ''}
              onChange={(e) => set('ownerId', e.target.value)}
            >
              {(ready ? data.people : [])
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Department">
            <select
              value={ready || draft.authored ? draft.departmentId : ''}
              onChange={(e) => set('departmentId', e.target.value)}
            >
              <option value="">Company</option>
              {(ready ? data.departments : []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Unit">
            <input
              required
              value={ready || draft.authored ? draft.unit : ''}
              onChange={(e) => set('unit', e.target.value)}
            />
          </Field>
          <Field label="Baseline">
            <input
              type="number"
              step="any"
              required
              value={ready || draft.authored ? draft.baseline : ''}
              onChange={(e) => set('baseline', e.target.value)}
            />
          </Field>
          <Field label="Target">
            <input
              type="number"
              step="any"
              required
              value={ready || draft.authored ? draft.target : ''}
              onChange={(e) => set('target', e.target.value)}
            />
          </Field>
          <Field label="Due date">
            <input
              type="date"
              value={ready || draft.authored ? draft.dueDate : ''}
              onChange={(e) => set('dueDate', e.target.value)}
            />
          </Field>
          <Field label="Contributing tasks">
            <select
              multiple
              value={ready || draft.authored ? draft.taskIds : []}
              onChange={(e) =>
                set(
                  'taskIds',
                  Array.from(e.target.selectedOptions, (o) => o.value),
                )
              }
            >
              {(ready ? data.tasks : []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </Field>
          {item && (
            <>
              <Field label="Metadata reason">
                <textarea
                  required
                  value={draft.reason}
                  onChange={(e) => set('reason', e.target.value)}
                />
              </Field>
              <label>
                <input
                  type="checkbox"
                  checked={draft.withMeasurement}
                  onChange={(e) => set('withMeasurement', e.target.checked)}
                />
                Record a new measured value with this edit
              </label>
            </>
          )}
          {needMeasurement && (
            <>
              <p>
                A unit change requires a new explicit measurement. Reason is shared with the goal
                audience.
              </p>
              <Field label="Initial or new measured value">
                <input
                  type="number"
                  step="any"
                  required
                  value={ready || draft.authored ? draft.value : ''}
                  onChange={(e) => set('value', e.target.value)}
                />
              </Field>
              <Field label={'Observation time in ' + data.company.timezone}>
                <input
                  type="datetime-local"
                  required
                  value={draft.local}
                  onChange={(e) => {
                    set('local', e.target.value);
                    setInstant('');
                  }}
                />
              </Field>
              {candidates.length > 1 && (
                <Field label="Repeated-time instant">
                  <select value={instant} onChange={(e) => setInstant(e.target.value)}>
                    <option value="">Choose occurrence</option>
                    {candidates.map((at) => (
                      <option key={at}>{at}</option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Measurement reason shared with goal audience">
                <textarea
                  required
                  value={draft.measurementReason}
                  onChange={(e) => set('measurementReason', e.target.value)}
                />
              </Field>
            </>
          )}
          <ErrorMessage error={error} />
          {action.attempt && (
            <button
              type="button"
              className="button"
              disabled={action.busy}
              onClick={() => {
                action.abandon();
                setError('');
              }}
            >
              Discard submitted intent and edit
            </button>
          )}
          {!!item && (
            <button
              type="button"
              className="button"
              disabled={action.busy || !ready || !latest.ready || !latest.data?.canEdit}
              onClick={loadLatest}
            >
              Load latest goal and version
            </button>
          )}
          <button className="button button-primary" disabled={!ready || action.busy}>
            {action.attempt ? 'Retry same goal intent' : 'Save reviewed goal'}
          </button>
        </form>
      )}
    </Modal>
  );
}
