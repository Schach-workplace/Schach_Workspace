import { useEffect, useEffectEvent, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useWorkspace, type WorkTask } from "./Workspace";
import { Action, Sheet, ui } from "./ConnectUI";
import PersonPicker from "./PersonPicker";
import DeadlinePicker from "./DeadlinePicker";
import AttentionInbox from "./AttentionInbox";
import { client } from "./client";
import { clearConversationDrafts } from "./conversationDrafts";
import { useRamInput } from "./ramInput";
import {
  companyDate,
  workDeadline,
  DeadlineChoiceError,
  deadlineLocalTime,
} from "./workDates";
import {
  useExecutionBasis,
  useExecutionGuard,
  useAuthoredRetirement,
  useExecutionMutation,
  useExecutionRead,
  type ExecutionProject,
  type ProjectDetail,
  type TaskImpactView,
  type TaskTemplateView,
  type TemplatePreview,
  type ScheduleChange,
  type ScheduleProposalView,
} from "./execution";
import type { ScheduleContext } from "../../shared/business/types";
import { commitmentLabel } from "../../shared/business/types";
export function ExecutionField({
  label,
  value,
  onChange,
  disabled = false,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  multiline?: boolean;
}) {
  return (
    <View>
      <Text>{label}</Text>
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
export function ExecutionStatus({
  query,
}: {
  query: { loading: boolean; error?: string; retry: () => void };
}) {
  return (
    <View>
      {query.loading && <Text>Checking current source access…</Text>}
      {!!query.error && (
        <>
          <Text accessibilityRole="alert">{query.error}</Text>
          <Action title="Retry current source" onPress={query.retry} />
        </>
      )}
    </View>
  );
}
export function ExecutionAttempt({
  action,
}: {
  action: ReturnType<typeof useExecutionMutation>;
}) {
  return (
    <View>
      {!!action.error && <Text accessibilityRole="alert">{action.error}</Text>}
      {!!action.attempt && (
        <>
          <Text>
            The result may already exist. Retry the frozen submission, or
            abandon it deliberately before authoring another.
          </Text>
          <Action
            title="Abandon retry; prior result may exist"
            disabled={action.busy}
            onPress={action.abandon}
          />
        </>
      )}
    </View>
  );
}
export function NativeDeadline({
  date,
  time,
  instant,
  setDate,
  setTime,
  setInstant,
  onChange,
  disabled = false,
  timezone,
  onTimezone,
}: {
  date: string;
  time: string;
  instant: string;
  setDate?: (v: string) => void;
  setTime?: (v: string) => void;
  setInstant?: (v: string) => void;
  onChange?: (v: { date: string; time: string; instant: string }) => void;
  timezone?: string;
  onTimezone?: (v: string) => void;
  disabled?: boolean;
}) {
  const w = useWorkspace();
  const zone = timezone || w.work?.company.timezone || "Asia/Kolkata";
  let choices: string[] = [];
  let error = "";
  try {
    workDeadline(date, time, zone, instant);
  } catch (e) {
    error = (e as Error).message;
    if (e instanceof DeadlineChoiceError) choices = e.candidates;
  }
  return (
    <View>
      {onTimezone && (
        <ExecutionField
          label="Commitment timezone"
          value={zone}
          onChange={onTimezone}
          disabled={disabled}
        />
      )}
      <DeadlinePicker
        date={date}
        time={time}
        timezone={zone}
        disabled={disabled}
        onChange={(v) => {
          if (onChange) onChange({ ...v, instant: "" });
          else {
            setDate?.(v.date);
            setTime?.(v.time);
            setInstant?.("");
          }
        }}
      />
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
      {choices.map((at) => (
        <Action
          key={at}
          title={"Use explicit instant " + at}
          disabled={disabled}
          selected={instant === at}
          onPress={() =>
            onChange ? onChange({ date, time, instant: at }) : setInstant?.(at)
          }
        />
      ))}
    </View>
  );
}
export function NativeProjects() {
  const w = useWorkspace();
  const q = useExecutionRead<{ projects: ExecutionProject[] }>("/projects");
  return (
    <View>
      <Text style={ui.title}>Projects</Text>
      <ExecutionStatus query={q} />
      {q.data?.projects.map((p) => (
        <Action
          key={p.id}
          title={p.name}
          onPress={() =>
            router.push({
              pathname: "/project/[id]",
              params: { id: p.id, company: w.company },
            })
          }
        />
      ))}
      {q.ready && !q.data?.projects.length && (
        <Text>No authorized projects.</Text>
      )}
    </View>
  );
}
export function NativeImpact({ id }: { id: string }) {
  const q = useExecutionRead<TaskImpactView>(`/tasks/${id}/impact`);
  return (
    <View>
      <Text style={ui.title}>Dependency impact</Text>
      <ExecutionStatus query={q} />
      {q.data && (
        <>
          <Text>{q.data.notice}</Text>
          {q.data.nodes.map((n) => (
            <View key={n.id}>
              <Text>
                {n.code} · {n.title}
              </Text>
              <Text>Original: {commitmentLabel(n.originalCommitment)}</Text>
              <Text>Current: {commitmentLabel(n.currentCommitment)}</Text>
            </View>
          ))}
          {q.data.edges.map((e) => (
            <Text key={e.from + e.to}>
              {q.data!.nodes.find((n) => n.id === e.from)?.title} →{" "}
              {q.data!.nodes.find((n) => n.id === e.to)?.title}
            </Text>
          ))}
          <AttentionInbox sourceTaskId={id} />
        </>
      )}
    </View>
  );
}
export function NativeSchedule({
  tasks,
  onDone,
  project,
  context,
  ready = true,
}: {
  tasks: WorkTask[];
  onDone?: () => void;
  project?: ExecutionProject;
  context?: ScheduleContext;
  ready?: boolean;
}) {
  const w = useWorkspace();
  const identity = tasks
    .map((t) => t.id)
    .sort()
    .join(":");
  const [inspectedContext, freezeContext] = useRamInput<
    ScheduleContext | undefined
  >("$schedule:" + identity, "context", context);
  const retireSchedule = useAuthoredRetirement("$schedule:" + identity);
  const preview = useExecutionMutation("schedule-preview:" + identity);
  const apply = useExecutionMutation("schedule-apply:" + identity);
  const [rows, setRows] = useRamInput<ScheduleChange[]>(
    "$schedule:" + identity,
    "rows",
    () =>
      tasks
        .filter((t) => !["done", "cancelled"].includes(t.status))
        .map((t) => ({
          taskId: t.id,
          version: t.version,
          startDate: t.startDate ?? "",
          dueDate: t.dueDate,
          deadlineMode: t.deadlineMode === "timed" ? "timed" : "all_day",
          dueAt: t.dueAt ?? "",
          dueTimezone: t.dueTimezone ?? "",
          reason: "",
        })),
  );
  const [selected, setSelected] = useRamInput<string[]>(
    "$schedule:" + identity,
    "selected",
    () => rows.map((r) => r.taskId),
  );
  const [proposalId, setProposalId] = useRamInput(
    "$schedule:" + identity,
    "proposal",
    "",
  );
  const [method, setMethod] = useRamInput<"manual" | "calendar_day_shift">(
    "$schedule:" + identity,
    "method",
    "manual",
  );
  const [offset, setOffset] = useRamInput(
    "$schedule:" + identity,
    "offset",
    "1",
  );
  const q = useExecutionRead<{ proposal: ScheduleProposalView }>(
    `/task-schedule/${proposalId}`,
    !!proposalId,
  );
  const [error, setError] = useState("");
  const locked = preview.busy || !!preview.attempt;
  const freezeInspected = () => {
    freezeContext(inspectedContext);
    setRows(rows);
  };
  const update = (id: string, key: keyof ScheduleChange, value: unknown) => {
    freezeContext(inspectedContext);
    setRows((rows) =>
      rows.map((r) => (r.taskId === id ? { ...r, [key]: value } : r)),
    );
  };
  const scrubProposal = useEffectEvent(() => {
    preview.abandon();
    apply.abandon();
    clearConversationDrafts(
      w.company,
      w.session?.user.id ?? "",
      "$schedule:" + identity,
    );
    setProposalId("");
  });
  useEffect(() => {
    if (q.denied) void Promise.resolve().then(() => scrubProposal());
  }, [q.denied]);
  async function run(fn: () => Promise<void>) {
    setError("");
    try {
      await fn();
    } catch {
      setError(
        "Inspect the current source and retry the same reviewed submission.",
      );
    }
  }
  return (
    <View>
      <Text style={ui.title}>Reviewed schedule</Text>
      <Text>
        Review original, current and proposed commitments. Cancel changes no
        tasks.
      </Text>
      {!proposalId && (
        <>
          <Action
            title={"Method: " + method}
            disabled={locked}
            onPress={() => {
              freezeInspected();
              setMethod(method === "manual" ? "calendar_day_shift" : "manual");
            }}
          />
          {method === "calendar_day_shift" && (
            <ExecutionField
              label="Signed company-calendar day offset"
              value={offset}
              onChange={(value) => {
                freezeInspected();
                setOffset(value);
              }}
              disabled={locked}
            />
          )}
          {rows.map((r) => {
            const t = tasks.find((t) => t.id === r.taskId);
            return (
              <View key={r.taskId}>
                <Action
                  title={
                    (selected.includes(r.taskId) ? "Selected: " : "Select: ") +
                    (ready ? (t?.title ?? "Task") : "Selected work")
                  }
                  disabled={locked}
                  onPress={() => {
                    freezeInspected();
                    setSelected((ids) =>
                      ids.includes(r.taskId)
                        ? ids.filter((id) => id !== r.taskId)
                        : [...ids, r.taskId],
                    );
                  }}
                />
                <Text>
                  Original:{" "}
                  {ready &&
                    commitmentLabel({
                      dueDate: t?.originalDueDate,
                      deadlineMode:
                        t?.originalDeadlineMode === "timed"
                          ? "timed"
                          : "all_day",
                      dueAt: t?.originalDueAt,
                      dueTimezone: t?.originalDueTimezone,
                    })}
                </Text>
                <Text>
                  Current:{" "}
                  {ready &&
                    commitmentLabel({
                      ...t,
                      deadlineMode:
                        t?.deadlineMode === "timed" ? "timed" : "all_day",
                    })}
                </Text>
                {method === "manual" && (
                  <>
                    <ExecutionField
                      label={
                        "Start date: " + (ready ? t?.title : "Selected work")
                      }
                      value={r.startDate}
                      onChange={(v) => update(r.taskId, "startDate", v)}
                      disabled={locked}
                    />
                    <ScheduleDeadline
                      row={r}
                      disabled={locked}
                      onChange={(v) => {
                        freezeContext(inspectedContext);
                        setRows((rows) =>
                          rows.map((old) =>
                            old.taskId === r.taskId ? { ...old, ...v } : old,
                          ),
                        );
                      }}
                    />
                  </>
                )}
                <ExecutionField
                  label={"Reason: " + (ready ? t?.title : "Selected work")}
                  value={r.reason}
                  onChange={(v) => update(r.taskId, "reason", v)}
                  disabled={locked}
                  multiline
                />
              </View>
            );
          })}
          <Action
            title={
              preview.attempt
                ? "Retry same schedule preview"
                : "Preview schedule"
            }
            disabled={
              !ready ||
              preview.busy ||
              !selected.length ||
              rows.some((r) => selected.includes(r.taskId) && !r.reason.trim())
            }
            primary
            onPress={() =>
              void run(async () => {
                let changes = rows.filter((r) => selected.includes(r.taskId));
                if (method === "calendar_day_shift") {
                  const delta = Number(offset);
                  if (!Number.isInteger(delta) || Math.abs(delta) > 366)
                    throw Error("Invalid offset");
                  changes = changes.map((r) => {
                    if (r.deadlineMode === "timed" || !r.dueDate)
                      throw Error("Review timed and missing dates manually");
                    const shift = (date: string) => {
                      if (!date) return "";
                      const d = new Date(date + "T12:00:00Z");
                      d.setUTCDate(d.getUTCDate() + delta);
                      return d.toISOString().slice(0, 10);
                    };
                    return {
                      ...r,
                      startDate: shift(r.startDate),
                      dueDate: shift(r.dueDate),
                      dueAt: "",
                      dueTimezone: "",
                    };
                  });
                }
                const ids = [
                  ...new Set(
                    tasks
                      .filter((t) => selected.includes(t.id))
                      .map((t) => t.projectId)
                      .filter(Boolean),
                  ),
                ];
                const projects =
                  inspectedContext?.projects ??
                  (await Promise.all(
                    ids.map(async (id) => {
                      const p =
                        project?.id === id
                          ? project
                          : (
                              await client.request<ProjectDetail>(
                                `/companies/${w.company}/projects/${id}`,
                              )
                            ).project;
                      if (!p) throw Error("Inspect the current project first.");
                      return { id: p.id, version: p.version };
                    }),
                  ));
                const result = await preview.execute<{
                  proposal: ScheduleProposalView;
                }>("/task-schedule/preview", {
                  method,
                  ...(method === "calendar_day_shift"
                    ? { dayOffset: Number(offset) }
                    : {}),
                  changes,
                  context: inspectedContext ?? { projects, milestones: [] },
                });
                setProposalId(result.proposal.id);
              })
            }
          />
        </>
      )}
      {!!proposalId && (
        <>
          <ExecutionStatus query={q} />
          {q.data && (
            <>
              <Text>Expires: {q.data.proposal.expiresAt}</Text>
              <Text>{q.data.proposal.notice}</Text>
              {q.data.proposal.rows.map((r) => (
                <View key={r.taskId}>
                  <Text>{r.title}</Text>
                  <Text>Original: {commitmentLabel(r.original)}</Text>
                  <Text>Before preview: {commitmentLabel(r.before)}</Text>
                  <Text>Current: {commitmentLabel(r.current)}</Text>
                  <Text>Proposed: {commitmentLabel(r.after)}</Text>
                  <Text>Reason: {r.reason}</Text>
                </View>
              ))}
              {q.data.proposal.advisories.map((a) => (
                <Text key={a}>{a}</Text>
              ))}
              {q.data.proposal.expired && (
                <Text>
                  This preview expired. Inspect and make a fresh preview.
                </Text>
              )}
              <Action
                title="Edit and create a fresh preview"
                disabled={!ready || apply.busy || !!apply.attempt}
                onPress={() => setProposalId("")}
              />
              <Action
                title={
                  apply.attempt
                    ? "Retry same schedule confirmation"
                    : "Confirm reviewed schedule"
                }
                disabled={
                  !ready || apply.busy || (q.data.proposal.expired && !apply.attempt)
                }
                primary
                onPress={() =>
                  void run(async () => {
                    await apply.execute(
                      "/task-schedule/apply",
                      {
                        proposalId: q.data!.proposal.id,
                        expectedProposalVersion: q.data!.proposal.version,
                      },
                      "POST",
                      () =>
                        retireSchedule({
                          rows,
                          selected,
                          proposal: proposalId,
                          method,
                          offset,
                        }),
                    );
                    setProposalId("");

                    onDone?.();
                  })
                }
              />
            </>
          )}
        </>
      )}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
      <ExecutionAttempt action={preview} />
      <ExecutionAttempt action={apply} />
      <Action
        title="Cancel schedule review"
        disabled={!ready || preview.busy || apply.busy}
        onPress={onDone ?? (() => setProposalId(""))}
      />
    </View>
  );
}
function ScheduleDeadline({
  row,
  onChange,
  disabled,
}: {
  row: ScheduleChange;
  onChange: (v: Partial<ScheduleChange>) => void;
  disabled: boolean;
}) {
  const [time, setTime] = useState(() =>
    row.deadlineMode === "timed"
      ? deadlineLocalTime(row.dueAt, row.dueTimezone || "Asia/Kolkata")
      : "",
  );
  const [instant, setInstant] = useState(row.dueAt);
  const w = useWorkspace();
  const zone = row.dueTimezone || w.work?.company.timezone || "Asia/Kolkata";
  function publish(date: string, time: string, instant: string, zone: string) {
    setTime(time);
    setInstant(instant);
    try {
      onChange(workDeadline(date, time, zone, instant));
    } catch {
      onChange({
        dueDate: date,
        deadlineMode: time ? "timed" : "all_day",
        dueTimezone: time ? zone : "",
        dueAt: "",
      });
    }
  }
  return (
    <View>
      <NativeDeadline
        timezone={zone}
        onTimezone={(zone) => publish(row.dueDate, time, "", zone)}
        date={row.dueDate}
        time={time}
        instant={instant}
        onChange={(v) => publish(v.date, v.time, v.instant, zone)}
        disabled={disabled}
      />
    </View>
  );
}

export function NativeTemplates({
  task,
  onDone,
}: {
  task?: WorkTask;
  onDone?: () => void;
}) {
  const w = useWorkspace();
  const kind = task ? "checklist" : "task";
  const q = useExecutionRead<{ templates: TaskTemplateView[] }>(
    `/task-templates?kind=${kind}`,
  );
  const projects = useExecutionRead<{ projects: ExecutionProject[] }>(
    "/projects",
    !task,
  );
  const [selected, setSelected] = useRamInput(
    "$template:" + kind,
    "selected",
    "",
  );
  const source = useExecutionRead<{ template: TaskTemplateView }>(
    `/task-templates/${selected}`,
    !!selected,
  );
  const [project, setProject] = useRamInput("$template:" + kind, "project", "");
  const p = useExecutionRead<ProjectDetail>(`/projects/${project}`, !!project);
  const [anchor, setAnchor] = useRamInput("$template:" + kind, "anchor", () =>
    companyDate(new Date(), w.work?.company.timezone ?? "Asia/Kolkata"),
  );
  const [preview, setPreview] = useState<TemplatePreview>();
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const capture = useExecutionGuard(selected + ":" + project);
  const action = useExecutionMutation("template-apply:" + (task?.id ?? "new"));
  const [managing, setManaging] = useRamInput(
    "$template:" + kind,
    "managing",
    false,
  );
  const reviewedFields =
    (action.attempt?.payload.fields as Record<string, unknown>) ?? fields;
  const locked = action.busy || !!action.attempt;
  const scrubTemplate = useEffectEvent(() => {
    action.abandon();
    setPreview(undefined);
    setFields({});
    setManaging(false);
    clearConversationDrafts(
      w.company,
      w.session?.user.id ?? "",
      "$template-manage:" + (selected || kind),
    );
    clearConversationDrafts(
      w.company,
      w.session?.user.id ?? "",
      "$template:" + kind,
    );
  });
  useEffect(() => {
    if (source.denied || p.denied)
      void Promise.resolve().then(() => scrubTemplate());
  }, [source.denied, p.denied]);
  return (
    <View>
      <Text style={ui.title}>
        {task ? "Reusable checklist" : "Task templates"}
      </Text>
      <ExecutionStatus query={q} />
      {q.data?.templates.map((t) => (
        <Action
          key={t.id}
          title={t.name}
          selected={selected === t.id}
          disabled={locked}
          onPress={() => {
            setSelected(t.id);
            setPreview(undefined);
          }}
        />
      ))}
      {source.data && (
        <>
          <Text>{source.data.template.description}</Text>
          <Text>{source.data.template.defaults.checklist.join("\n")}</Text>
          {!task && (
            <>
              <Action
                title="Independent task"
                disabled={locked}
                selected={!project}
                onPress={() => setProject("")}
              />
              {projects.data?.projects.map((p) => (
                <Action
                  key={p.id}
                  title={"Project: " + p.name}
                  disabled={locked}
                  selected={project === p.id}
                  onPress={() => {
                    setProject(p.id);
                    setPreview(undefined);
                  }}
                />
              ))}
              <ExecutionField
                label="Explicit template anchor date"
                value={anchor}
                onChange={(v) => {
                  setAnchor(v);
                  setPreview(undefined);
                }}
                disabled={locked}
              />
              <Action
                title="Preview template"
                disabled={locked || (!!project && !p.ready)}
                onPress={() => {
                  const isCurrent = capture();
                  void client
                    .request<TemplatePreview>(
                      `/companies/${w.company}/task-templates/${selected}/preview`,
                      "POST",
                      {
                        expectedTemplateVersion: source.data!.template.version,
                        fields: {},
                        anchorDate: anchor,
                        projectId: project,
                        expectedProjectVersion: p.data?.project.version ?? 0,
                      },
                    )
                    .then((v) => {
                      if (!isCurrent()) return;
                      setPreview(v);
                      setFields(v.fields);
                      setError("");
                    })
                    .catch(() => {
                      if (isCurrent())
                        setError(
                          "Unable to preview current template. Retry when connected.",
                        );
                    });
                }}
              />
            </>
          )}
          {task && task.status === "done" && (
            <Text>
              Accepted work must be reopened through its existing review
              workflow before changing structure.
            </Text>
          )}
          {source.data && (preview || task || action.attempt) && (
            <>
              <Text>Review concrete values before confirming.</Text>
              {preview?.unresolved.map((v) => (
                <Text key={v}>Required choice: {v}</Text>
              ))}
              {!task && (
                <>
                  <ExecutionField
                    label="Reviewed task title"
                    value={String(reviewedFields.title ?? "")}
                    disabled={locked}
                    onChange={(v) => setFields((f) => ({ ...f, title: v }))}
                  />
                  <PersonPicker
                    label="Reviewed owner"
                    people={w.work?.people ?? []}
                    value={String(reviewedFields.ownerId ?? "")}
                    onChange={(v) => setFields((f) => ({ ...f, ownerId: v }))}
                    disabled={locked}
                  />
                  <PersonPicker
                    label="Independent reviewer"
                    people={(w.work?.people ?? []).filter(
                      (p) => p.role !== "viewer",
                    )}
                    value={String(reviewedFields.reviewerId ?? "")}
                    excludeIds={[String(reviewedFields.ownerId ?? "")]}
                    allowNone
                    onChange={(v) =>
                      setFields((f) => ({ ...f, reviewerId: v }))
                    }
                    disabled={locked}
                  />
                  <ExecutionField
                    label="Reviewed all-day due date"
                    value={String(reviewedFields.dueDate ?? "")}
                    onChange={(v) =>
                      setFields((f) => ({
                        ...f,
                        dueDate: v,
                        deadlineMode: "all_day",
                        dueAt: "",
                        dueTimezone: "",
                      }))
                    }
                    disabled={locked}
                  />
                  <Text>
                    {reviewedFields.requiresApproval
                      ? "Independent review is required."
                      : "No independent approval required by these defaults."}
                  </Text>
                </>
              )}
              <Action
                title={
                  action.attempt
                    ? "Retry same template application"
                    : task
                      ? "Append fresh unchecked items"
                      : "Create reviewed task"
                }
                primary
                disabled={
                  action.busy ||
                  !source.ready ||
                  (task
                    ? task.status === "done"
                    : !reviewedFields.title ||
                      !reviewedFields.ownerId ||
                      (!!reviewedFields.requiresApproval &&
                        !reviewedFields.reviewerId))
                }
                onPress={() =>
                  void action
                    .execute(
                      task
                        ? `/tasks/${task.id}/checklists/apply`
                        : `/task-templates/${selected}/apply`,
                      task
                        ? {
                            templateId: selected,
                            version: task.version,
                            expectedTemplateVersion:
                              source.data!.template.version,
                          }
                        : {
                            anchorDate: anchor,
                            projectId: project,
                            expectedProjectVersion:
                              preview?.projectVersion ??
                              action.attempt?.payload.expectedProjectVersion,
                            expectedTemplateVersion:
                              preview?.templateVersion ??
                              action.attempt?.payload.expectedTemplateVersion,
                            fields,
                          },
                    )
                    .then(() => onDone?.())
                    .catch(() => {})
                }
              />
            </>
          )}
        </>
      )}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
      <ExecutionAttempt action={action} />
      <Action
        title={"Manage " + kind + " templates"}
        onPress={() => setManaging(true)}
      />
      {managing && (!selected || source.ready) && (
        <Sheet
          keyboard
          title="Template management"
          onClose={() => setManaging(false)}
        >
          <NativeTemplateForm
            kind={kind}
            template={source.data?.template}
            onDone={() => {
              setManaging(false);
              q.retry();
              source.retry();
            }}
          />
        </Sheet>
      )}
    </View>
  );
}
function NativeTemplateForm({
  kind,
  template,
  onDone,
}: {
  kind: "task" | "checklist";
  template?: TaskTemplateView;
  onDone: () => void;
}) {
  const w = useWorkspace();
  const form = "$template-manage:" + (template?.id ?? kind);
  const { basis: version, freeze: freezeBasis } = useExecutionBasis(
    form,
    template?.version ?? 0,
  );
  const retire = useAuthoredRetirement(form);
  const action = useExecutionMutation(
    "template-form:" + (template?.id ?? kind),
  );
  const [name, setName] = useRamInput(form, "name", template?.name ?? "");
  const [description, setDescription] = useRamInput(
    form,
    "description",
    template?.description ?? "",
  );
  const [owner, setOwner] = useRamInput(
    form,
    "owner",
    template?.scopeOwnerId ?? w.session!.user.id,
  );
  const [department, setDepartment] = useRamInput(
    form,
    "department",
    template?.scopeDepartmentId ?? "",
  );
  const [lines, setLines] = useRamInput(
    form,
    "lines",
    template?.defaults.checklist.join("\n") ?? "",
  );
  const [title, setTitle] = useRamInput(
    form,
    "title",
    template?.defaults.title ?? "",
  );
  const [taskDescription, setTaskDescription] = useRamInput(
    form,
    "taskDescription",
    template?.defaults.description ?? "",
  );
  const [priority, setPriority] = useRamInput(
    form,
    "priority",
    template?.defaults.priority || "medium",
  );
  const [estimate, setEstimate] = useRamInput(
    form,
    "estimate",
    String(template?.defaults.estimatedHours ?? 0),
  );
  const [tags, setTags] = useRamInput(
    form,
    "tags",
    (template?.defaults.tags ?? []).join(", "),
  );
  const [status, setStatus] = useRamInput(
    form,
    "status",
    template?.defaults.status ?? "todo",
  );
  const [policy, setPolicy] = useRamInput(
    form,
    "policy",
    template?.defaults.ownerPolicy ?? "actor",
  );
  const [fixed, setFixed] = useRamInput(
    form,
    "fixed",
    template?.defaults.fixedOwnerId ?? "",
  );
  const [reviewer, setReviewer] = useRamInput(
    form,
    "reviewer",
    template?.defaults.reviewerId ?? "",
  );
  const [required, setRequired] = useRamInput(
    form,
    "required",
    template?.defaults.requiresApproval ?? false,
  );
  const [days, setDays] = useRamInput(
    form,
    "days",
    template?.defaults.relativeDueDays === undefined
      ? ""
      : String(template.defaults.relativeDueDays),
  );

  const locked = action.busy || !!action.attempt;
  const payload = (archived = false) => ({
    name,
    description,
    scopeOwnerId: owner,
    scopeDepartmentId: department,
    ...(template ? { version, archived } : { kind }),
    defaults:
      kind === "checklist"
        ? {
            checklist: lines
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
          }
        : {
            title,
            description: taskDescription,
            priority,
            estimatedHours: Number(estimate),
            tags: tags
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            ownerPolicy: policy,
            fixedOwnerId: fixed,
            reviewerId: reviewer,
            requiresApproval: required,
            ...(days.trim() ? { relativeDueDays: Number(days) } : {}),
            checklist: lines
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
            status,
          },
  });
  return (
    <View>
      <Text>
        {template
          ? "Edit captured template version " + version
          : "New template"}
      </Text>
      <ExecutionField
        label="Template name"
        value={name}
        onChange={(v) => {
          freezeBasis();
          setName(v);
        }}
        disabled={locked}
      />
      <ExecutionField
        label="Template description"
        value={description}
        onChange={(v) => {
          freezeBasis();
          setDescription(v);
        }}
        disabled={locked}
      />
      <PersonPicker
        label="Template scope owner"
        people={w.work?.people ?? []}
        value={owner}
        onChange={(v) => {
          freezeBasis();
          setOwner(v);
        }}
        disabled={locked}
      />
      <Action
        title="No department scope"
        disabled={locked}
        onPress={() => {
          freezeBasis();
          setDepartment("");
        }}
      />
      {w.work?.departments.map((d) => (
        <Action
          key={d.id}
          title={"Scope department: " + d.name}
          selected={department === d.id}
          disabled={locked}
          onPress={() => {
            freezeBasis();
            setDepartment(d.id);
          }}
        />
      ))}
      <ExecutionField
        label="Checklist labels, one per line"
        value={lines}
        onChange={(v) => {
          freezeBasis();
          setLines(v);
        }}
        disabled={locked}
        multiline
      />
      {kind === "task" && (
        <>
          <ExecutionField
            label="Default task title"
            value={title}
            onChange={(v) => {
              freezeBasis();
              setTitle(v);
            }}
            disabled={locked}
          />
          <ExecutionField
            label="Default task description"
            value={taskDescription}
            onChange={(v) => {
              freezeBasis();
              setTaskDescription(v);
            }}
            disabled={locked}
            multiline
          />
          {["critical", "high", "medium", "low"].map((p) => (
            <Action
              key={p}
              title={"Default priority: " + p}
              selected={priority === p}
              disabled={locked}
              onPress={() => {
                freezeBasis();
                setPriority(p);
              }}
            />
          ))}
          <ExecutionField
            label="Default estimated hours"
            value={estimate}
            onChange={(v) => {
              freezeBasis();
              setEstimate(v);
            }}
            disabled={locked}
          />
          <ExecutionField
            label="Default tags, comma separated"
            value={tags}
            onChange={(v) => {
              freezeBasis();
              setTags(v);
            }}
            disabled={locked}
          />
          {(["todo", "backlog"] as const).map((v) => (
            <Action
              key={v}
              title={"Initial status: " + v}
              selected={status === v}
              disabled={locked}
              onPress={() => {
                freezeBasis();
                setStatus(v);
              }}
            />
          ))}
          {(
            ["actor", "fixed", "project_owner", "project_default"] as const
          ).map((p) => (
            <Action
              key={p}
              title={"Owner policy: " + p}
              selected={p === policy}
              disabled={locked}
              onPress={() => {
                freezeBasis();
                setPolicy(p);
              }}
            />
          ))}
          {policy === "fixed" && (
            <PersonPicker
              label="Fixed task owner"
              people={w.work?.people ?? []}
              value={fixed}
              onChange={(v) => {
                freezeBasis();
                setFixed(v);
              }}
              disabled={locked}
            />
          )}
          <PersonPicker
            label="Default independent reviewer"
            people={w.work?.people ?? []}
            value={reviewer}
            excludeIds={[fixed]}
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
          <ExecutionField
            label="Relative due days"
            value={days}
            onChange={(v) => {
              freezeBasis();
              setDays(v);
            }}
            disabled={locked}
          />
        </>
      )}
      <Action
        title={action.attempt ? "Retry same template save" : "Save template"}
        primary
        disabled={action.busy || !name.trim()}
        onPress={() =>
          void action
            .execute(
              template ? `/task-templates/${template.id}` : "/task-templates",
              payload(),
              template ? "PATCH" : "POST",
              () =>
                retire({
                  name,
                  description,
                  owner,
                  department,
                  lines,
                  title,
                  taskDescription,
                  priority,
                  estimate,
                  tags,
                  status,
                  policy,
                  fixed,
                  reviewer,
                  required,
                  days,
                  expectedBasis: version,
                }),
            )
            .then(onDone)
            .catch(() => {})
        }
      />
      {template && (
        <Action
          title="Archive template"
          disabled={locked}
          onPress={() =>
            void action
              .execute(`/task-templates/${template.id}`, payload(true), "PATCH")
              .then(onDone)
              .catch(() => {})
          }
        />
      )}
      <ExecutionAttempt action={action} />
    </View>
  );
}
export function NativeProjectChoice({
  value,
  onSelect,
  disabled,
}: {
  value: string;
  onSelect: (p: ExecutionProject | null) => void;
  disabled: boolean;
}) {
  const w = useWorkspace();
  const q = useExecutionRead<{ projects: ExecutionProject[] }>("/projects");
  const [error, setError] = useState("");
  const capture = useExecutionGuard("project-choice");
  return (
    <View>
      <Text>Selected project</Text>
      <ExecutionStatus query={q} />
      <Action
        title="Independent task"
        selected={!value}
        disabled={disabled}
        onPress={() => onSelect(null)}
      />
      {q.data?.projects.map((p) => (
        <Action
          key={p.id}
          title={"Project: " + p.name}
          selected={p.id === value}
          disabled={disabled}
          onPress={() => {
            const generation = client.generation;
            const isCurrent = capture();
            void client
              .request<ProjectDetail>(
                `/companies/${w.company}/projects/${p.id}`,
              )
              .then((r) => {
                if (generation === client.generation && isCurrent()) {
                  onSelect(r.project);
                  setError("");
                }
              })
              .catch(() => {
                if (isCurrent())
                  setError("Inspect current project access before choosing.");
              });
          }}
        />
      ))}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
    </View>
  );
}
