import { useEffect, useEffectEvent, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { Page, useWorkspace, type WorkTask } from "./Workspace";
import { Action, Sheet, ui } from "./ConnectUI";
import PersonPicker from "./PersonPicker";
import { clearConversationDrafts } from "./conversationDrafts";
import { useRamInput } from "./ramInput";
import { businessKey } from "./businessAttempts";
import { client } from "./client";
import { workDeadline, deadlineLocalTime } from "./workDates";
import {
  NativeDeadline,
  NativeSchedule,
  ExecutionField,
  ExecutionStatus,
  ExecutionAttempt,
} from "./Execution";
import {
  useExecutionGuard,
  useExecutionBasis,
  useAuthoredRetirement,
  useExecutionRead,
  useExecutionMutation,
  type ProjectDetail,
  type ExecutionProject,
  type MilestoneView,
  type TaskBasis,
} from "./execution";
import { commitmentLabel } from "../../shared/business/types";
export default function ProjectScreen({ id }: { id: string }) {
  const w = useWorkspace();
  const q = useExecutionRead<ProjectDetail>(`/projects/${id}`);
  const [defaults, setDefaults] = useState(false);
  const [schedule, setSchedule] = useState(false);
  return (
    <Page safeBottom>
      <Action title="‹ Back" onPress={() => router.back()} />
      <ExecutionStatus query={q} />
      {q.data && (
        <View>
          <Text style={ui.title}>{q.data.project.name}</Text>
          <Text>{q.data.project.description}</Text>
          <Text>
            Authorized tasks: {q.data.summary.accepted}/{q.data.summary.total}{" "}
            accepted ·{" "}
            {q.data.summary.total
              ? Math.round(
                  (q.data.summary.accepted * 100) / q.data.summary.total,
                )
              : 0}
            %
          </Text>
          <Text>Task owner policy: {q.data.project.taskOwnerPolicy}</Text>
          {q.data.canEdit && (
            <Action
              title="Edit project task defaults"
              onPress={() => setDefaults(true)}
            />
          )}
          <Action
            title="Review project schedule"
            onPress={() => setSchedule(true)}
          />
          {defaults && (
            <Sheet
              keyboard
              title="Project task defaults"
              onClose={() => setDefaults(false)}
            >
              <ProjectDefaults
                project={q.data.project}
                onDone={() => {
                  setDefaults(false);
                  q.retry();
                }}
              />
            </Sheet>
          )}
          {schedule && (
            <Sheet
              keyboard
              title="Project schedule"
              onClose={() => setSchedule(false)}
            >
              <NativeSchedule
                project={q.data.project}
                tasks={w.work?.tasks.filter((t) => t.projectId === id) ?? []}
                onDone={() => {
                  setSchedule(false);
                  q.retry();
                }}
              />
            </Sheet>
          )}
        </View>
      )}
      {w.foreground && !!w.work && !q.denied && (
        <NativeMilestones
          key={id}
          project={{ id, version: q.data?.project.version ?? 0 }}
          currentProject={q.data?.project}
          sourceReady={q.ready}
          canEdit={!!q.data?.canEdit}
        />
      )}
    </Page>
  );
}
function ProjectDefaults({
  project,
  onDone,
}: {
  project: ExecutionProject;
  onDone: () => void;
}) {
  const w = useWorkspace();
  const { basis: version, freeze: freezeBasis } = useExecutionBasis(
    "$project:" + project.id,
    project.version,
  );
  const [policy, setPolicy] = useRamInput(
    "$project:" + project.id,
    "policy",
    project.taskOwnerPolicy,
  );
  const [owner, setOwner] = useRamInput(
    "$project:" + project.id,
    "owner",
    project.defaultTaskOwnerId,
  );
  const [reviewer, setReviewer] = useRamInput(
    "$project:" + project.id,
    "reviewer",
    project.defaultReviewerId,
  );
  const [required, setRequired] = useRamInput(
    "$project:" + project.id,
    "required",
    project.defaultRequiresApproval,
  );
  const retire = useAuthoredRetirement("$project:" + project.id);
  const action = useExecutionMutation("project-defaults:" + project.id);
  const locked = action.busy || !!action.attempt;
  return (
    <View>
      <Text>
        Editing inspected project version {version}. Defaults are reviewed for
        new tasks.
      </Text>
      {(["actor", "project_owner", "fixed"] as const).map((p) => (
        <Action
          key={p}
          title={"Owner policy: " + p}
          selected={policy === p}
          disabled={locked}
          onPress={() => {
            freezeBasis();
            setPolicy(p);
          }}
        />
      ))}
      {policy === "fixed" && (
        <PersonPicker
          label="Default task owner"
          people={w.work?.people ?? []}
          value={owner}
          onChange={(v) => {
            freezeBasis();
            setOwner(v);
          }}
          disabled={locked}
        />
      )}
      <PersonPicker
        label="Default independent reviewer"
        people={w.work?.people ?? []}
        value={reviewer}
        excludeIds={[
          policy === "fixed"
            ? owner
            : policy === "project_owner"
              ? project.ownerId
              : w.session!.user.id,
        ]}
        allowNone
        onChange={(v) => {
          freezeBasis();
          setReviewer(v);
        }}
        disabled={locked}
      />
      <Action
        title={
          required
            ? "Independent approval required"
            : "Require independent approval"
        }
        selected={required}
        disabled={locked}
        onPress={() => {
          freezeBasis();
          setRequired((v) => !v);
        }}
      />
      <Action
        title={
          action.attempt
            ? "Retry same project defaults"
            : "Save reviewed defaults"
        }
        primary
        disabled={action.busy}
        onPress={() =>
          void action
            .execute(
              `/projects/${project.id}`,
              {
                name: project.name,
                description: project.description,
                ownerId: project.ownerId,
                departmentId: project.departmentId,
                dueDate: project.dueDate,
                color: project.color,
                status: project.status,
                version,
                taskOwnerPolicy: policy,
                defaultTaskOwnerId: owner,
                defaultReviewerId: reviewer,
                defaultRequiresApproval: required,
              },
              "PATCH",
              () =>
                retire({
                  policy,
                  owner,
                  reviewer,
                  required,
                  expectedBasis: version,
                }),
            )
            .then(onDone)
            .catch(() => {})
        }
      />
      <ExecutionAttempt action={action} />
    </View>
  );
}
function NativeMilestones({
  project,
  currentProject,
  sourceReady,
  canEdit,
}: {
  project: Pick<ExecutionProject, "id" | "version">;
  currentProject?: ExecutionProject;
  sourceReady: boolean;
  canEdit: boolean;
}) {
  const q = useExecutionRead<{ milestones: MilestoneView[] }>(
    `/projects/${project.id}/milestones`,
    sourceReady,
  );
  const [selected, setSelected] = useRamInput(
    "$project:" + project.id,
    "selectedMilestone",
    "",
  );
  const [creating, setCreating] = useRamInput(
    "$project:" + project.id,
    "creatingMilestone",
    false,
  );
  return (
    <View>
      <Text style={ui.title}>Human project milestones</Text>
      <Text>
        Independent milestone acceptance leaves task acceptance and goal
        measurements in their own workflows.
      </Text>
      <ExecutionStatus query={q} />
      {q.data?.milestones.map((m) => (
        <Action
          key={m.id}
          title={"Open milestone: " + m.title}
          onPress={() => setSelected(m.id)}
        />
      ))}
      {canEdit && (
        <Action
          title="New project milestone"
          onPress={() => setCreating(true)}
        />
      )}
      {creating && (
        <Sheet
          keyboard
          title="Milestone criteria"
          onClose={() => setCreating(false)}
        >
          <MilestoneForm
            project={project}
            sourceReady={sourceReady && canEdit}
            onDone={() => {
              setCreating(false);
              q.retry();
            }}
          />
        </Sheet>
      )}
      {!!selected && (
        <Sheet
          keyboard
          title="Milestone review"
          onClose={() => setSelected("")}
        >
          {currentProject && (
            <MilestoneDetail project={currentProject} id={selected} />
          )}
        </Sheet>
      )}
    </View>
  );
}
function MilestoneForm({
  project,
  sourceReady = true,
  milestone,
  onDone,
}: {
  project: Pick<ExecutionProject, "id" | "version">;
  sourceReady?: boolean;
  milestone?: MilestoneView;
  onDone: () => void;
}) {
  const w = useWorkspace();
  const form = "$milestone:" + (milestone?.id ?? project.id);
  const retire = useAuthoredRetirement(form);
  const action = useExecutionMutation(
    "milestone-form:" + (milestone?.id ?? project.id),
  );
  const { basis, freeze: freezeBasis } = useExecutionBasis(form, {
    projectVersion: project.version,
    version: milestone?.version,
  });
  const { projectVersion, version } = basis;
  const [title, setTitle] = useRamInput(form, "title", milestone?.title ?? "");
  const [description, setDescription] = useRamInput(
    form,
    "description",
    milestone?.description ?? "",
  );
  const [owner, setOwner] = useRamInput(
    form,
    "owner",
    milestone?.ownerId ?? w.session!.user.id,
  );
  const [reviewer, setReviewer] = useRamInput(
    form,
    "reviewer",
    milestone?.reviewerId ?? "",
  );
  const [criteria, setCriteria] = useRamInput(
    form,
    "criteria",
    milestone?.criteria.map((c) => c.text).join("\n") ?? "",
  );
  const [ids, setIds] = useRamInput<string[]>(
    form,
    "tasks",
    milestone?.taskIds ?? [],
  );
  const [date, setDate] = useRamInput(form, "date", milestone?.dueDate ?? "");
  const [timezone, setTimezone] = useRamInput(
    form,
    "timezone",
    milestone?.dueTimezone || w.work!.company.timezone,
  );
  const [time, setTime] = useRamInput(form, "time", () =>
    milestone?.deadlineMode === "timed"
      ? deadlineLocalTime(
          milestone.dueAt,
          milestone.dueTimezone || w.work!.company.timezone,
        )
      : "",
  );
  const [instant, setInstant] = useRamInput(
    form,
    "instant",
    milestone?.dueAt ?? "",
  );
  const [reason, setReason] = useRamInput(form, "reason", "");
  const locked = action.busy || !!action.attempt;
  return (
    <View>
      {!sourceReady && (
        <Text>
          Checking current project access. Save becomes available after the
          check.
        </Text>
      )}
      <ExecutionField
        label="Milestone title"
        value={title}
        onChange={(v) => {
          freezeBasis();
          setTitle(v);
        }}
        disabled={locked}
      />
      <ExecutionField
        label="Milestone description"
        value={description}
        onChange={(v) => {
          freezeBasis();
          setDescription(v);
        }}
        disabled={locked}
        multiline
      />
      {!milestone && (
        <>
          <PersonPicker
            label="Milestone owner"
            authorized={sourceReady}
            people={w.work?.people ?? []}
            value={owner}
            onChange={(v) => {
              freezeBasis();
              setOwner(v);
            }}
            disabled={locked}
          />
          <PersonPicker
            label="Independent milestone reviewer"
            authorized={sourceReady}
            people={(w.work?.people ?? []).filter((p) => p.role !== "viewer")}
            value={reviewer}
            excludeIds={[owner]}
            onChange={(v) => {
              freezeBasis();
              setReviewer(v);
            }}
            disabled={locked}
          />
        </>
      )}
      <ExecutionField
        label="Acceptance criteria, one per line"
        value={criteria}
        onChange={(v) => {
          freezeBasis();
          setCriteria(v);
        }}
        disabled={locked}
        multiline
      />
      <NativeDeadline
        timezone={timezone}
        onTimezone={(v) => {
          freezeBasis();
          setTimezone(v);
          setInstant("");
        }}
        date={date}
        time={time}
        instant={instant}
        setDate={(v) => {
          freezeBasis();
          setDate(v);
        }}
        setTime={(v) => {
          freezeBasis();
          setTime(v);
        }}
        setInstant={(v) => {
          freezeBasis();
          setInstant(v);
        }}
        disabled={locked}
      />
      {milestone && (
        <ExecutionField
          label="Milestone deadline change reason"
          value={reason}
          onChange={(v) => {
            freezeBasis();
            setReason(v);
          }}
          disabled={locked}
        />
      )}
      <Text>Select independently visible tasks in this project.</Text>
      {sourceReady &&
        w.work?.tasks
          .filter((t) => t.projectId === project.id)
          .map((t) => (
            <Action
              key={t.id}
              title={(ids.includes(t.id) ? "Selected: " : "Select: ") + t.title}
              selected={ids.includes(t.id)}
              disabled={locked}
              onPress={() => {
                freezeBasis();
                setIds((ids) =>
                  ids.includes(t.id)
                    ? ids.filter((id) => id !== t.id)
                    : [...ids, t.id],
                );
              }}
            />
          ))}
      <Action
        title={
          action.attempt
            ? "Retry same milestone save"
            : "Save milestone criteria"
        }
        primary
        disabled={
          !sourceReady ||
          action.busy ||
          !title.trim() ||
          !criteria.trim() ||
          !ids.length ||
          (!milestone && !reviewer)
        }
        onPress={() => {
          if (!sourceReady) return;
          let deadline;
          try {
            deadline = workDeadline(date, time, timezone, instant);
          } catch {
            return;
          }
          void action
            .execute(
              milestone
                ? `/project-milestones/${milestone.id}`
                : `/projects/${project.id}/milestones`,
              {
                expectedProjectVersion: projectVersion,
                ...(milestone
                  ? { version }
                  : { ownerId: owner, reviewerId: reviewer }),
                title,
                description,
                criteria: criteria
                  .split("\n")
                  .map((v) => v.trim())
                  .filter(Boolean)
                  .map((text, i) => ({
                    id: milestone?.criteria[i]?.id ?? businessKey(),
                    text,
                  })),
                taskIds: ids,
                ...deadline,
                ...(milestone ? { deadlineChangeReason: reason } : {}),
              },
              milestone ? "PATCH" : "POST",
              () =>
                retire({
                  expectedBasis: basis,
                  title,
                  description,
                  owner,
                  reviewer,
                  criteria,
                  tasks: ids,
                  date,
                  time,
                  instant,
                  timezone,
                  reason,
                }),
            )
            .then(onDone)
            .catch(() => {});
        }}
      />
      <ExecutionAttempt action={action} />
    </View>
  );
}
function MilestoneDetail({
  project,
  id,
}: {
  project: ExecutionProject;
  id: string;
}) {
  const w = useWorkspace();
  const q = useExecutionRead<{ milestone: MilestoneView }>(
    `/project-milestones/${id}`,
  );
  const m = q.data?.milestone;
  const capture = useExecutionGuard("milestone-basis:" + id);
  const retire = useAuthoredRetirement("$milestone:" + id);
  const action = useExecutionMutation("milestone-transition:" + id);
  const [assertions, setAssertions] = useRamInput<Record<string, string>>(
    "$milestone:" + id,
    "assertions",
    {},
  );
  const [basis, setBasis] = useState<TaskBasis[]>();
  const [reason, setReason] = useRamInput(
    "$milestone:" + id,
    "transitionReason",
    "",
  );
  const [note, setNote] = useRamInput("$milestone:" + id, "note", "");
  const [editing, setEditing] = useRamInput(
    "$milestone:" + id,
    "editing",
    false,
  );
  const [error, setError] = useState("");
  const scrubBasis = useEffectEvent(() => {
    action.abandon();
    clearConversationDrafts(
      w.company,
      w.session?.user.id ?? "",
      "$milestone:" + id,
    );
    setBasis(undefined);
  });
  useEffect(() => {
    if (q.denied) void Promise.resolve().then(() => scrubBasis());
  }, [q.denied]);
  async function inspectBasis() {
    if (!m) return;
    const isCurrent = capture();
    try {
      const rows = await Promise.all(
        m.taskIds.map((task) =>
          client.request<{ task: WorkTask }>(
            `/companies/${w.company}/tasks/${task}`,
          ),
        ),
      );
      if (!isCurrent()) return;
      if (rows.some((r) => r.task.status !== "done"))
        throw Error("Every selected task must be accepted as done.");
      setBasis(
        rows.map((r) => ({ taskId: r.task.id, version: r.task.version })),
      );
      setError("");
    } catch (e) {
      if (isCurrent()) setError((e as Error).message);
    }
  }
  async function transition(kind: string) {
    if (!m) return;
    await action.execute(
      `/project-milestones/${id}/transition`,
      {
        action: kind,
        version: m.version,
        expectedProjectVersion: project.version,
        ...(kind === "submit"
          ? {
              criteriaVersion: m.criteriaVersion,
              assertions: m.criteria.map((c) => ({
                criterionId: c.id,
                statement: assertions[c.id] ?? "",
              })),
              tasks: basis,
            }
          : kind === "reopen"
            ? { reason }
            : {
                criteriaVersion: m.criteriaVersion,
                tasks: m.submittedTasks,
                ...(kind === "approve" ? { note } : { reason }),
              }),
      },
      "POST",
      () => retire({ assertions, transitionReason: reason, note }),
    );
    setBasis(undefined);
    q.retry();
  }
  return (
    <View>
      <ExecutionStatus query={q} />
      {m && (
        <>
          <Text style={ui.title}>{m.title}</Text>
          <Text>
            {m.state.replaceAll("_", " ")} · Criteria version{" "}
            {m.criteriaVersion}
          </Text>
          <Text>
            Original: {m.originalDueAt || m.originalDueDate || "No deadline"}
          </Text>
          <Text>Current: {commitmentLabel(m)}</Text>
          {!m.basisCurrent && (
            <Text accessibilityRole="alert">{m.basisNotice}</Text>
          )}
          {m.criteria.map((c) => (
            <View key={c.id}>
              <Text>{c.text}</Text>
              {m.canSubmit && !action.attempt && (
                <ExecutionField
                  label={"Criterion assertion: " + c.text}
                  value={assertions[c.id] ?? ""}
                  disabled={action.busy || !!action.attempt}
                  onChange={(v) => setAssertions((a) => ({ ...a, [c.id]: v }))}
                  multiline
                />
              )}
            </View>
          ))}
          {m.taskIds.map((t) => (
            <Action
              key={t}
              title="Inspect selected task evidence"
              onPress={() =>
                router.push({
                  pathname: "/task/[id]",
                  params: { id: t, company: w.company },
                })
              }
            />
          ))}
          {m.canEdit && (
            <Action
              title="Edit draft milestone"
              disabled={!!action.attempt}
              onPress={() => setEditing(true)}
            />
          )}
          {m.canSubmit && !action.attempt && (
            <>
              <Action
                title="Inspect current submission basis"
                disabled={action.busy || !!action.attempt}
                onPress={() => void inspectBasis()}
              />
              {basis && (
                <Text>Inspected {basis.length} currently accepted tasks.</Text>
              )}
              <Action
                title={
                  action.attempt
                    ? "Retry same milestone submission"
                    : "Submit milestone for independent review"
                }
                primary
                disabled={
                  action.busy ||
                  !basis ||
                  m.criteria.some((c) => !assertions[c.id]?.trim())
                }
                onPress={() => void transition("submit").catch(() => {})}
              />
            </>
          )}
          {m.canReview && !action.attempt && (
            <>
              <Text>
                Inspect each assertion against current task evidence. Bound task
                versions: {m.submittedTasks.map((t) => t.version).join(", ")}.
              </Text>
              {m.assertions.map((a) => (
                <Text key={a.criterionId}>{a.statement}</Text>
              ))}
              <ExecutionField
                label="Independent review note"
                value={note}
                onChange={setNote}
                disabled={action.busy || !!action.attempt}
              />
              <Action
                title={
                  action.attempt
                    ? "Retry same milestone decision"
                    : "Accept reviewed milestone"
                }
                primary
                disabled={action.busy}
                onPress={() => void transition("approve").catch(() => {})}
              />
              <ExecutionField
                label="Request changes reason"
                value={reason}
                onChange={setReason}
                disabled={action.busy || !!action.attempt}
              />
              <Action
                title="Request milestone changes"
                disabled={action.busy || !!action.attempt || !reason.trim()}
                onPress={() =>
                  void transition("request_changes").catch(() => {})
                }
              />
            </>
          )}
          {m.canReopen && !action.attempt && (
            <>
              <ExecutionField
                label="Reopen milestone reason"
                value={reason}
                onChange={setReason}
                disabled={action.busy || !!action.attempt}
              />
              <Action
                title={
                  action.attempt
                    ? "Retry same milestone reopen"
                    : "Reopen milestone for fresh review"
                }
                disabled={action.busy || !reason.trim()}
                onPress={() => void transition("reopen").catch(() => {})}
              />
            </>
          )}
          {!!action.attempt && (
            <Action
              title="Retry same milestone action"
              primary
              disabled={action.busy}
              onPress={() =>
                void action
                  .execute(
                    `/project-milestones/${id}/transition`,
                    action.attempt!.payload,
                  )
                  .then(() => q.retry())
                  .catch(() => {})
              }
            />
          )}
          {m.acceptances.map((a) => (
            <View key={a.id}>
              <Text>
                Historical acceptance: {a.createdAt} · Criteria version{" "}
                {a.criteriaVersion} · Project version {a.projectVersion}
              </Text>
              <Text>{a.note}</Text>
              {a.assertions.map((c) => (
                <Text key={c.criterionId}>{c.statement}</Text>
              ))}
              <Text>
                Task versions: {a.tasks.map((t) => t.version).join(", ")}
              </Text>
            </View>
          ))}
          {editing && (
            <Sheet
              keyboard
              title="Edit draft milestone"
              onClose={() => setEditing(false)}
            >
              <MilestoneForm
                project={project}
                milestone={m}
                onDone={() => {
                  setEditing(false);
                  q.retry();
                }}
              />
            </Sheet>
          )}
        </>
      )}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
      <ExecutionAttempt action={action} />
    </View>
  );
}
