import PeopleProjection from "./PeopleProjection";
import { businessAttemptGeneration } from "./businessAttempts";
import { onboardingTaskReview } from "../../shared/people/taskReview";
import DeadlinePicker from "./DeadlinePicker";
import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useWorkspace } from "./Workspace";
import Page from "./PeoplePage";
import { Action } from "./ConnectUI";
import { useRamInput } from "./ramInput";
import {
  usePeopleEditorBasis,
  usePeopleRead,
  usePeopleMutation,
  usePeopleResult,
  emptyOnboarding,
  onboardingStages,
  privateInviteCopy,
  type PeopleContext,
  type PeoplePreset,
  type OnboardingPreview,
  type PeopleResult,
} from "./people";
import {
  DiscardPeopleAttempt,
  PeopleField,
  PeopleChoice,
  PeopleMembershipFields,
  SessionEffect,
} from "./PeopleControls";
import type {
  TaskTemplateView,
  ExecutionProject,
} from "../../shared/business/types";
export default function PeopleOnboarding() {
  const w = useWorkspace();
  const context = usePeopleRead<PeopleContext>("/people/context");
  const presets = usePeopleRead<{ items: PeoplePreset[] }>("/people/presets");
  const templates = usePeopleRead<{ templates: TaskTemplateView[] }>(
    "/task-templates",
  );
  const projects = usePeopleRead<{ projects: ExecutionProject[] }>("/projects");
  const [draft, setDraft, retire] = useRamInput(
    "$people-onboard",
    "intent",
    emptyOnboarding,
  );
  const [stage, setStage] = useState(0);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{
    basis: string;
    value: OnboardingPreview;
  }>();
  const [done, setDone] = usePeopleResult<PeopleResult>();
  const previewAction = usePeopleMutation("$people-onboard-preview");
  const action = usePeopleMutation(
    "$people-onboard-apply",
    draft.tasks.flatMap((t) => [
      "/task-templates/" + t.templateId,
      ...(t.projectId ? ["/projects/" + t.projectId] : []),
    ]),
  );
  const basis = usePeopleEditorBasis(w.work?.readBasis);
  const ready = context.ready && w.foreground;
  const presented = preview?.basis === basis ? preview.value : undefined;
  const current = ready ? presented : undefined;
  const unknown = action.attempt?.state === "unknown";
  const passwordScope =
    businessAttemptGeneration() +
    ":" +
    basis +
    ":" +
    w.company +
    ":" +
    w.session?.user.id;
  const [capturedPasswordScope, setCapturedPasswordScope] =
    useState(passwordScope);
  if (capturedPasswordScope !== passwordScope) {
    setCapturedPasswordScope(passwordScope);
    setPassword("");
    setPreview(undefined);
  }
  async function inspect() {
    previewAction.abandon();
    try {
      const value = await previewAction.execute<OnboardingPreview>(
        "/people/onboarding/preview",
        draft as unknown as Record<string, unknown>,
      );
      setPreview({ basis, value });
      setStage(3);
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
            ...(current.accountMode === "new_account" ? { password } : {}),
          }
        : undefined);
    if (!payload) return;
    try {
      const pending = action.execute<PeopleResult>(
        "/people/onboarding/apply",
        payload,
        "POST",
        (value) => {
          setPassword("");
          retire(draft);
          setDone(value);
          setStage(4);
        },
      );
      setPassword("");
      await pending;
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Page>
      <Text accessibilityRole="header">Add person</Text>
      <Text>{onboardingStages.join(" → ")}</Text>
      <View
        accessibilityElementsHidden={ready}
        importantForAccessibility={ready ? "no-hide-descendants" : "auto"}
        style={{ opacity: ready ? 0 : 1 }}
      >
        <Text>Checking current company access…</Text>
      </View>
      <Text accessibilityLiveRegion="polite">
        {error || action.error || previewAction.error}
      </Text>
      {unknown ? (
        <View>
          <Text>
            Submitted request: its original preview, password, version and
            action key remain frozen while the result is unknown.
          </Text>
          <PeopleField
            label="Submitted preview version"
            value={String(action.attempt?.payload.expectedPreviewVersion ?? "")}
            onChange={() => {}}
            disabled
          />
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
        </View>
      ) : stage === 4 ? (
        <View>
          {ready && done && (
            <>
              <Text>Company onboarding completed.</Text>
              <SessionEffect effect={done.sessionEffect} />
              <Action
                title="Open current People"
                onPress={() =>
                  router.replace({
                    pathname: "/people",
                    params: { company: w.company },
                  })
                }
              />
            </>
          )}
        </View>
      ) : (
        <>
          <View style={stage === 0 ? undefined : { display: "none" }}>
            <PeopleField
              label="Name"
              value={draft.name}
              onChange={(name) => setDraft({ ...draft, name })}
            />
            <PeopleField
              label="Email"
              value={draft.email}
              onChange={(email) => setDraft({ ...draft, email })}
            />
            <Action
              title="Continue to access"
              disabled={
                !ready || !draft.name.trim() || !draft.email.includes("@")
              }
              onPress={() => setStage(1)}
            />
          </View>
          <View style={stage === 1 ? undefined : { display: "none" }}>
            <PeopleChoice
              label="Onboarding preset"
              value={draft.presetId ?? ""}
              options={
                presets.ready
                  ? [
                      { id: "", name: "Manual access choices" },
                      ...presets.data!.items.filter((p) => !p.archived),
                    ]
                  : []
              }
              disabled={!ready}
              onChange={(id) => {
                const p = presets.data?.items.find((p) => p.id === id);
                setDraft({
                  ...draft,
                  presetId: p?.id,
                  expectedPresetVersion: p?.version,
                  membership: p?.membership ?? draft.membership,
                  tasks: p
                    ? p.templateIds.map((templateId) => ({
                        templateId,
                        expectedTemplateVersion:
                          templates.data?.templates.find(
                            (t) => t.id === templateId,
                          )?.version ?? 0,
                        anchorDate: "",
                        fields: {},
                      }))
                    : draft.tasks,
                });
              }}
            />
            <PeopleMembershipFields
              value={draft.membership}
              onChange={(membership) => setDraft({ ...draft, membership })}
              context={context.data}
              disabled={!ready}
            />
            <Text>{privateInviteCopy}</Text>
            <Action title="Back to person" onPress={() => setStage(0)} />
            <Action
              title="Continue to starting work"
              disabled={
                !ready ||
                !Number.isFinite(draft.membership.capacityHours) ||
                draft.membership.capacityHours < 0 ||
                draft.membership.capacityHours > 168
              }
              onPress={() => setStage(2)}
            />
          </View>
          <View style={stage === 2 ? undefined : { display: "none" }}>
            <Text>Optional starting task templates</Text>
            {templates.ready &&
              templates.data?.templates
                .filter((t) => t.kind === "task" && !t.archived)
                .map((t) => (
                  <Action
                    key={t.id}
                    title={t.name}
                    selected={draft.tasks.some((x) => x.templateId === t.id)}
                    onPress={() =>
                      setDraft({
                        ...draft,
                        tasks: draft.tasks.some((x) => x.templateId === t.id)
                          ? draft.tasks.filter((x) => x.templateId !== t.id)
                          : [
                              ...draft.tasks,
                              {
                                templateId: t.id,
                                expectedTemplateVersion: t.version,
                                anchorDate: "",
                                fields: {},
                              },
                            ],
                      })
                    }
                  />
                ))}
            {draft.tasks.map((task, index) => {
              const update = (patch: Partial<typeof task>) =>
                setDraft({
                  ...draft,
                  tasks: draft.tasks.map((x, i) =>
                    i === index ? { ...x, ...patch } : x,
                  ),
                });
              return (
                <View key={task.templateId}>
                  <Text>
                    {templates.ready
                      ? (templates.data?.templates.find(
                          (t) => t.id === task.templateId,
                        )?.name ?? "Choose a current replacement")
                      : "Checking template access…"}
                  </Text>
                  <DeadlinePicker
                    label={"Template anchor " + (index + 1)}
                    dateLabel={"Anchor date " + (index + 1)}
                    date={task.anchorDate}
                    time=""
                    timezone={w.work?.company.timezone ?? "UTC"}
                    calendarOnly
                    disabled={!ready}
                    onChange={({ date }) => update({ anchorDate: date })}
                  />
                  <PeopleChoice
                    label={"Project " + (index + 1)}
                    value={task.projectId ?? ""}
                    options={
                      projects.ready
                        ? [
                            { id: "", name: "No project" },
                            ...projects.data!.projects,
                          ]
                        : []
                    }
                    disabled={!ready}
                    onChange={(id) => {
                      const p = projects.data?.projects.find(
                        (p) => p.id === id,
                      );
                      update({
                        projectId: p?.id,
                        expectedProjectVersion: p?.version,
                      });
                    }}
                  />
                  {(["ownerId", "reviewerId"] as const).map((field) => (
                    <PeopleChoice
                      key={field}
                      label={
                        (field === "ownerId"
                          ? "Owner "
                          : "Independent reviewer ") +
                        (index + 1)
                      }
                      value={String(task.fields[field] ?? "")}
                      options={
                        context.data
                          ? [
                              { id: "", name: "Use reviewed template default" },
                              ...context.data.people.filter(
                                (p) =>
                                  p.active &&
                                  (field !== "reviewerId" ||
                                    p.role !== "viewer"),
                              ),
                            ]
                          : []
                      }
                      disabled={!ready}
                      onChange={(uid) =>
                        update({ fields: { ...task.fields, [field]: uid } })
                      }
                    />
                  ))}
                </View>
              );
            })}
            <Action title="Back to access" onPress={() => setStage(1)} />
            <Action
              title="Review onboarding"
              disabled={
                !ready ||
                previewAction.busy ||
                draft.tasks.some(
                  (t) => !t.anchorDate || t.expectedTemplateVersion < 1,
                )
              }
              onPress={() => void inspect()}
            />
          </View>
          <View style={stage === 3 ? undefined : { display: "none" }}>
            {presented ? (
              <>
                <PeopleProjection current={!!current}>
                  <Text>
                    {presented.person.name} · {presented.person.email}
                  </Text>
                  {presented.grants.map((g) => (
                    <Text key={g.area}>{g.summary}</Text>
                  ))}
                  {presented.taskPreviews.map((t, i) => (
                    <View key={i}>
                      <Text>
                        {String(t.fields.title ?? "Starting task")} · template
                        version {t.templateVersion}
                      </Text>
                      {onboardingTaskReview(
                        t,
                        context.data,
                        projects.data?.projects,
                      ).map((line, j) => (
                        <Text key={j}>{line}</Text>
                      ))}
                    </View>
                  ))}
                  {presented.unresolved.map((u, i) => (
                    <Text key={i}>{u.message}</Text>
                  ))}
                  <SessionEffect effect={presented.sessionEffect} />
                </PeopleProjection>
                {presented.accountMode === "new_account" ? (
                  <PeopleField
                    label="New account password"
                    value={password}
                    onChange={setPassword}
                    secret
                  />
                ) : (
                  <Text>
                    The existing account name, password and account settings are
                    preserved.
                  </Text>
                )}
                <Action
                  title="Confirm onboarding"
                  primary
                  disabled={
                    !ready ||
                    action.busy ||
                    presented.unresolved.length > 0 ||
                    (presented.accountMode === "new_account" &&
                      Array.from(password).length < 12)
                  }
                  onPress={() => void apply()}
                />
              </>
            ) : (
              <Text>
                Review your choices again to capture current source versions.
              </Text>
            )}
            <Action
              title="Edit reviewed choices"
              disabled={action.busy}
              onPress={() => {
                setStage(2);
                setPassword("");
                setPreview(undefined);
              }}
            />
            <Action
              title="Create fresh preview"
              disabled={!ready || previewAction.busy}
              onPress={() => void inspect()}
            />
          </View>
        </>
      )}
    </Page>
  );
}
