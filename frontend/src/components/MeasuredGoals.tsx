import { useState } from 'react';
import { useWorkspace } from '../store';
import {
  useGoalRead,
  type GoalDetail,
  type MeasuredGoal,
  type GoalMeasurement,
} from '../data/goals';
import GoalMeasurementForm from './GoalMeasurementForm';
import GoalHistory from './GoalHistory';
import GoalReminderPreferences from './GoalReminderPreferences';
import GoalMetadataForm from './GoalMetadataForm';
import { Modal } from './UI';
export default function MeasuredGoals({ onTask }: { onTask: (id: string) => void }) {
  const w = useWorkspace();
  const q = useGoalRead<{ goals: MeasuredGoal[] }>('/goals');
  const [id, setId] = useState(
    () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('goal') ?? '',
  );
  const [newGoal, setNewGoal] = useState(false);
  const data = w.data!;
  return (
    <div className="page-content">
      <h2>Measured outcomes</h2>
      <p>
        Task completion never changes an independently measured result. Attainment is bounded
        0–100%; raw values remain visible.
      </p>
      {w.mode === 'demo' ? (
        <p>Measurement history, evidence and reminders require a connected company server.</p>
      ) : (
        <>
          {['founder', 'ceo', 'admin', 'head', 'manager'].includes(data.me.role) && (
            <button className="button" onClick={() => setNewGoal(true)}>
              New measured goal
            </button>
          )}
          {!q.ready ? (
            <p role="status">{q.error?.message ?? 'Checking current goals…'}</p>
          ) : (
            <div className="goal-grid">
              {q.data?.goals.map((g) => (
                <section key={g.id} className="panel goal-card">
                  <h3>{g.name}</h3>
                  <p>
                    Current: {g.current} {g.unit}
                  </p>
                  <p>
                    Baseline: {g.baseline} · Target: {g.target} {g.unit}
                    {g.target < g.baseline ? ' · Lower is better' : ''}
                  </p>
                  <button className="button" onClick={() => setId(g.id)}>
                    Open {g.name}
                  </button>
                </section>
              ))}
              {!q.data?.goals.length && <p>No goals in your current scope.</p>}
            </div>
          )}
          {id && (
            <Modal open title="Goal" onClose={() => setId('')}>
              <GoalPanel goalId={id} onTask={onTask} />
            </Modal>
          )}
          {newGoal && (
            <GoalMetadataForm
              onClose={() => {
                setNewGoal(false);
                void q.retry?.();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
function GoalPanel({ goalId, onTask }: { goalId: string; onTask: (id: string) => void }) {
  const w = useWorkspace();
  const q = useGoalRead<GoalDetail>('/goals/' + goalId);
  const [correction, setCorrection] = useState<GoalMeasurement>();
  const [measure, setMeasure] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reminders, setReminders] = useState(false);
  const neutral: MeasuredGoal = {
    id: goalId,
    companyId: w.companyId,
    version: 0,
    name: '',
    description: '',
    ownerId: '',
    departmentId: '',
    unit: '',
    baseline: 0,
    target: 1,
    current: 0,
    dueDate: '',
    taskIds: [],
    currentMeasurementId: '',
    measurementCoverageFrom: null,
    legacyObservedCurrent: null,
    legacyObservedUnit: '',
  };
  const goal = q.ready && q.data ? q.data.goal : neutral;
  const permitted = q.ready && !!q.data?.canMeasure;
  return (
    <section>
      <h2>{q.ready ? goal.name : 'Checking current goal…'}</h2>
      {q.ready && q.data ? (
        <>
          <p>
            Current result: {goal.current} {goal.unit} · Target: {goal.target} · Attainment:{' '}
            {q.data.attainment === null ? 'Unavailable' : q.data.attainment.toFixed(1) + '%'}
          </p>
          {!goal.currentMeasurementId && (
            <p>Current recorded before measurement history; earlier history unknown.</p>
          )}
          {goal.taskIds.map((id) => (
            <button className="button" key={id} onClick={() => onTask(id)}>
              Open contributing task
            </button>
          ))}
          {permitted && (
            <button
              className="button"
              onClick={() => {
                setCorrection(undefined);
                setMeasure(true);
              }}
            >
              Update measured result
            </button>
          )}
          {q.data.canEdit && (
            <button className="button" onClick={() => setEditing(true)}>
              Edit metadata
            </button>
          )}
        </>
      ) : (
        <p role="status">{q.error?.message ?? 'Authorizing current sources…'}</p>
      )}
      {(measure || correction) && (
        <GoalMeasurementForm
          key={goalId + ':' + (correction?.id ?? 'new')}
          goal={goal}
          correction={correction}
          ready={permitted}
          onSaved={() => {
            void q.retry?.();
          }}
        />
      )}
      <GoalHistory
        goalId={goalId}
        companyId={w.companyId}
        currentMeasurementId={goal.currentMeasurementId}
        canMeasure={permitted}
        onCorrect={(m) => {
          setMeasure(false);
          setCorrection(m);
        }}
      />
      {goal.ownerId === w.data?.me.id && permitted && (
        <button className="button" onClick={() => setReminders(true)}>
          My reminder preference
        </button>
      )}{' '}
      {reminders && <GoalReminderPreferences goalId={goalId} ready={permitted} />}{' '}
      {editing && (
        <StableMetadata
          goal={q.ready ? goal : undefined}
          ready={q.ready && !!q.data?.canEdit}
          onClose={() => {
            setEditing(false);
            void q.retry?.();
          }}
        />
      )}
    </section>
  );
}

function StableMetadata({
  goal,
  ready,
  onClose,
}: {
  goal?: MeasuredGoal;
  ready: boolean;
  onClose: () => void;
}) {
  const [base] = useState(goal);
  return base ? <GoalMetadataForm item={base} ready={ready} onClose={onClose} /> : null;
}
