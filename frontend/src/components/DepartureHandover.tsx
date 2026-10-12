import PeopleProjection from './PeopleProjection';
import { businessAttemptGeneration } from '../data/businessAttempts';
import { useState } from 'react';
import { useWorkspace } from '../store';
import { useExecutionInput } from '../data/executionInput';
import {
  usePeopleEditorBasis,
  usePeopleRead,
  usePeopleMutation,
  usePeopleResult,
  departureStages,
  replacementLabel,
  directRevocationCopy,
  type PeopleContext,
  type DeparturePreview,
  type DepartureReplacement,
  type PeopleResult,
} from '../data/people';
import { Modal, Field, ErrorMessage } from './UI';
import SessionEffect from './SessionEffect';
import GlobalOffboarding from './GlobalOffboarding';
export function DirectCompanyRevocation({ userId }: { userId: string }) {
  const w = useWorkspace();
  const context = usePeopleRead<PeopleContext>('/people/context');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = usePeopleResult<boolean>();
  const person = context.data?.people.find((p) => p.id === userId);
  return (
    <section className="people-danger-zone" aria-label="Revoke company access">
      <h3>Revoke company access</h3>
      <p>{directRevocationCopy}</p>
      {done && (
        <p role="status" className="people-success">
          Company access revoked. Handover was not performed.
        </p>
      )}
      <ErrorMessage error={error} />
      <label className="check-field people-check">
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />I
        confirm revocation with responsibilities retained.
      </label>
      <button
        className="button button-danger"
        disabled={
          !context.ready || !person?.active || person.id === w.data?.me.id || !confirm || w.saving
        }
        onClick={() => {
          if (!person) return;
          const generation = businessAttemptGeneration();
          void w
            .mutate(
              '/people/' + userId,
              { active: false, expectedVersion: person.membershipVersion },
              'PATCH',
              () => {
                if (generation === businessAttemptGeneration()) {
                  setDone(true);
                  setConfirm(false);
                }
              },
            )
            .catch((e) => setError(e.message));
        }}
      >
        Revoke company access
      </button>
    </section>
  );
}
export default function DepartureHandover({
  userId,
  onClose,
  onProject,
}: {
  userId: string;
  onClose: () => void;
  onProject?: (id: string) => void;
}) {
  const w = useWorkspace();
  const context = usePeopleRead<PeopleContext>('/people/context');
  const [draft, setDraft, , retire] = useExecutionInput(
    '$people-departure:' + userId,
    'draft',
    () => ({ reason: '', replacements: [] as DepartureReplacement[] }),
  );
  const [view, setView] = usePeopleResult<{ basis: string; value: DeparturePreview }>();
  const [confirmed, setConfirmed] = useState(false);
  const [stage, setStage] = useState(0);
  const [done, setDone] = usePeopleResult<PeopleResult>();
  const [error, setError] = useState('');
  const action = usePeopleMutation(
    '$people-departure-apply:' + userId,
    (view?.value.liveItems ?? []).flatMap((i) =>
      i.kind.startsWith('task_')
        ? ['/tasks/' + i.sourceId]
        : i.kind.startsWith('milestone_')
          ? ['/project-milestones/' + i.sourceId]
          : i.kind === 'project_owner'
            ? ['/projects/' + i.sourceId]
            : i.kind === 'goal_owner'
              ? ['/goals/' + i.sourceId]
              : [],
    ),
  );
  const previewAction = usePeopleMutation('$people-departure-preview:' + userId);
  const basis = usePeopleEditorBasis(w.data?.readBasis);
  const presented = view?.basis === basis ? view.value : undefined;
  const current = context.ready ? presented : undefined;
  const ready = context.ready && !w.authorizing;
  const unknown = action.attempt?.state === 'unknown';
  async function preview(empty = false) {
    previewAction.abandon();
    try {
      const value = await previewAction.execute<DeparturePreview>(
        '/people/' + userId + '/departure/preview',
        { reason: draft.reason, replacements: empty ? [] : draft.replacements },
      );
      setView({ basis, value });
      setStage(value.readyToApply ? 2 : 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function apply() {
    const payload =
      action.attempt?.payload ??
      (current
        ? {
            previewId: current.id,
            expectedPreviewVersion: current.version,
            confirmCompanyDeparture: true,
          }
        : undefined);
    if (!payload) return;
    try {
      await action.execute<PeopleResult>(
        '/people/' + userId + '/departure/apply',
        payload,
        'POST',
        (r) => {
          retire(draft);
          setDone(r);
        },
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      open
      title="Review company departure"
      description="Inspect live responsibilities, choose replacements, then confirm the departure."
      onClose={onClose}
    >
      <div className="entity-form people-form">
        <ol className="people-stepper" aria-label="Departure stages">
          {departureStages.map((s, i) => (
            <li key={s} aria-current={i === stage ? 'step' : undefined}>
              {s}
            </li>
          ))}
        </ol>
        <ErrorMessage error={error || action.error || previewAction.error} />
        <div
          className="people-checking"
          aria-hidden={ready}
          style={{ visibility: ready ? 'hidden' : 'visible' }}
        >
          <p role="status">Checking current company access…</p>
        </div>
        {unknown ? (
          <section className="people-card people-card-warning">
            <p>
              The original departure may already have completed. Retry its original reviewed
              request.
            </p>
            <div className="people-actions">
              <button
                className="button button-primary"
                disabled={!ready || action.busy}
                onClick={() => void apply()}
              >
                Retry the same submission
              </button>
              <button
                className="button button-secondary"
                onClick={() => {
                  if (
                    window.confirm(
                      'Inspect current departure outcomes before discarding this unknown request.',
                    )
                  )
                    action.abandon();
                }}
              >
                Discard after inspection
              </button>
            </div>
          </section>
        ) : done ? (
          <>
            {ready && (
              <>
                <p role="status" className="people-success">
                  Reviewed company departure completed.
                </p>
                <SessionEffect effect={done.sessionEffect} />
              </>
            )}
          </>
        ) : (
          <>
            <Field label="Departure reason">
              <textarea
                value={draft.reason}
                onChange={(e) => {
                  setView(undefined);
                  setDraft({ ...draft, reason: e.target.value });
                }}
              />
            </Field>
            <div className="people-actions people-actions-start">
              <button
                className={presented ? 'button button-secondary' : 'button button-primary'}
                disabled={!ready || !draft.reason.trim() || previewAction.busy}
                onClick={() => void preview(true)}
              >
                Inspect current obligations
              </button>
            </div>
            {presented && (
              <>
                <h3 className="people-section-title">Live responsibilities</h3>
                {!presented.liveItems.length && (
                  <p className="people-muted">No live responsibilities need a replacement.</p>
                )}
                {presented.liveItems.map((item) => (
                  <fieldset key={item.kind + item.sourceId} className="people-item-card">
                    <legend>
                      <PeopleProjection current={ready}>
                        {item.title} · {replacementLabel(item.kind)}
                      </PeopleProjection>
                    </legend>
                    <PeopleProjection current={ready}>
                      <p className="people-muted">
                        {item.state} · captured version {item.version}
                      </p>
                    </PeopleProjection>
                    <Field label={'Replacement for ' + replacementLabel(item.kind)}>
                      <select
                        aria-disabled={!ready}
                        value={
                          draft.replacements.find(
                            (r) => r.kind === item.kind && r.sourceId === item.sourceId,
                          )?.newUserId ?? '__choose'
                        }
                        onChange={(e) => {
                          if (!ready) return;
                          const empty = e.target.value === '';
                          const replacement: DepartureReplacement = {
                            kind: item.kind,
                            sourceId: item.sourceId,
                            expectedVersion: item.version,
                            action: empty ? 'clear_reporting_manager' : 'transfer',
                            newUserId: e.target.value,
                          };
                          setDraft({
                            ...draft,
                            replacements: [
                              ...draft.replacements.filter(
                                (r) => r.kind !== item.kind || r.sourceId !== item.sourceId,
                              ),
                              replacement,
                            ],
                          });
                          setStage(1);
                        }}
                      >
                        {!ready && (
                          <option
                            value={
                              draft.replacements.find(
                                (r) => r.kind === item.kind && r.sourceId === item.sourceId,
                              )?.newUserId ?? '__choose'
                            }
                          >
                            Checking selected replacement…
                          </option>
                        )}
                        {ready && (
                          <>
                            <option value="__choose" disabled>
                              Choose eligible replacement
                            </option>
                            {item.allowsNoManager && (
                              <option value="">No manager — explicit reviewed choice</option>
                            )}
                            {item.candidates.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} · {p.role}
                              </option>
                            ))}
                          </>
                        )}
                      </select>
                    </Field>
                    {item.kind === 'expense_review_route' && (
                      <Field label="Review routing">
                        <select
                          value={
                            draft.replacements.find(
                              (r) => r.kind === item.kind && r.sourceId === item.sourceId,
                            )?.action ?? 'transfer'
                          }
                          onChange={(e) => {
                            setDraft({
                              ...draft,
                              replacements: draft.replacements.map((r) =>
                                r.kind === item.kind && r.sourceId === item.sourceId
                                  ? {
                                      ...r,
                                      action: e.target.value as DepartureReplacement['action'],
                                    }
                                  : r,
                              ),
                            });
                            setStage(1);
                          }}
                        >
                          <option value="transfer">Route to selected eligible reviewer</option>
                          <option value="retain_current_reviewer">
                            Retain selected existing current reviewer
                          </option>
                        </select>
                      </Field>
                    )}
                  </fieldset>
                ))}
                <PeopleProjection current={ready}>
                  <div className="people-card">
                    <h3 className="people-section-title">Retained accepted history</h3>
                    <p>
                      {presented.retainedHistory.tasks ?? 0} accepted or cancelled tasks keep their
                      historical ownership and reviewers.
                    </p>
                    <p>
                      {presented.retainedHistory.milestones ?? 0} accepted milestones and{' '}
                      {presented.retainedHistory.projects ?? 0} completed or archived projects
                      remain unchanged.
                    </p>
                    {presented.unresolved.map((u, i) => (
                      <p key={i} role="note" className="people-alert">
                        {u.message}
                        {u.projectId && onProject && (
                          <button
                            className="button button-secondary button-small"
                            onClick={() => onProject(u.projectId!)}
                          >
                            Open project for authorized request changes
                          </button>
                        )}
                      </p>
                    ))}
                    <SessionEffect effect={presented.sessionEffect} />
                  </div>
                </PeopleProjection>
                <div className="people-actions">
                  <button
                    className={
                      presented.readyToApply && stage >= 2
                        ? 'button button-secondary'
                        : 'button button-primary'
                    }
                    disabled={!ready || previewAction.busy}
                    onClick={() => void preview()}
                  >
                    Review selected replacements
                  </button>
                </div>
                {presented.readyToApply && stage >= 2 && (
                  <section className="people-card people-card-confirm">
                    <p>
                      Leave this company after transferring the reviewed responsibilities. Existing
                      account sessions will end; other company memberships remain.
                    </p>
                    <label className="check-field people-check">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => {
                          setConfirmed(e.target.checked);
                          setStage(3);
                        }}
                      />
                      I confirm the reviewed company departure.
                    </label>
                    <div className="people-actions">
                      <button
                        className="button button-primary"
                        disabled={!ready || !confirmed || action.busy}
                        onClick={() => void apply()}
                      >
                        Complete company departure
                      </button>
                    </div>
                  </section>
                )}
              </>
            )}
          </>
        )}
        <DirectCompanyRevocation userId={userId} />
        <GlobalOffboarding userId={userId} />
      </div>
    </Modal>
  );
}
