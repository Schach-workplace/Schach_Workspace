import { businessAttemptGeneration } from '../data/businessAttempts';
import { useState } from 'react';
import { useWorkspace } from '../store';
import { useExecutionInput } from '../data/executionInput';
import {
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
export function DirectCompanyRevocation({ userId }: { userId: string }) {
  const w = useWorkspace();
  const context = usePeopleRead<PeopleContext>('/people/context');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = usePeopleResult<boolean>();
  const person = context.data?.people.find((p) => p.id === userId);
  return (
    <section>
      <h3>Revoke company access</h3>
      <p>{directRevocationCopy}</p>
      {done && <p role="status">Company access revoked. Handover was not performed.</p>}
      <ErrorMessage error={error} />
      <label>
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
  const [view, setView] = useState<{ basis: string; value: DeparturePreview }>();
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
  const basis = w.data?.readBasis ?? '';
  const current = context.ready && view?.basis === basis ? view.value : undefined;
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
    <Modal open title="Review company departure" onClose={onClose}>
      <div className="entity-form people-form">
        <ol aria-label="Departure stages">
          {departureStages.map((s, i) => (
            <li key={s} aria-current={i === stage ? 'step' : undefined}>
              {s}
            </li>
          ))}
        </ol>
        <ErrorMessage error={error || action.error || previewAction.error} />
        {!ready && <p role="status">Checking current company access…</p>}
        {unknown ? (
          <>
            <p>
              The original departure may already have completed. Retry its original reviewed
              request.
            </p>
            <button
              className="button button-primary"
              disabled={!ready || action.busy}
              onClick={() => void apply()}
            >
              Retry the same submission
            </button>
            <button
              className="button"
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
          </>
        ) : done ? (
          <>
            {ready && (
              <>
                <p role="status">Reviewed company departure completed.</p>
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
            <button
              className="button"
              disabled={!ready || !draft.reason.trim() || previewAction.busy}
              onClick={() => void preview(true)}
            >
              Inspect current obligations
            </button>
            {current && (
              <>
                <h3>Live responsibilities</h3>
                {current.liveItems.map((item) => (
                  <fieldset key={item.kind + item.sourceId}>
                    <legend>
                      {item.title} · {replacementLabel(item.kind)}
                    </legend>
                    <p>
                      {item.state} · captured version {item.version}
                    </p>
                    <Field
                      label={'Replacement for ' + item.title + ' ' + replacementLabel(item.kind)}
                    >
                      <select
                        value={
                          draft.replacements.find(
                            (r) => r.kind === item.kind && r.sourceId === item.sourceId,
                          )?.newUserId ?? '__choose'
                        }
                        onChange={(e) => {
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
                      </select>
                    </Field>
                    {item.kind === 'expense_review_route' && (
                      <Field label={'Review routing for ' + item.title}>
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
                <h3>Retained accepted history</h3>
                <p>
                  {current.retainedHistory.tasks ?? 0} accepted or cancelled tasks keep their
                  historical ownership and reviewers.
                </p>
                <p>
                  {current.retainedHistory.milestones ?? 0} accepted milestones and{' '}
                  {current.retainedHistory.projects ?? 0} completed or archived projects remain
                  unchanged.
                </p>
                {current.unresolved.map((u, i) => (
                  <p key={i} role="note">
                    {u.message}
                    {u.projectId && onProject && (
                      <button className="button" onClick={() => onProject(u.projectId!)}>
                        Open project for authorized request changes
                      </button>
                    )}
                  </p>
                ))}
                <SessionEffect effect={current.sessionEffect} />
                <button
                  className="button"
                  disabled={!ready || previewAction.busy}
                  onClick={() => void preview()}
                >
                  Review selected replacements
                </button>
                {current.readyToApply && stage >= 2 && (
                  <>
                    <p>
                      Leave this company after transferring the reviewed responsibilities. Existing
                      account sessions will end; other company memberships remain.
                    </p>
                    <label>
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
                    <button
                      className="button button-primary"
                      disabled={!ready || !confirmed || action.busy}
                      onClick={() => void apply()}
                    >
                      Complete company departure
                    </button>
                  </>
                )}
              </>
            )}
          </>
        )}
        <DirectCompanyRevocation userId={userId} />
      </div>
    </Modal>
  );
}
