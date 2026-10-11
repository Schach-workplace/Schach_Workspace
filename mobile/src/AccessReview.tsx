import { useState } from "react";
import { Text, View } from "react-native";
import { useWorkspace } from "./Workspace";
import Page from "./PeoplePage";
import { Action } from "./ConnectUI";
import { useRamInput } from "./ramInput";
import {
  usePeopleRead,
  usePeopleMutation,
  usePeopleResult,
  initialDecisions,
  directRevocationCopy,
  type PeopleContext,
  type AccessReviewView,
  type ReviewDecision,
} from "./people";
import {
  DiscardPeopleAttempt,
  PeopleField,
  PeopleChoice,
  PeopleMembershipFields,
  SessionEffect,
} from "./PeopleControls";
export default function AccessReview() {
  const w = useWorkspace();
  const context = usePeopleRead<PeopleContext>("/people/context");
  const history = usePeopleRead<{ items: AccessReviewView[] }>(
    "/people/access-reviews",
  );
  const [draft, setDraft, retire] = useRamInput(
    "$people-review",
    "draft",
    () => ({ reason: "", decisions: [] as ReviewDecision[] }),
  );
  const [search, setSearch] = useState("");
  const [review, setReview] = useState<{
    basis: string;
    value: AccessReviewView;
  }>();
  const [done, setDone] = usePeopleResult<AccessReviewView>();
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const previewAction = usePeopleMutation("$people-review-preview");
  const action = usePeopleMutation("$people-review-complete");
  const basis = w.work?.readBasis ?? "";
  const ready = context.ready && w.foreground;
  const current = ready && review?.basis === basis ? review.value : undefined;
  const unknown = action.attempt?.state === "unknown";
  function update(uid: string, change: Partial<ReviewDecision>) {
    setReview(undefined);
    setDraft({
      ...draft,
      decisions: draft.decisions.map((d) =>
        d.userId === uid ? { ...d, ...change } : d,
      ),
    });
  }
  async function preview() {
    previewAction.abandon();
    try {
      const value = await previewAction.execute<AccessReviewView>(
        "/people/access-reviews/preview",
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
        ? {
            previewId: current.previewId,
            expectedReviewVersion: current.version,
          }
        : undefined);
    const path =
      action.attempt?.target?.path ??
      (current ? "/people/access-reviews/" + current.id + "/complete" : "");
    if (!payload || !path) return;
    try {
      await action.execute<AccessReviewView>(path, payload, "POST", (value) => {
        retire(draft);
        setDone(value);
      });
      history.retry();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Page>
      <Text accessibilityRole="header">Review company access</Text>
      <Text accessibilityLiveRegion="polite">
        {error || action.error || previewAction.error}
      </Text>
      {!ready && <Text>Checking current company authority…</Text>}
      {unknown ? (
        <>
          <Text>The captured completion may already have succeeded.</Text>
          <Action
            title="Retry the same submission"
            disabled={!ready || action.busy}
            onPress={() => void complete()}
          />
          <DiscardPeopleAttempt
            disabled={action.busy}
            onDiscard={() => {
              action.abandon();
              setError("");
            }}
          />
        </>
      ) : done ? (
        <>
          {ready && (
            <>
              <Text>
                Access attestation completed. Handover is recorded separately.
              </Text>
              {done.decisions.map((d) => (
                <Text key={d.userId}>
                  {context.data?.people.find((p) => p.id === d.userId)?.name ??
                    "Company member"}
                  : {d.accessOutcome}; handover {d.handoverStatus}
                </Text>
              ))}
              <SessionEffect effect={done.sessionEffect} />
              <Action
                title="Start another review"
                onPress={() => {
                  setDone(undefined);
                  setReview(undefined);
                }}
              />
            </>
          )}
        </>
      ) : (
        <>
          <Action
            title="Capture current company memberships"
            disabled={!ready}
            onPress={() => {
              setReview(undefined);
              setDraft({
                reason: draft.reason,
                decisions: initialDecisions(context.data!.people),
              });
            }}
          />
          <PeopleField
            label="Review reason"
            value={draft.reason}
            onChange={(reason) => {
              setReview(undefined);
              setDraft({ ...draft, reason });
            }}
            multiline
          />
          <PeopleField
            label="Filter reviewed members"
            value={search}
            onChange={setSearch}
          />
          {ready &&
            draft.decisions.map((d) => {
              const p = context.data!.people.find((p) => p.id === d.userId);
              if (
                !p ||
                !`${p.name} ${p.email}`
                  .toLowerCase()
                  .includes(search.toLowerCase())
              )
                return null;
              return (
                <View key={p.id}>
                  <Text>
                    {p.name} · {p.role}
                  </Text>
                  <PeopleChoice
                    label={"Access decision for " + p.name}
                    value={d.action}
                    options={[
                      { id: "keep", name: "Keep access" },
                      { id: "change", name: "Change reviewed access" },
                      {
                        id: "departure_required",
                        name: "Departure follow-up required",
                      },
                      { id: "revoke_access", name: "Revoke company access" },
                    ]}
                    onChange={(action) =>
                      update(p.id, {
                        action: action as ReviewDecision["action"],
                        fields: undefined,
                      })
                    }
                  />
                  {d.action === "change" && (
                    <PeopleMembershipFields
                      context={context.data}
                      value={{
                        role: p.role,
                        departmentId: p.departmentId,
                        managerId: p.managerId,
                        title: p.title,
                        capacityHours: p.capacityHours,
                        ...d.fields,
                      }}
                      onChange={(fields) => update(p.id, { fields })}
                    />
                  )}
                </View>
              );
            })}
          <Text>Filtered members remain in the complete captured review.</Text>
          {draft.decisions.some((d) => d.action === "revoke_access") && (
            <>
              <Text>{directRevocationCopy}</Text>
              <Action
                title="I confirm the explicit company access revocations"
                selected={confirmed}
                onPress={() => setConfirmed(!confirmed)}
              />
            </>
          )}
          <Action
            title="Preview access decisions"
            disabled={
              !ready ||
              previewAction.busy ||
              !draft.reason.trim() ||
              draft.decisions.length === 0
            }
            onPress={() => void preview()}
          />
          {current && (
            <>
              <Text>
                Captured review version {current.version}. Pending departures do
                not certify a completed handover.
              </Text>
              <SessionEffect effect={current.sessionEffect} />
              <Action
                title="Complete access attestation"
                primary
                disabled={
                  !ready ||
                  action.busy ||
                  (draft.decisions.some((d) => d.action === "revoke_access") &&
                    !confirmed)
                }
                onPress={() => void complete()}
              />
            </>
          )}
        </>
      )}
      {history.ready && (
        <>
          <Text accessibilityRole="header">Review history</Text>
          {history.data?.items.map((r) => (
            <Text key={r.id}>
              {r.reason} · {r.state} · {r.completedAt || r.createdAt}
            </Text>
          ))}
        </>
      )}
    </Page>
  );
}
