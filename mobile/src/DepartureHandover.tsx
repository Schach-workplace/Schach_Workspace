import { businessAttemptGeneration } from "./businessAttempts";
import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useWorkspace } from "./Workspace";
import Page from "./PeoplePage";
import { Action } from "./ConnectUI";
import { useRamInput } from "./ramInput";
import { client } from "./client";
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
} from "./people";
import {
  DiscardPeopleAttempt,
  PeopleField,
  PeopleChoice,
  SessionEffect,
} from "./PeopleControls";
export function DirectCompanyRevocation({ userId }: { userId: string }) {
  const w = useWorkspace();
  const context = usePeopleRead<PeopleContext>("/people/context");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = usePeopleResult<boolean>();
  const person = context.data?.people.find((p) => p.id === userId);
  async function revoke() {
    if (!person) return;
    setBusy(true);
    const generation = client.generation;
    const hardGeneration = businessAttemptGeneration();
    try {
      await client.request(
        "/companies/" + w.company + "/people/" + userId,
        "PATCH",
        { active: false, expectedVersion: person.membershipVersion },
      );
      if (
        generation === client.generation &&
        hardGeneration === businessAttemptGeneration()
      ) {
        setDone(true);
        setConfirmed(false);
        await w.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View>
      <Text accessibilityRole="header">Revoke company access</Text>
      <Text>{directRevocationCopy}</Text>
      <Text accessibilityLiveRegion="polite">
        {error}
        {done ? "Company access revoked. Handover was not performed." : ""}
      </Text>
      <Action
        title="I confirm revocation with responsibilities retained"
        selected={confirmed}
        disabled={!context.ready || busy}
        onPress={() => setConfirmed(!confirmed)}
      />
      <Action
        title="Revoke company access"
        disabled={
          !context.ready ||
          !person?.active ||
          person.id === w.work?.me.id ||
          !confirmed ||
          busy
        }
        onPress={() => void revoke()}
      />
    </View>
  );
}
export default function DepartureHandover({ userId }: { userId: string }) {
  const w = useWorkspace();
  const context = usePeopleRead<PeopleContext>("/people/context");
  const [draft, setDraft, retire] = useRamInput(
    "$people-departure:" + userId,
    "draft",
    () => ({ reason: "", replacements: [] as DepartureReplacement[] }),
  );
  const [view, setView] = useState<{
    basis: string;
    value: DeparturePreview;
  }>();
  const [confirmed, setConfirmed] = useState(false);
  const [stage, setStage] = useState(0);
  const [done, setDone] = usePeopleResult<PeopleResult>();
  const [error, setError] = useState("");
  const action = usePeopleMutation(
    "$people-departure-apply:" + userId,
    (view?.value.liveItems ?? []).flatMap((i) =>
      i.kind.startsWith("task_")
        ? ["/tasks/" + i.sourceId]
        : i.kind.startsWith("milestone_")
          ? ["/project-milestones/" + i.sourceId]
          : i.kind === "project_owner"
            ? ["/projects/" + i.sourceId]
            : i.kind === "goal_owner"
              ? ["/goals/" + i.sourceId]
              : [],
    ),
  );
  const previewAction = usePeopleMutation(
    "$people-departure-preview:" + userId,
  );
  const basis = w.work?.readBasis ?? "";
  const ready = context.ready && w.foreground;
  const current = ready && view?.basis === basis ? view.value : undefined;
  const unknown = action.attempt?.state === "unknown";
  async function preview(empty = false) {
    previewAction.abandon();
    try {
      const value = await previewAction.execute<DeparturePreview>(
        "/people/" + userId + "/departure/preview",
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
        "/people/" + userId + "/departure/apply",
        payload,
        "POST",
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
    <Page>
      <Text accessibilityRole="header">Review company departure</Text>
      <Text>{departureStages.join(" → ")}</Text>
      <Text accessibilityLiveRegion="polite">
        {error || action.error || previewAction.error}
      </Text>
      {!ready && <Text>Checking current company access…</Text>}
      {unknown ? (
        <>
          <Text>
            The original reviewed departure may already have completed.
          </Text>
          <Action
            title="Retry the same submission"
            disabled={!ready || action.busy}
            onPress={() => void apply()}
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
              <Text>Reviewed company departure completed.</Text>
              <SessionEffect effect={done.sessionEffect} />
            </>
          )}
        </>
      ) : (
        <>
          <PeopleField
            label="Departure reason"
            value={draft.reason}
            multiline
            onChange={(reason) => {
              setView(undefined);
              setDraft({ ...draft, reason });
            }}
          />
          <Action
            title="Inspect current obligations"
            disabled={!ready || !draft.reason.trim() || previewAction.busy}
            onPress={() => void preview(true)}
          />
          {current && (
            <>
              <Text accessibilityRole="header">Live responsibilities</Text>
              {current.liveItems.map((item) => (
                <View key={item.kind + item.sourceId}>
                  <Text>
                    {item.title} · {replacementLabel(item.kind)} · {item.state}
                  </Text>
                  <PeopleChoice
                    label={
                      "Replacement for " +
                      item.title +
                      " " +
                      replacementLabel(item.kind)
                    }
                    value={
                      draft.replacements.find(
                        (r) =>
                          r.kind === item.kind && r.sourceId === item.sourceId,
                      )?.newUserId ?? "__choose"
                    }
                    options={[
                      ...(item.allowsNoManager
                        ? [
                            {
                              id: "",
                              name: "No manager — explicit reviewed choice",
                            },
                          ]
                        : []),
                      ...item.candidates,
                    ]}
                    onChange={(newUserId) => {
                      const replacement: DepartureReplacement = {
                        kind: item.kind,
                        sourceId: item.sourceId,
                        expectedVersion: item.version,
                        action: newUserId
                          ? "transfer"
                          : "clear_reporting_manager",
                        newUserId,
                      };
                      setDraft({
                        ...draft,
                        replacements: [
                          ...draft.replacements.filter(
                            (r) =>
                              r.kind !== item.kind ||
                              r.sourceId !== item.sourceId,
                          ),
                          replacement,
                        ],
                      });
                      setStage(1);
                    }}
                  />
                  {item.kind === "expense_review_route" && (
                    <PeopleChoice
                      label={"Review routing for " + item.title}
                      value={
                        draft.replacements.find(
                          (r) =>
                            r.kind === item.kind &&
                            r.sourceId === item.sourceId,
                        )?.action ?? "transfer"
                      }
                      options={[
                        {
                          id: "transfer",
                          name: "Route to selected eligible reviewer",
                        },
                        {
                          id: "retain_current_reviewer",
                          name: "Retain selected existing current reviewer",
                        },
                      ]}
                      onChange={(action) => {
                        setDraft({
                          ...draft,
                          replacements: draft.replacements.map((r) =>
                            r.kind === item.kind && r.sourceId === item.sourceId
                              ? {
                                  ...r,
                                  action:
                                    action as DepartureReplacement["action"],
                                }
                              : r,
                          ),
                        });
                        setStage(1);
                      }}
                    />
                  )}
                </View>
              ))}
              <Text accessibilityRole="header">Retained accepted history</Text>
              <Text>
                {current.retainedHistory.tasks ?? 0} accepted or cancelled tasks
                retain historical ownership and reviewers.
              </Text>
              <Text>
                {current.retainedHistory.milestones ?? 0} accepted milestones
                and {current.retainedHistory.projects ?? 0} completed or
                archived projects remain unchanged.
              </Text>
              {current.unresolved.map((u, i) => (
                <View key={i}>
                  <Text>{u.message}</Text>
                  {u.projectId && (
                    <Action
                      title="Open project for authorized request changes"
                      onPress={() =>
                        router.push({
                          pathname: "/project/[id]",
                          params: { id: u.projectId!, company: w.company },
                        })
                      }
                    />
                  )}
                </View>
              ))}
              <SessionEffect effect={current.sessionEffect} />
              <Action
                title="Review selected replacements"
                disabled={!ready || previewAction.busy}
                onPress={() => void preview()}
              />
              {current.readyToApply && stage >= 2 && (
                <>
                  <Text>
                    Leave this company after transferring the reviewed
                    responsibilities. Existing account sessions will end; other
                    company memberships remain.
                  </Text>
                  <Action
                    title="I confirm the reviewed company departure"
                    selected={confirmed}
                    onPress={() => {
                      setConfirmed(!confirmed);
                      setStage(3);
                    }}
                  />
                  <Action
                    title="Complete company departure"
                    primary
                    disabled={!ready || !confirmed || action.busy}
                    onPress={() => void apply()}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
      <DirectCompanyRevocation userId={userId} />
      <Action title="Back to People" onPress={() => router.back()} />
    </Page>
  );
}
