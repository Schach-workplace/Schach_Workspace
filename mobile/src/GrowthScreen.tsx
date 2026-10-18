import { useEffect, useEffectEvent, useState } from "react";
import { FlatList, Text, TextInput, View } from "react-native";
import { Page, useWorkspace } from "./Workspace";
import { Action, Sheet, ui } from "./ConnectUI";
import {
  ScreenHeading,
  Surface,
  RecordCard,
  EmptyState,
  mobileUI,
} from "./MobileUI";
import { useExecutionRead, useExecutionMutation } from "./execution";
import { useRamInput } from "./ramInput";
import PersonPicker from "./PersonPicker";
import {
  developmentDraft,
  developmentSubmission,
  learningLines,
} from "../../shared/growth/drafts";
import type {
  DevelopmentCatalogResult,
  DevelopmentListResult,
  DevelopmentDetailResult,
  DevelopmentFields,
  DevelopmentPilot,
  DevelopmentPlan,
  DevelopmentMutationResult,
} from "../../shared/growth/types";

export default function GrowthScreen() {
  const w = useWorkspace();
  return (
    <GrowthHome
      key={[
        w.company,
        w.session?.user.id,
        w.policyEpoch,
        w.work?.readBasis,
      ].join(":")}
    />
  );
}
function GrowthHome() {
  const w = useWorkspace(),
    catalog = useExecutionRead<DevelopmentCatalogResult>("/growth/catalog"),
    list = useExecutionRead<DevelopmentListResult>("/growth/plans");
  const [selected, setSelected] = useState(""),
    [creating, setCreating] = useState(false);
  const refreshPlans = useEffectEvent(() => list.retry());
  useEffect(() => {
    const timer = setInterval(() => refreshPlans(), 15000);
    return () => clearInterval(timer);
  }, []);
  const pilots = catalog.data?.pilots ?? [];
  return (
    <Page scroll={false} safeBottom>
      {selected ? (
        <GrowthDetail
          id={selected}
          pilots={pilots}
          onBack={() => {
            setSelected("");
            list.retry();
          }}
        />
      ) : (
        <FlatList
          data={list.ready ? (list.data?.plans ?? []) : []}
          keyExtractor={(p) => p.id}
          contentContainerStyle={mobileUI.listContent}
          ListHeaderComponent={
            <View>
              <ScreenHeading
                title="Development"
                description="Your learning, evidence and mentor conversations."
                action={
                  w.work?.me.role !== "viewer" && catalog.ready ? (
                    <Action
                      title="New development plan"
                      primary
                      onPress={() => setCreating(true)}
                    />
                  ) : undefined
                }
              />
              <Surface>
                <Text style={ui.body}>
                  Career roles describe development. They never change
                  application permissions, task acceptance or measured business
                  outcomes.
                </Text>
                <Text style={ui.subtitle}>
                  Only you and your currently selected mentor can read a plan.
                  Leadership does not grant access.
                </Text>
              </Surface>
              {!!list.error && (
                <Text accessibilityRole="alert">{list.error}</Text>
              )}
              <Action
                title="Refresh development plans"
                onPress={() => list.retry()}
              />
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              title={
                list.ready
                  ? "No development plans yet"
                  : "Checking current development access…"
              }
              description="Start with an engineering, office or field development plan."
            />
          }
          renderItem={({ item: p }) => (
            <RecordCard
              title={p.title}
              label={"Open development plan: " + p.title}
              status={p.state}
              detail={p.careerRole + " · " + p.careerLevel}
              onPress={() => setSelected(p.id)}
            />
          )}
        />
      )}
      {creating && !!pilots.length && (
        <PlanEditor
          pilots={pilots}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            setSelected(id);
            list.retry();
          }}
        />
      )}
    </Page>
  );
}
function GrowthDetail({
  id,
  pilots,
  onBack,
}: {
  id: string;
  pilots: DevelopmentPilot[];
  onBack: () => void;
}) {
  const q = useExecutionRead<DevelopmentDetailResult>("/growth/plans/" + id);
  const [edit, setEdit] = useState(false),
    [review, setReview] = useState(false);
  const refreshPlan = useEffectEvent(() => q.retry());
  useEffect(() => {
    const timer = setInterval(() => refreshPlan(), 15000);
    return () => clearInterval(timer);
  }, []);
  return (
    <View style={{ flex: 1 }}>
      <Action title="‹ Development plans" onPress={onBack} />
      {!q.ready || !q.data ? (
        <View>
          <Text>{q.error || "Checking current plan access…"}</Text>
          <Action title="Retry current plan" onPress={() => q.retry()} />
        </View>
      ) : (
        <FlatList
          data={q.data.reviews}
          keyExtractor={(r) => r.id}
          ListHeaderComponent={
            <View>
              <ScreenHeading
                title={q.data.plan.title}
                description={
                  q.data.plan.careerRole + " · " + q.data.plan.careerLevel
                }
              />
              <Surface>
                <Text style={mobileUI.sectionTitle}>Development objective</Text>
                <Text style={ui.body}>{q.data.plan.objective}</Text>
                <Text style={ui.subtitle}>
                  Competencies: {q.data.plan.competencyIds.join(", ")}
                </Text>
                <Text style={ui.subtitle}>
                  Audience: plan owner
                  {q.data.plan.mentorId ? " and current mentor" : " only"}
                </Text>
              </Surface>
              <Surface>
                <Text style={mobileUI.sectionTitle}>Learning actions</Text>
                {q.data.plan.learningActions.map((s, i) => (
                  <Text key={i} style={ui.body}>
                    {i + 1}. {s}
                  </Text>
                ))}
                <Text style={mobileUI.sectionTitle}>
                  Employee evidence note
                </Text>
                <Text style={ui.body}>
                  {q.data.plan.evidenceNote || "No evidence note published."}
                </Text>
              </Surface>
              {q.data.canEdit && !!pilots.length && (
                <Action
                  title="Edit development plan"
                  onPress={() => setEdit(true)}
                />
              )}
              {q.data.canReview && (
                <Action
                  title="Add mentor feedback"
                  onPress={() => setReview(true)}
                />
              )}
              <Text style={mobileUI.sectionTitle}>Mentor feedback</Text>
            </View>
          }
          ListEmptyComponent={
            <Text style={ui.subtitle}>No mentor feedback yet.</Text>
          }
          renderItem={({ item: r }) => (
            <Surface>
              <Text style={ui.body}>{r.feedback}</Text>
              <Text style={ui.subtitle}>Next step: {r.nextStep}</Text>
              <Text style={ui.metadata}>
                Recorded at plan version {r.planVersion} · {r.createdAt}
              </Text>
            </Surface>
          )}
        />
      )}
      {edit && q.ready && q.data?.canEdit && (
        <PlanEditor
          key={id}
          plan={q.data.plan}
          pilots={pilots}
          onClose={() => setEdit(false)}
          onSaved={() => {
            setEdit(false);
            q.retry();
          }}
        />
      )}
      {review && q.ready && q.data?.canReview && (
        <MentorReview
          plan={q.data.plan}
          onClose={() => setReview(false)}
          onSaved={() => {
            setReview(false);
            q.retry();
          }}
        />
      )}
    </View>
  );
}
function Field({
  label,
  value,
  onChange,
  disabled,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  disabled: boolean;
  multiline?: boolean;
}) {
  return (
    <View>
      <Text style={ui.name}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        multiline={multiline}
        style={ui.input}
      />
    </View>
  );
}
function PlanEditor({
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
    form = "$growth:" + (latestPlan?.id ?? "new") + ":edit";
  const [authored, setAuthored, retireAuthored] = useRamInput<{
    source: DevelopmentPlan | undefined;
    fields: DevelopmentFields;
    learning: string;
  }>(form, "boundDraft", () => ({
    source: latestPlan,
    fields: developmentDraft(
      pilots.find((p) => p.id === latestPlan?.pilot) ?? pilots[0],
      latestPlan,
    ),
    learning: latestPlan?.learningActions.join("\n") ?? "",
  }));
  const { source: plan, fields: draft, learning } = authored;
  const setDraft = (
    update:
      DevelopmentFields | ((fields: DevelopmentFields) => DevelopmentFields),
  ) =>
    setAuthored((d) => ({
      ...d,
      fields: typeof update === "function" ? update(d.fields) : update,
    }));
  const setLearning = (learning: string) =>
    setAuthored((d) => ({ ...d, learning }));
  const action = useExecutionMutation(
    form,
    plan ? ["/growth/plans/" + plan.id] : [],
  );
  const shown = developmentSubmission(draft, action.attempt),
    locked = action.busy || !!action.attempt;
  const [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState("");
  const pilot = pilots.find((p) => p.id === shown.pilot)!;
  const set = (key: keyof DevelopmentFields, value: unknown) => {
    setConfirmed(false);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const mentor =
    w.work?.people.find((p) => p.id === shown.mentorId)?.name ??
    (shown.mentorId ? "Previously selected mentor" : "Only you");
  async function save() {
    if (!confirmed && !action.attempt) return;
    try {
      setAuthored(authored);
      const { state, ...create } = {
        ...draft,
        learningActions: learningLines(learning),
      };
      const payload =
        action.attempt?.payload ??
        (plan
          ? {
              ...draft,
              learningActions: learningLines(learning),
              expectedVersion: plan.version,
            }
          : create);
      const r = await action.execute<DevelopmentMutationResult>(
        "/growth/plans" + (plan ? "/" + plan.id : ""),
        payload,
        plan ? "PATCH" : "POST",
        () => retireAuthored(authored),
      );
      retireAuthored(authored);
      onSaved(r.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Sheet
      title={plan ? "Edit development plan" : "New development plan"}
      onClose={onClose}
      busy={action.busy}
    >
      {!plan && (
        <View style={ui.row}>
          {pilots.map((p) => (
            <Action
              key={p.id}
              title={p.label}
              selected={p.id === shown.pilot}
              disabled={locked}
              onPress={() => {
                setConfirmed(false);
                setDraft(developmentDraft(p));
                setLearning("");
              }}
            />
          ))}
        </View>
      )}
      <Field
        label="Plan title"
        value={shown.title}
        disabled={locked}
        onChange={(s) => set("title", s)}
      />
      <Field
        label="Career role (does not grant permissions)"
        value={shown.careerRole}
        disabled={locked}
        onChange={(s) => set("careerRole", s)}
      />
      <Text style={ui.name}>Career level</Text>
      <View style={ui.row}>
        {pilot.levels.map((level) => (
          <Action
            key={level}
            title={level}
            selected={shown.careerLevel === level}
            disabled={locked}
            onPress={() => set("careerLevel", level)}
          />
        ))}
      </View>
      <Text style={ui.name}>Development competencies</Text>
      {pilot.competencies.map((c) => (
        <Action
          key={c.id}
          title={c.label}
          selected={shown.competencyIds.includes(c.id)}
          disabled={locked}
          onPress={() =>
            set(
              "competencyIds",
              shown.competencyIds.includes(c.id)
                ? shown.competencyIds.filter((v) => v !== c.id)
                : [...shown.competencyIds, c.id],
            )
          }
        />
      ))}
      <Field
        label="Development objective"
        value={shown.objective}
        disabled={locked}
        multiline
        onChange={(s) => set("objective", s)}
      />
      <Text style={ui.subtitle}>
        Suggested learning: {pilot.suggestedLearning.join(" · ")}
      </Text>
      <Field
        label="Learning actions (one per line)"
        value={action.attempt ? shown.learningActions.join("\n") : learning}
        disabled={locked}
        multiline
        onChange={(s) => {
          setConfirmed(false);
          setLearning(s);
        }}
      />
      <Field
        label="Evidence note shared with your mentor"
        value={shown.evidenceNote}
        disabled={locked}
        multiline
        onChange={(s) => set("evidenceNote", s)}
      />
      <PersonPicker
        people={(w.work?.people ?? []).filter(
          (p) => p.active && p.role !== "viewer",
        )}
        excludeIds={[w.session?.user.id ?? ""]}
        value={shown.mentorId}
        label="Development mentor"
        disabled={locked}
        onChange={(s) => set("mentorId", s)}
      />
      {!!shown.mentorId && (
        <Action
          title="Remove mentor from plan audience"
          disabled={locked}
          onPress={() => set("mentorId", "")}
        />
      )}
      {plan && (
        <Action
          title={
            shown.state === "archived" ? "Restore active plan" : "Archive plan"
          }
          disabled={locked}
          onPress={() =>
            set("state", shown.state === "archived" ? "active" : "archived")
          }
        />
      )}
      <Surface>
        <Text style={ui.name}>Plan audience: {mentor}</Text>
        <Text style={ui.body}>
          Saving publishes the objective, learning actions and evidence note to
          this audience. Include only information you intend to share. No
          private conversations are copied automatically.
        </Text>
      </Surface>
      {!action.attempt && (
        <Action
          title={
            confirmed
              ? "✓ Plan audience reviewed"
              : "I reviewed this plan and audience"
          }
          selected={confirmed}
          disabled={action.busy}
          onPress={() => setConfirmed((v) => !v)}
        />
      )}
      {!!action.attempt && (
        <Text style={ui.body}>
          Result unknown. The original plan, audience and retry identity are
          frozen. Retry the same submission or discard it and review current
          information.
        </Text>
      )}
      {!!(error || action.error) && (
        <Text accessibilityRole="alert">{error || action.error}</Text>
      )}
      <Action
        title={
          action.attempt
            ? "Retry original plan submission"
            : "Save development plan"
        }
        primary
        disabled={
          action.busy ||
          (!action.attempt &&
            (!confirmed ||
              !shown.title.trim() ||
              !shown.objective.trim() ||
              !shown.careerRole.trim() ||
              !shown.competencyIds.length))
        }
        onPress={() => void save()}
      />
      {!!action.attempt && (
        <Action
          title="Discard attempt and review current plan"
          disabled={action.busy}
          onPress={() => {
            action.abandon();
            retireAuthored(authored);
            setConfirmed(false);
            setError("");
          }}
        />
      )}
    </Sheet>
  );
}
function MentorReview({
  plan: latestPlan,
  onClose,
  onSaved,
}: {
  plan: DevelopmentPlan;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = "$growth:" + latestPlan.id + ":review",
    action = useExecutionMutation(form, ["/growth/plans/" + latestPlan.id]);
  const [authored, setAuthored, retireAuthored] = useRamInput(
    form,
    "boundDraft",
    () => ({
      source: latestPlan,
      fields: { feedback: "", nextStep: "" },
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
        "/growth/plans/" + plan.id + "/reviews",
        action.attempt?.payload ?? { ...draft, expectedVersion: plan.version },
        "POST",
        () => retireAuthored(authored),
      );
      retireAuthored(authored);
      onSaved();
    } catch {}
  }
  return (
    <Sheet title="Mentor feedback" onClose={onClose} busy={action.busy}>
      <Text style={ui.body}>
        {plan.title} · reviewed version {plan.version} · Employee {plan.ownerId}{" "}
        · Mentor {plan.mentorId}
      </Text>
      <Text style={ui.body}>
        {plan.careerRole} · {plan.careerLevel} · Competencies:{" "}
        {plan.competencyIds.join(", ")}
      </Text>
      <Text style={ui.body}>{plan.objective}</Text>
      {plan.learningActions.map((line, i) => (
        <Text key={i} style={ui.body}>
          {line}
        </Text>
      ))}
      <Text style={ui.body}>{plan.evidenceNote}</Text>
      <Text style={ui.body}>
        Share constructive observations and a next step with the employee. This
        does not approve tasks, measure a business goal or change career or
        permission roles.
      </Text>
      <Field
        label="Mentor observations"
        value={shown.feedback}
        disabled={action.busy || !!action.attempt}
        multiline
        onChange={(feedback) => setDraft((d) => ({ ...d, feedback }))}
      />
      <Field
        label="Next development step"
        value={shown.nextStep}
        disabled={action.busy || !!action.attempt}
        multiline
        onChange={(nextStep) => setDraft((d) => ({ ...d, nextStep }))}
      />
      {!!action.error && <Text accessibilityRole="alert">{action.error}</Text>}
      <Action
        title={
          action.attempt
            ? "Retry original mentor feedback"
            : "Publish mentor feedback"
        }
        primary
        disabled={
          action.busy || !shown.feedback.trim() || !shown.nextStep.trim()
        }
        onPress={() => void save()}
      />
      {!!action.attempt && (
        <Action
          title="Discard feedback attempt and review latest"
          disabled={action.busy}
          onPress={() => {
            action.abandon();
            retireAuthored(authored);
          }}
        />
      )}
    </Sheet>
  );
}
