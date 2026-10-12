import IntelligenceLauncher from './IntelligenceLauncher';
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
import {
  dateLabel,
  departmentName,
  EmptyState,
  goalPercent,
  Modal,
  personName,
  ProgressBar,
  today,
} from './UI';
import {
  ArrowRight,
  CalendarDays,
  Info,
  Plus,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import '../styles/goals-reports.css';
export default function MeasuredGoals({ onTask }: { onTask: (id: string) => void }) {
  const w = useWorkspace();
  const q = useGoalRead<{ goals: MeasuredGoal[] }>('/goals');
  const [id, setId] = useState(
    () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('goal') ?? '',
  );
  const [newGoal, setNewGoal] = useState(false);
  const data = w.data!;
  const canCreate =
    w.mode !== 'demo' && ['founder', 'ceo', 'admin', 'head', 'manager'].includes(data.me.role);
  const goals = q.ready ? (q.data?.goals ?? []) : [];
  return (
    <div className="page-content measured-goals">
      <div className="mg-header">
        <div>
          <h2>Measured outcomes</h2>
          <p>Each goal tracks an independently recorded result against its baseline and target.</p>
        </div>
        {canCreate && (
          <button className="button button-primary" onClick={() => setNewGoal(true)}>
            <Plus size={15} aria-hidden="true" />
            New measured goal
          </button>
        )}
      </div>
      <p className="mg-control-note">
        <Info size={14} aria-hidden="true" />
        <span>
          Task completion never changes an independently measured result. Attainment is bounded
          0–100%; raw values remain visible.
        </span>
      </p>
      {w.mode === 'demo' ? (
        <div className="panel">
          <EmptyState
            icon={<Target size={22} />}
            title="Connect a company server"
            description="Measurement history, evidence and reminders require a connected company server."
          />
        </div>
      ) : (
        <>
          {!q.ready ? (
            q.error ? (
              <div className="inline-error" role="alert">
                {q.error.message}
              </div>
            ) : (
              <div className="goal-grid mg-grid" aria-busy="true">
                <p role="status" className="sr-only">
                  Checking current goals…
                </p>
                {[0, 1].map((i) => (
                  <div key={i} className="panel mg-card mg-skeleton" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                ))}
              </div>
            )
          ) : goals.length ? (
            <div className="goal-grid mg-grid">
              {goals.map((g) => (
                <GoalCard key={g.id} goal={g} onOpen={() => setId(g.id)} />
              ))}
            </div>
          ) : (
            <div className="panel">
              <EmptyState
                icon={<Target size={22} />}
                title="No goals in your current scope"
                description="Measured goals you own, lead or can read appear here."
                action={
                  canCreate ? (
                    <button className="button button-primary" onClick={() => setNewGoal(true)}>
                      <Plus size={15} aria-hidden="true" />
                      New measured goal
                    </button>
                  ) : undefined
                }
              />
            </div>
          )}
          {id && (
            <Modal
              open
              wide
              title="Measured goal"
              description="Recorded results, evidence and history for this outcome."
              onClose={() => setId('')}
            >
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

type GoalStatus = { label: string; tone: 'green' | 'red' | 'orange' | 'slate' };
function goalStatus(goal: MeasuredGoal, zone: string): GoalStatus {
  const lower = goal.target < goal.baseline;
  const met = lower ? goal.current <= goal.target : goal.current >= goal.target;
  if (met) return { label: 'Target met', tone: 'green' };
  if (goal.dueDate && goal.dueDate < today(zone)) return { label: 'Past due', tone: 'red' };
  const worse = lower ? goal.current > goal.baseline : goal.current < goal.baseline;
  if (worse) return { label: 'Below baseline', tone: 'orange' };
  if (goal.current === goal.baseline) return { label: 'At baseline', tone: 'slate' };
  return { label: 'In progress', tone: 'slate' };
}
function formatValue(value: number, unit: string) {
  return unit === '%' ? `${value}%` : `${value} ${unit}`.trim();
}
function GoalMeter({ goal }: { goal: MeasuredGoal }) {
  const lower = goal.target < goal.baseline;
  const pct = goalPercent(goal.baseline, goal.current, goal.target);
  const met = lower ? goal.current <= goal.target : goal.current >= goal.target;
  return (
    <div className="mg-meter">
      <div className="mg-meter-head">
        <span>
          {lower ? (
            <TrendingDown size={13} aria-hidden="true" />
          ) : (
            <TrendingUp size={13} aria-hidden="true" />
          )}
          {lower ? 'Lower is better' : 'Higher is better'}
        </span>
        <strong>{pct}% attained</strong>
      </div>
      <ProgressBar
        value={pct}
        color={met ? 'green' : 'orange'}
        label={`${goal.name || 'Goal'} attainment from baseline to target`}
      />
      <div className="mg-meter-scale">
        <span>Baseline {formatValue(goal.baseline, goal.unit)}</span>
        <span>Target {formatValue(goal.target, goal.unit)}</span>
      </div>
    </div>
  );
}

function GoalCard({ goal, onOpen }: { goal: MeasuredGoal; onOpen: () => void }) {
  const w = useWorkspace();
  const data = w.data!;
  const zone = data.company.timezone;
  const status = goalStatus(goal, zone);
  return (
    <article className="panel mg-card">
      <header className="mg-card-head">
        <div>
          <h3>{goal.name}</h3>
          <p>
            {departmentName(data, goal.departmentId)} · {personName(data, goal.ownerId)}
          </p>
        </div>
        <span className={`pill pill-${status.tone}`}>{status.label}</span>
      </header>
      <div className="mg-current">
        <strong>{goal.current}</strong>
        <span>{goal.unit}</span>
        <small>current result</small>
      </div>
      <GoalMeter goal={goal} />
      <footer className="mg-card-foot">
        {goal.dueDate && (
          <span>
            <CalendarDays size={13} aria-hidden="true" />
            Due {dateLabel(goal.dueDate, { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        )}
        <button
          className="text-button mg-card-open"
          aria-label={`Open ${goal.name}`}
          onClick={onOpen}
        >
          Open goal
          <ArrowRight size={13} aria-hidden="true" />
        </button>
      </footer>
    </article>
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
  const status = q.ready && q.data ? goalStatus(goal, w.data!.company.timezone) : undefined;
  return (
    <section className="goal-detail">
      <header className="goal-detail-head">
        <div>
          <h2>{q.ready ? goal.name : 'Checking current goal…'}</h2>
          {q.ready && goal.description && <p>{goal.description}</p>}
        </div>
        {status && <span className={`pill pill-${status.tone}`}>{status.label}</span>}
      </header>
      <div className="goal-detail-actions">
        {permitted && (
          <button
            className="button button-primary"
            onClick={() => {
              setCorrection(undefined);
              setMeasure(true);
            }}
          >
            Update measured result
          </button>
        )}
        {q.ready && q.data?.canEdit && (
          <button className="button button-secondary" onClick={() => setEditing(true)}>
            Edit metadata
          </button>
        )}
        {goal.ownerId === w.data?.me.id && permitted && (
          <button className="button button-secondary" onClick={() => setReminders(true)}>
            My reminder preference
          </button>
        )}
        <span className="goal-detail-assist">
          <IntelligenceLauncher
            label="Explain selected goal facts"
            operation="report_explanation"
            choices={
              q.ready
                ? [
                    {
                      label: 'Current selected goal',
                      source: {
                        kind: 'goal_fields',
                        id: goal.id,
                        expectedVersion: goal.version,
                        selectedFieldSet: 'measurement',
                      },
                    },
                    ...(goal.currentMeasurementId
                      ? [
                          {
                            label: 'Recorded measurement',
                            source: {
                              kind: 'goal_measurement' as const,
                              id: goal.currentMeasurementId,
                              parentId: goal.id,
                              selectedFieldSet: 'measurement_evidence',
                            },
                          },
                        ]
                      : []),
                  ]
                : []
            }
          />
        </span>
      </div>
      {q.ready && q.data ? (
        <>
          <dl className="goal-detail-stats">
            <div>
              <dt>Current result</dt>
              <dd>
                {goal.current} <span>{goal.unit}</span>
              </dd>
            </div>
            <div>
              <dt>Baseline</dt>
              <dd>
                {goal.baseline} <span>{goal.unit}</span>
              </dd>
            </div>
            <div>
              <dt>Target</dt>
              <dd>
                {goal.target} <span>{goal.unit}</span>
              </dd>
            </div>
            <div>
              <dt>Attainment</dt>
              <dd>
                {q.data.attainment === null ? 'Unavailable' : q.data.attainment.toFixed(1) + '%'}
              </dd>
            </div>
          </dl>
          <GoalMeter goal={goal} />
          {!goal.currentMeasurementId && (
            <p className="notice">
              Current recorded before measurement history; earlier history unknown.
            </p>
          )}
          {goal.taskIds.length > 0 && (
            <section className="goal-detail-tasks" aria-label="Contributing tasks">
              <h3 className="goal-subhead">
                Contributing tasks <span className="count-badge">{goal.taskIds.length}</span>
              </h3>
              <p className="field-help">
                Context only. Completing these tasks never changes the measured result.
              </p>
              <ul>
                {goal.taskIds.map((id) => {
                  const task = w.data?.tasks.find((t) => t.id === id);
                  return (
                    <li key={id}>
                      <span>{task?.title ?? 'Task'}</span>
                      <button
                        className="button button-secondary button-small"
                        onClick={() => onTask(id)}
                      >
                        Open contributing task
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      ) : q.error ? (
        <div className="inline-error" role="status">
          {q.error.message}
        </div>
      ) : (
        <p role="status" className="goal-detail-loading">
          Authorizing current sources…
        </p>
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
      {reminders && <GoalReminderPreferences goalId={goalId} ready={permitted} />}
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
