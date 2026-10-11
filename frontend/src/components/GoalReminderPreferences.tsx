import { frozenGoalDraft } from '../../../shared/goals/recovery';
import { useEffect, useState } from 'react';
import { useGoalRead, useGoalMutation, type GoalReminderPreference } from '../data/goals';
import { useExecutionInput } from '../data/executionInput';
import { Field, ErrorMessage } from './UI';
export default function GoalReminderPreferences({
  goalId,
  ready,
}: {
  goalId: string;
  ready: boolean;
}) {
  const q = useGoalRead<{ preference: GoalReminderPreference }>(
    `/goals/${goalId}/reminder-preference`,
    ready,
  );
  return (
    <section>
      <h3>My goal update reminder</h3>
      <p>Opt-in and owner only. Resolving a reminder does not record a measurement.</p>
      {
        <ReminderEditor
          key={goalId}
          goalId={goalId}
          preference={
            q.ready && q.data
              ? q.data.preference
              : {
                  goalId,
                  userId: '',
                  version: 0,
                  enabled: false,
                  cadence: 'weekly',
                  weekday: 1,
                  monthDay: 1,
                  localTime: '09:00',
                  createdAt: '',
                  updatedAt: '',
                }
          }
          ready={ready && q.ready}
        />
      }
    </section>
  );
}
function ReminderEditor({
  goalId,
  preference,
  ready,
}: {
  goalId: string;
  preference: GoalReminderPreference;
  ready: boolean;
}) {
  const [storedDraft, setDraft, prefill, retire] = useExecutionInput(
    '$goal-reminder:' + goalId,
    'draft',
    () => ({ ...preference, expectedVersion: preference.version, reason: '', authored: false }),
  );
  const action = useGoalMutation('$goal-reminder:' + goalId, ['/goals/' + goalId]);
  const draft = frozenGoalDraft(storedDraft, action.attempt, 'reminder', () => ({}));
  useEffect(() => {
    if (ready && !draft.authored)
      prefill({ ...preference, expectedVersion: preference.version, reason: '', authored: false });
  }, [ready, preference.version]);

  const [error, setError] = useState('');
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v, authored: true }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = action.attempt?.payload ?? {
        expectedVersion: draft.expectedVersion,
        enabled: draft.enabled,
        cadence: draft.cadence,
        weekday: draft.weekday,
        monthDay: draft.monthDay,
        localTime: draft.localTime,
        reason: draft.reason,
      };
      await action.execute(`/goals/${goalId}/reminder-preference`, payload, 'PATCH', () => {
        retire(draft);
        qRefresh();
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function qRefresh() {
    setError('Preference saved. Reopen to inspect its current version.');
  }
  return (
    <form className="execution-panel" onSubmit={submit}>
      <Field label="Enable my goal update reminder">
        <input
          type="checkbox"
          checked={(ready || draft.authored) && draft.enabled}
          onChange={(e) => set('enabled', e.target.checked)}
        />
      </Field>
      <Field label="Cadence">
        <select
          value={ready || draft.authored ? draft.cadence : ''}
          onChange={(e) => set('cadence', e.target.value)}
        >
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </Field>
      <Field label="Weekday (Monday 1 – Sunday 7)">
        <input
          type="number"
          min={1}
          max={7}
          value={ready || draft.authored ? draft.weekday : ''}
          onChange={(e) => set('weekday', Number(e.target.value))}
        />
      </Field>
      <Field label="Month day (1–28)">
        <input
          type="number"
          min={1}
          max={28}
          value={ready || draft.authored ? draft.monthDay : ''}
          onChange={(e) => set('monthDay', Number(e.target.value))}
        />
      </Field>
      <Field label="Company local reminder time">
        <input
          type="time"
          value={ready || draft.authored ? draft.localTime : ''}
          onChange={(e) => set('localTime', e.target.value)}
        />
      </Field>
      <Field label="Preference reason">
        <textarea required value={draft.reason} onChange={(e) => set('reason', e.target.value)} />
      </Field>
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
      <button
        type="button"
        className="button"
        disabled={action.busy || !ready}
        onClick={() => {
          action.abandon();
          setDraft({
            ...preference,
            expectedVersion: preference.version,
            reason: '',
            authored: true,
          });
          setError('');
        }}
      >
        Load latest preference and version
      </button>
      <button className="button" disabled={!ready || action.busy || !draft.reason.trim()}>
        {action.attempt ? 'Retry same preference' : 'Save my reminder preference'}
      </button>
    </form>
  );
}
