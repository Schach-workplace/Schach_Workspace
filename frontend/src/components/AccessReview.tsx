import PeopleProjection from './PeopleProjection';
import { useState } from 'react';
import { useWorkspace } from '../store';
import { useExecutionInput } from '../data/executionInput';
import {
  usePeopleEditorBasis,
  usePeopleRowIDs,
  usePeopleRead,
  usePeopleMutation,
  usePeopleResult,
  initialDecisions,
  directRevocationCopy,
  type PeopleContext,
  type AccessReviewView,
  type ReviewDecision,
} from '../data/people';
import { Modal, Field, ErrorMessage } from './UI';
import MembershipFields from './PeopleMembershipFields';
import SessionEffect from './SessionEffect';
export default function AccessReview({ onClose }: { onClose: () => void }) {
  const w = useWorkspace();
  const context = usePeopleRead<PeopleContext>('/people/context');
  const history = usePeopleRead<{ items: AccessReviewView[] }>('/people/access-reviews');
  const [draft, setDraft, , retire] = useExecutionInput('$people-review', 'draft', () => ({
    reason: '',
    decisions: [] as ReviewDecision[],
  }));
  const [search, setSearch] = useState('');
  const [review, setReview] = usePeopleResult<{ basis: string; value: AccessReviewView }>();
  const [done, setDone] = usePeopleResult<AccessReviewView>();
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const previewAction = usePeopleMutation('$people-review-preview');
  const action = usePeopleMutation('$people-review-complete');
  const basis = usePeopleEditorBasis(w.data?.readBasis);
  const current = context.ready && review?.basis === basis ? review.value : undefined;
  const ready = context.ready && !w.authorizing;
  const visibleIDs = usePeopleRowIDs(
    context.data?.people
      .filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(search.toLowerCase()))
      .map((p) => p.id),
    basis,
  );
  const unknown = action.attempt?.state === 'unknown';
  const update = (uid: string, change: Partial<ReviewDecision>) => {
    setReview(undefined);
    setDraft({
      ...draft,
      decisions: draft.decisions.map((d) => (d.userId === uid ? { ...d, ...change } : d)),
    });
  };
  async function preview() {
    previewAction.abandon();
    try {
      const value = await previewAction.execute<AccessReviewView>(
        '/people/access-reviews/preview',
        draft,
      );
      setReview({ basis, value });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function complete() {
    const payload =
      action.attempt?.payload ??
      (current
        ? { previewId: current.previewId, expectedReviewVersion: current.version }
        : undefined);
    const path =
      action.attempt?.target?.path ??
      (current ? '/people/access-reviews/' + current.id + '/complete' : '');
    if (!payload || !path) return;
    try {
      await action.execute<AccessReviewView>(path, payload, 'POST', (r) => {
        retire(draft);
        setDone(r);
      });
      await history.retry();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal open title="Review company access" onClose={onClose}>
      <div className="entity-form people-form">
        <ErrorMessage error={error || action.error || previewAction.error} />
        <div aria-hidden={ready} style={{ visibility: ready ? 'hidden' : 'visible' }}>
          <p role="status">Checking current company authority…</p>
        </div>
        {unknown ? (
          <>
            <p>Completion may already have succeeded. Retry the original captured review.</p>
            <button
              className="button button-primary"
              disabled={!ready || action.busy}
              onClick={() => void complete()}
            >
              Retry the same submission
            </button>
            <button
              className="button"
              onClick={() => {
                if (
                  window.confirm(
                    'Inspect current access-review history before discarding this unknown request.',
                  )
                )
                  action.abandon();
              }}
            >
              Discard after inspecting history
            </button>
          </>
        ) : done ? (
          <>
            {ready && (
              <>
                <p role="status">Access attestation completed. Handover is recorded separately.</p>
                {done.decisions.map((d) => (
                  <p key={d.userId}>
                    {context.data?.people.find((p) => p.id === d.userId)?.name ?? 'Company member'}:{' '}
                    {d.accessOutcome}; handover {d.handoverStatus}
                  </p>
                ))}
                <SessionEffect effect={done.sessionEffect} />
                <button
                  className="button"
                  onClick={() => {
                    setDone(undefined);
                    setReview(undefined);
                  }}
                >
                  Start another review
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <button
              className="button"
              disabled={!ready}
              onClick={() => {
                setReview(undefined);
                setDraft({
                  reason: draft.reason,
                  decisions: initialDecisions(context.data!.people),
                });
              }}
            >
              Capture current company memberships
            </button>
            <Field label="Review reason">
              <textarea
                value={draft.reason}
                onChange={(e) => {
                  setReview(undefined);
                  setDraft({ ...draft, reason: e.target.value });
                }}
              />
            </Field>
            <Field label="Filter reviewed members">
              <input value={search} onChange={(e) => setSearch(e.target.value)} />
            </Field>
            {draft.decisions.map((d) => {
              const p = context.data?.people.find((p) => p.id === d.userId);
              if (!visibleIDs.includes(d.userId)) return null;
              return (
                <fieldset key={d.userId}>
                  <legend>
                    <PeopleProjection current={ready}>
                      {p?.name} · {p?.role}
                    </PeopleProjection>
                  </legend>
                  <Field label="Access decision">
                    <select
                      aria-label={ready && p ? 'Access decision for ' + p.name : 'Access decision'}
                      disabled={!ready}
                      value={d.action}
                      onChange={(e) =>
                        update(d.userId, {
                          action: e.target.value as ReviewDecision['action'],
                          fields:
                            e.target.value === 'change' && p
                              ? {
                                  role: p.role,
                                  departmentId: p.departmentId,
                                  managerId: p.managerId,
                                  title: p.title,
                                  capacityHours: p.capacityHours,
                                }
                              : undefined,
                        })
                      }
                    >
                      <option value="keep">Keep access</option>
                      <option value="change">Change reviewed access</option>
                      <option value="departure_required">Departure follow-up required</option>
                      <option value="revoke_access">Revoke company access</option>
                    </select>
                  </Field>
                  {d.action === 'change' && (
                    <MembershipFields
                      context={context.data}
                      disabled={!ready}
                      value={{
                        role: 'member',
                        departmentId: '',
                        managerId: '',
                        title: '',
                        capacityHours: 40,
                        ...d.fields,
                      }}
                      onChange={(fields) => update(d.userId, { fields })}
                    />
                  )}
                </fieldset>
              );
            })}
            <p>Filtered members remain in the complete captured review.</p>
            {draft.decisions.some((d) => d.action === 'revoke_access') && (
              <>
                <p>{directRevocationCopy}</p>
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  I confirm the explicit company access revocations.
                </label>
              </>
            )}
            <button
              className="button"
              disabled={
                !ready || previewAction.busy || !draft.reason.trim() || draft.decisions.length === 0
              }
              onClick={() => void preview()}
            >
              Preview access decisions
            </button>
            {current && (
              <>
                <p>
                  Review captured at version {current.version}. Pending departures do not certify a
                  completed handover.
                </p>
                <SessionEffect effect={current.sessionEffect} />
                <button
                  className="button button-primary"
                  disabled={
                    !ready ||
                    action.busy ||
                    (draft.decisions.some((d) => d.action === 'revoke_access') && !confirmed)
                  }
                  onClick={() => void complete()}
                >
                  Complete access attestation
                </button>
              </>
            )}
          </>
        )}
        {history.ready && (
          <section>
            <h3>Review history</h3>
            {history.data?.items.map((r) => (
              <p key={r.id}>
                {r.reason} · {r.state} · {r.completedAt || r.createdAt}
              </p>
            ))}
          </section>
        )}
      </div>
    </Modal>
  );
}
