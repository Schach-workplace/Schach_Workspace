import { useEffect, useEffectEvent, useState } from 'react';
import { useWorkspace } from '../store';
import { useExecutionRead, useExecutionMutation } from '../data/execution';
import { useExecutionInput } from '../data/executionInput';
import { Modal } from './UI';
import {
  developmentDraft,
  developmentSubmission,
  learningLines,
} from '../../../shared/growth/drafts';
import type {
  DevelopmentCatalogResult,
  DevelopmentListResult,
  DevelopmentDetailResult,
  DevelopmentPilot,
  DevelopmentPlan,
  DevelopmentFields,
  DevelopmentMutationResult,
} from '../../../shared/growth/types';
import '../styles/development.css';
export default function GrowthHub() {
  const w = useWorkspace();
  return <Home key={[w.companyId, w.session?.user.id, w.data?.readBasis].join(':')} />;
}
function Home() {
  const w = useWorkspace(),
    catalog = useExecutionRead<DevelopmentCatalogResult>('/growth/catalog'),
    list = useExecutionRead<DevelopmentListResult>('/growth/plans');
  const [selected, setSelected] = useState(''),
    [creating, setCreating] = useState(false);
  const refreshPlans = useEffectEvent(() => list.retry());
  useEffect(() => {
    const timer = setInterval(() => refreshPlans(), 15000);
    return () => clearInterval(timer);
  }, []);
  const pilots = catalog.data?.pilots ?? [];
  return (
    <div className="development-hub">
      <header className="development-heading">
        <div>
          <span className="eyebrow">Learning & growth</span>
          <h2>Development plans</h2>
          <p>Clear objectives, deliberate practice and constructive mentor feedback.</p>
        </div>
        {catalog.ready && w.data?.me.role !== 'viewer' && (
          <button className="button button-primary" onClick={() => setCreating(true)}>
            New development plan
          </button>
        )}
      </header>
      <aside className="development-notice">
        Career roles describe learning and never grant application permissions. Plans are visible
        only to their employee owner and currently selected mentor. Leadership does not grant
        access. Task progress never establishes skill attainment or measured outcomes.
      </aside>
      {selected ? (
        <Detail
          id={selected}
          pilots={pilots}
          onBack={() => {
            setSelected('');
            list.retry();
          }}
        />
      ) : (
        <>
          {list.error && <p role="alert">{list.error.message}</p>}
          <button className="text-button" onClick={() => list.retry()}>
            Refresh development plans
          </button>
          <div className="development-grid">
            {list.ready &&
              list.data?.plans.map((p) => (
                <button
                  key={p.id}
                  className="development-card development-link"
                  onClick={() => setSelected(p.id)}
                >
                  <span className="eyebrow">
                    {p.pilot} · {p.state}
                  </span>
                  <h3>{p.title}</h3>
                  <p>
                    {p.careerRole} · {p.careerLevel}
                  </p>
                  <span>Open development plan →</span>
                </button>
              ))}
          </div>
          {list.ready && !list.data?.plans.length && (
            <div className="development-card">
              <h3>No development plans yet</h3>
              <p>
                Start with engineering, office or field competencies. Each plan has an explicit
                audience and your own learning objective.
              </p>
            </div>
          )}
          {!list.ready && !list.error && <p role="status">Checking current development access…</p>}
        </>
      )}
      {creating && !!pilots.length && (
        <Editor
          pilots={pilots}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            setSelected(id);
            list.retry();
          }}
        />
      )}
    </div>
  );
}
function Detail({
  id,
  pilots,
  onBack,
}: {
  id: string;
  pilots: DevelopmentPilot[];
  onBack: () => void;
}) {
  const q = useExecutionRead<DevelopmentDetailResult>('/growth/plans/' + id);
  const [editing, setEditing] = useState(false),
    [reviewing, setReviewing] = useState(false);
  const refreshPlan = useEffectEvent(() => q.retry());
  useEffect(() => {
    const timer = setInterval(() => refreshPlan(), 15000);
    return () => clearInterval(timer);
  }, []);
  const d = q.ready ? q.data : undefined;
  return (
    <section>
      <button className="text-button" onClick={onBack}>
        ← Development plans
      </button>
      {!d ? (
        <p role="status">{q.error?.message || 'Checking current plan access…'}</p>
      ) : (
        <>
          <div className="development-heading">
            <div>
              <h2>{d.plan.title}</h2>
              <p>
                {d.plan.careerRole} · {d.plan.careerLevel} · {d.plan.state}
              </p>
            </div>
            <div className="development-actions">
              {d.canEdit && !!pilots.length && (
                <button className="button button-secondary" onClick={() => setEditing(true)}>
                  Edit development plan
                </button>
              )}
              {d.canReview && (
                <button className="button button-primary" onClick={() => setReviewing(true)}>
                  Add mentor feedback
                </button>
              )}
            </div>
          </div>
          <div className="development-grid">
            <section className="development-card">
              <h3>Development objective</h3>
              <p>{d.plan.objective}</p>
              <p>Competencies: {d.plan.competencyIds.join(', ')}</p>
              <small>
                Audience: employee owner{d.plan.mentorId ? ' and current mentor' : ' only'}.
              </small>
            </section>
            <section className="development-card">
              <h3>Learning actions</h3>
              <ol>
                {d.plan.learningActions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ol>
              <h3>Employee evidence note</h3>
              <p className="development-prose">
                {d.plan.evidenceNote || 'No evidence note published.'}
              </p>
            </section>
          </div>
          <h3>Mentor feedback</h3>
          {!d.reviews.length && <p>No mentor feedback yet.</p>}
          {d.reviews.map((r) => (
            <article key={r.id} className="development-card">
              <p className="development-prose">{r.feedback}</p>
              <p>
                <strong>Next step:</strong> {r.nextStep}
              </p>
              <small>
                Recorded at plan version {r.planVersion} · {r.createdAt}
              </small>
            </article>
          ))}
          {editing && d.canEdit && (
            <Editor
              plan={d.plan}
              pilots={pilots}
              onClose={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                q.retry();
              }}
            />
          )}
          {reviewing && d.canReview && (
            <Review
              plan={d.plan}
              onClose={() => setReviewing(false)}
              onSaved={() => {
                setReviewing(false);
                q.retry();
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
function Editor({
  plan: latestPlan,
  pilots,
  onClose,
  onSaved,
}: {
  plan?: DevelopmentPlan;
  pilots: DevelopmentPilot[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const w = useWorkspace(),
    form = '$growth:' + (latestPlan?.id ?? 'new') + ':edit';
  const [authored, setAuthored, _prefill, retireAuthored] = useExecutionInput<{
    source: DevelopmentPlan | undefined;
    fields: DevelopmentFields;
    learning: string;
  }>(form, 'boundDraft', () => ({
    source: latestPlan,
    fields: developmentDraft(
      pilots.find((p) => p.id === latestPlan?.pilot) ?? pilots[0],
      latestPlan,
    ),
    learning: latestPlan?.learningActions.join('\n') ?? '',
  }));
  const { source: plan, fields: draft, learning } = authored;
  const setDraft = (
    update: DevelopmentFields | ((fields: DevelopmentFields) => DevelopmentFields),
  ) =>
    setAuthored((d) => ({
      ...d,
      fields: typeof update === 'function' ? update(d.fields) : update,
    }));
  const setLearning = (learning: string) => setAuthored((d) => ({ ...d, learning }));
  const action = useExecutionMutation(form, plan ? ['/growth/plans/' + plan.id] : []);
  const shown = developmentSubmission(draft, action.attempt),
    locked = action.busy || !!action.attempt;
  const [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState('');
  const pilot = pilots.find((p) => p.id === shown.pilot)!;
  const set = (key: keyof DevelopmentFields, value: unknown) => {
    setConfirmed(false);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const mentor =
    w.data?.people.find((p) => p.id === shown.mentorId)?.name ??
    (shown.mentorId ? 'Previously selected mentor' : 'Only you');
  async function save() {
    if (!confirmed && !action.attempt) return;
    try {
      setAuthored(authored);
      const { state, ...create } = { ...draft, learningActions: learningLines(learning) };
      const r = await action.execute<DevelopmentMutationResult>(
        '/growth/plans' + (plan ? '/' + plan.id : ''),
        action.attempt?.payload ??
          (plan
            ? { ...draft, learningActions: learningLines(learning), expectedVersion: plan.version }
            : create),
        plan ? 'PATCH' : 'POST',
        () => retireAuthored(authored),
      );
      retireAuthored(authored);
      onSaved(r.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!action.busy) onClose();
      }}
      title={plan ? 'Edit development plan' : 'New development plan'}
      description="Review the plan and audience before saving."
      wide
    >
      <form
        className="development-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {!plan && (
          <label>
            Development pilot
            <select
              value={shown.pilot}
              disabled={locked}
              onChange={(e) => {
                setConfirmed(false);
                setDraft(developmentDraft(pilots.find((p) => p.id === e.target.value)!));
                setLearning('');
              }}
            >
              {pilots.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Plan title
          <input
            value={shown.title}
            disabled={locked}
            onChange={(e) => set('title', e.target.value)}
            maxLength={160}
          />
        </label>
        <label>
          Career role (does not grant permissions)
          <input
            value={shown.careerRole}
            disabled={locked}
            onChange={(e) => set('careerRole', e.target.value)}
            maxLength={120}
          />
        </label>
        <label>
          Career level
          <select
            value={shown.careerLevel}
            disabled={locked}
            onChange={(e) => set('careerLevel', e.target.value)}
          >
            {pilot.levels.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <fieldset disabled={locked}>
          <legend>Development competencies</legend>
          {pilot.competencies.map((c) => (
            <label className="development-check" key={c.id}>
              <input
                type="checkbox"
                checked={shown.competencyIds.includes(c.id)}
                onChange={() =>
                  set(
                    'competencyIds',
                    shown.competencyIds.includes(c.id)
                      ? shown.competencyIds.filter((id) => id !== c.id)
                      : [...shown.competencyIds, c.id],
                  )
                }
              />
              {c.label}
            </label>
          ))}
        </fieldset>
        <label>
          Development objective
          <textarea
            value={shown.objective}
            disabled={locked}
            onChange={(e) => set('objective', e.target.value)}
            maxLength={4000}
          />
        </label>
        <p>Suggested learning: {pilot.suggestedLearning.join(' · ')}</p>
        <label>
          Learning actions (one per line)
          <textarea
            value={action.attempt ? shown.learningActions.join('\n') : learning}
            disabled={locked}
            onChange={(e) => {
              setConfirmed(false);
              setLearning(e.target.value);
            }}
          />
        </label>
        <label>
          Evidence note shared with your mentor
          <textarea
            value={shown.evidenceNote}
            disabled={locked}
            onChange={(e) => set('evidenceNote', e.target.value)}
            maxLength={8000}
          />
        </label>
        <label>
          Development mentor
          <select
            value={shown.mentorId}
            disabled={locked}
            onChange={(e) => set('mentorId', e.target.value)}
          >
            <option value="">Only you</option>
            {w.data?.people
              .filter((p) => p.active && p.role !== 'viewer' && p.id !== w.session?.user.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        {plan && (
          <label>
            Plan state
            <select
              value={shown.state}
              disabled={locked}
              onChange={(e) => set('state', e.target.value)}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        )}
        <aside className="development-notice">
          <strong>Plan audience: {mentor}</strong>
          <p>
            Saving publishes the objective, learning actions and evidence note to this audience.
            Include only information you intend to share. No private conversations are copied
            automatically.
          </p>
        </aside>
        {!action.attempt && (
          <label className="development-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={action.busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed this plan and audience
          </label>
        )}
        {action.attempt && (
          <p role="status">
            Result unknown. The original plan, audience and retry identity are frozen.
          </p>
        )}
        {(error || action.error) && <p role="alert">{error || action.error}</p>}
        <button
          className="button button-primary"
          disabled={action.busy || (!confirmed && !action.attempt)}
        >
          {action.attempt ? 'Retry original plan submission' : 'Save development plan'}
        </button>
        {action.attempt && (
          <button
            type="button"
            className="button button-secondary"
            disabled={action.busy}
            onClick={() => {
              action.abandon();
              retireAuthored(authored);
              setConfirmed(false);
              setError('');
            }}
          >
            Discard attempt and review current plan
          </button>
        )}
      </form>
    </Modal>
  );
}
function Review({
  plan: latestPlan,
  onClose,
  onSaved,
}: {
  plan: DevelopmentPlan;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = '$growth:' + latestPlan.id + ':review',
    action = useExecutionMutation(form, ['/growth/plans/' + latestPlan.id]);
  const [authored, setAuthored, _prefill, retireAuthored] = useExecutionInput(
    form,
    'boundDraft',
    () => ({
      source: latestPlan,
      fields: { feedback: '', nextStep: '' },
    }),
  );
  const { source: plan, fields: draft } = authored;
  const setDraft = (update: (fields: typeof draft) => typeof draft) =>
    setAuthored((d) => ({ ...d, fields: update(d.fields) }));
  const shown = (action.attempt?.payload as typeof draft | undefined) ?? draft;
  async function save() {
    try {
      setAuthored(authored);
      await action.execute(
        '/growth/plans/' + plan.id + '/reviews',
        action.attempt?.payload ?? { ...draft, expectedVersion: plan.version },
        'POST',
        () => retireAuthored(authored),
      );
      retireAuthored(authored);
      onSaved();
    } catch {}
  }
  return (
    <Modal
      open
      title="Mentor feedback"
      onClose={() => {
        if (!action.busy) onClose();
      }}
    >
      <form
        className="development-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p>
          {plan.title} · reviewed version {plan.version} · Employee {plan.ownerId} · Mentor{' '}
          {plan.mentorId}
        </p>
        <p>
          {plan.careerRole} · {plan.careerLevel} · Competencies: {plan.competencyIds.join(', ')}
        </p>
        <p>{plan.objective}</p>
        <ol>
          {plan.learningActions.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
        <p>{plan.evidenceNote}</p>
        <p>
          Share constructive observations and a next step with the employee. This does not approve
          tasks, measure a business goal or change career or permission roles.
        </p>
        <label>
          Mentor observations
          <textarea
            value={shown.feedback}
            disabled={action.busy || !!action.attempt}
            onChange={(e) => setDraft((d) => ({ ...d, feedback: e.target.value }))}
          />
        </label>
        <label>
          Next development step
          <textarea
            value={shown.nextStep}
            disabled={action.busy || !!action.attempt}
            onChange={(e) => setDraft((d) => ({ ...d, nextStep: e.target.value }))}
          />
        </label>
        {action.error && <p role="alert">{action.error}</p>}
        <button
          className="button button-primary"
          disabled={action.busy || !shown.feedback.trim() || !shown.nextStep.trim()}
        >
          {action.attempt ? 'Retry original mentor feedback' : 'Publish mentor feedback'}
        </button>
        {action.attempt && (
          <button
            type="button"
            className="button button-secondary"
            disabled={action.busy}
            onClick={() => {
              action.abandon();
              retireAuthored(authored);
            }}
          >
            Discard feedback attempt and review latest
          </button>
        )}
      </form>
    </Modal>
  );
}
