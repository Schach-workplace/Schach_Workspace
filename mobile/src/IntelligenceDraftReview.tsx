import { router } from "expo-router";
import { expenseLabels } from "../../shared/finance/labels";
import { client } from "./client";
import {
  Fragment,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Text, View } from "react-native";
import { Action } from "./ConnectUI";
import { ReportField, ReportChoice } from "./ReportControls";
import PersonPicker from "./PersonPicker";
import { useWorkspace } from "./Workspace";
import { useRamInput } from "./ramInput";
import { clearConversationDrafts } from "./conversationDrafts";
import { useExecutionMutation, useExecutionRead } from "./execution";
import {
  useBusinessAttempt,
  clearAttemptScope,
  businessAttemptGeneration,
  subscribeAttempts,
} from "./businessAttempts";
import {
  intelligenceRequest,
  type IntelligenceJob,
} from "./intelligenceClient";
import {
  emptyIntelligenceAuthored,
  intelligenceReviewRequest,
  intelligencePublicationOperation,
  intelligenceReviewIdentity,
  type IntelligenceAuthored,
} from "../../shared/intelligence/publication";
export default function IntelligenceDraftReview({
  jobId,
  index,
  kind = "task",
  job,
  denied,
  current: authorized,
}: {
  jobId: string;
  index: number;
  kind?: "task" | "expense" | "intake";
  job?: IntelligenceJob;
  denied: boolean;
  current: boolean;
}) {
  const w = useWorkspace();
  const form = "$intelligence-review:" + jobId + ":" + index;
  const [authored, setAuthored] = useRamInput<IntelligenceAuthored>(
    form,
    "authored",
    emptyIntelligenceAuthored,
  );
  const candidate =
    job?.result?.operation === "action_draft"
      ? job.result.candidates[index]
      : undefined;
  const mutation = useExecutionMutation(form, [
    "/intelligence/jobs/" + jobId + "/publication-access",
  ]);
  const frozen = useBusinessAttempt<Record<string, unknown>>(form);
  const unknown = frozen.attempt?.state === "unknown";
  const proof = useExecutionRead<{ current: boolean; committed: boolean }>(
    "/intelligence/jobs/" + jobId + "/publication-access",
    unknown,
    {
      intelligenceBasis: frozen.attempt?.payload?.intelligenceBasis,
      retryKey: frozen.attempt?.retryKey,
      operation: intelligencePublicationOperation(frozen.attempt?.target?.path),
    },
  );
  // This is layout intent only: current job proof still supplies every option,
  // label and publication gate. Pending reads must not dismiss a first picker.
  const [privateMode, setPrivateMode] = useState(
    !!job?.publication?.conversationId,
  );
  if (job && privateMode !== !!job.publication?.conversationId)
    setPrivateMode(!!job.publication?.conversationId);
  const privateReview = privateMode || !!authored.anchorMessageId;
  const actionPath =
    "/conversations/" +
    (job?.publication?.conversationId ?? "") +
    "/work-actions?anchorMessageId=" +
    encodeURIComponent(authored.anchorMessageId);
  const actions = useExecutionRead<{
    actions: { id: string; title: string; sourceRevision: number }[];
  }>(
    actionPath,
    !!job &&
      kind === "task" &&
      !!job.publication?.conversationId &&
      !!authored.anchorMessageId,
  );
  const selectedAnchor = job?.publication?.sources.find(
    (s) => s.messageId === authored.anchorMessageId,
  );
  const actionOptions = actions.ready
    ? [
        { id: "primary", name: "Primary instruction" },
        ...(actions.data?.actions ?? [])
          .filter((a) => a.sourceRevision === selectedAnchor?.revision)
          .map((a) => ({ id: a.id, name: a.title })),
      ]
    : [];
  const actionsCurrent =
    !privateReview ||
    kind !== "task" ||
    (!!selectedAnchor &&
      actions.ready &&
      actionOptions.some((a) => a.id === authored.actionId));
  const sourceDenied = unknown ? !!proof.denied : denied;
  const canConfirm = unknown
    ? proof.ready && !!proof.data?.current
    : authorized && !denied && actionsCurrent;
  const retryProof = useEffectEvent(() => {
    void proof.retry();
  });
  useEffect(() => {
    if (!unknown) return;
    const timer = setInterval(retryProof, 5000);
    return () => clearInterval(timer);
  }, [unknown]);
  const [preview, setPreview] = useState<{
    audienceUserIds: string[];
    notice: string;
    intelligenceReviewHash: string;
    outcome?: "created" | "existing";
    existingTaskId?: string;
    existingTaskTitle?: string;
  }>();
  const [ack, setAck] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ id: string; outcome?: string }>();
  // Workspace record/attention/execution epochs trigger fresh reads, including
  // ordinary successful polls. Current proof/semantic binding below, not those
  // counters, decides whether the inspected human review is still the same.
  const scope = JSON.stringify([
    client.endpoint,
    client.generation,
    w.company,
    w.session?.user.id,
    w.work?.readBasis,
    w.policyEpoch,
    w.foreground,
  ]);
  const current = useRef(scope);
  const revision = useRef(0);
  const binding = job
    ? intelligenceReviewIdentity(job, index, kind)
    : undefined;
  const retirement = useSyncExternalStore(
    subscribeAttempts,
    businessAttemptGeneration,
  );
  const [inspected, setInspected] = useState({ scope, binding, retirement });
  // A pending read supplies no raw job. Keep only the local review continuity;
  // the render/confirm gates still require current positive proof. A response
  // overlapping this interval may settle, but stays hidden until that proof.
  if (
    inspected.scope !== scope ||
    inspected.retirement !== retirement ||
    (binding !== undefined && inspected.binding !== binding) ||
    (authorized && !job && inspected.binding !== undefined)
  ) {
    setInspected({ scope, binding, retirement });
    setPrivateMode(!!job?.publication?.conversationId);
    setPreview(undefined);
    setAck(false);
  }
  useLayoutEffect(() => {
    current.current = scope;
    revision.current++;
  }, [scope, inspected]);
  useEffect(
    () => () => {
      current.current = "";
      revision.current++;
    },
    [],
  );
  const [previousDenied, setPreviousDenied] = useState(sourceDenied);
  if (previousDenied !== sourceDenied) {
    setPreviousDenied(sourceDenied);
    if (sourceDenied) {
      setPrivateMode(false);
      setPreview(undefined);
      setAck(false);
    }
  }
  const retireDenied = useEffectEvent(() => {
    clearAttemptScope(frozen.scope);
    revision.current++;
    clearConversationDrafts(w.company, w.session?.user.id ?? "", form);
  });
  useEffect(() => {
    if (sourceDenied) retireDenied();
  }, [sourceDenied, form, scope]);
  const write = (key: keyof IntelligenceAuthored, value: string) => {
    revision.current++;
    setAuthored({
      ...authored,
      [key]: value,
      ...(key === "anchorMessageId" ? { actionId: "" } : {}),
    });
    setPreview(undefined);
    setAck(false);
  };
  const resolved = {
    ...authored,
    title: authored.title || candidate?.title || "",
    description: authored.description || candidate?.description || "",
  };
  async function review() {
    if (!job || !candidate) return;
    if (
      privateReview &&
      kind === "task" &&
      (!actions.ready || !actionOptions.some((a) => a.id === authored.actionId))
    ) {
      setError("Choose a current supported instruction action.");
      return;
    }
    const captured = scope;
    const serial = revision.current;
    const capturedRetirement = businessAttemptGeneration();
    try {
      const plan = intelligenceReviewRequest(
        job,
        candidate,
        resolved,
        "",
        w.work?.company.currency,
      );
      const body = plan.previewPath.endsWith("/task-preview")
        ? plan.previewPayload
        : { ...plan.previewPayload, retryKey: "intelligence-review" };
      const p = await intelligenceRequest<typeof preview>(
        w.company,
        plan.previewPath,
        body,
      );
      if (
        current.current === captured &&
        revision.current === serial &&
        businessAttemptGeneration() === capturedRetirement
      )
        setPreview(p);
    } catch (e) {
      if (
        current.current === captured &&
        revision.current === serial &&
        businessAttemptGeneration() === capturedRetirement
      )
        setError((e as Error).message);
    }
  }
  async function confirm() {
    if (!canConfirm) return;
    try {
      if (frozen.attempt?.state === "unknown" && frozen.attempt.target) {
        await mutation.execute<{ id: string; outcome?: string }>(
          frozen.attempt.target.path,
          frozen.attempt.payload,
          "POST",
          (r) => setSuccess(r),
        );
        return;
      }
      if (!job || !candidate || !preview || !ack) return;
      const plan = intelligenceReviewRequest(
        job,
        candidate,
        resolved,
        preview.intelligenceReviewHash,
        w.work?.company.currency,
      );
      await mutation.execute<{ id: string; outcome?: string }>(
        plan.path,
        plan.payload,
        "POST",
        (r) => setSuccess(r),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <Text>Review selected draft</Text>
      {!job && (
        <Text accessibilityRole="alert">
          Checking current sources. Authored fields remain here.
        </Text>
      )}
      {success ? (
        <View>
          <Text>
            {success.outcome === "existing"
              ? "This action already has work. Reviewed fields were not applied."
              : "Created work successfully."}
          </Text>
          {success.outcome === "existing" && (
            <Action
              title="Open existing work"
              onPress={() =>
                router.push({
                  pathname: "/task/[id]",
                  params: { id: success.id, company: w.company },
                })
              }
            />
          )}
        </View>
      ) : (
        <>
          <ReportField
            label="Reviewed intelligence title"
            value={resolved.title}
            onChange={(v) => write("title", v)}
          />
          <ReportField
            label="Reviewed intelligence description"
            value={resolved.description}
            onChange={(v) => write("description", v)}
          />
          {privateReview && (
            <Fragment
              key={JSON.stringify([
                scope,
                inspected.binding,
                retirement,
                sourceDenied,
              ])}
            >
              <ReportChoice
                label="Source anchor"
                value={authored.anchorMessageId}
                authorized={!!job}
                options={(job?.publication?.sources ?? []).map((s, i) => ({
                  id: s.messageId,
                  name:
                    "Selected message " +
                    (i + 1) +
                    " (revision " +
                    s.revision +
                    ")",
                }))}
                onChange={(v) => write("anchorMessageId", v)}
              />
              {kind === "task" && (
                <ReportChoice
                  label="Instruction action"
                  value={authored.actionId}
                  authorized={!!job && actions.ready}
                  options={actionOptions}
                  onChange={(v) => write("actionId", v)}
                />
              )}
            </Fragment>
          )}
          <PersonPicker
            label="Intelligence owner"
            people={w.work?.people ?? []}
            value={authored.ownerId}
            authorized={!!job}
            onChange={(v) => write("ownerId", v)}
          />
          <PersonPicker
            label="Intelligence reviewer"
            people={w.work?.people ?? []}
            value={authored.reviewerId}
            excludeIds={[authored.ownerId]}
            authorized={!!job}
            onChange={(v) => write("reviewerId", v)}
          />
          <ReportField
            label="Intelligence deadline"
            calendar="date"
            timezone={w.work?.company.timezone}
            value={authored.dueDate}
            pickerDisabled={!job}
            onChange={(v) => write("dueDate", v)}
          />
          <ReportChoice
            label="Department"
            options={w.work?.departments ?? []}
            value={authored.departmentId}
            authorized={!!job}
            onChange={(v) => write("departmentId", v)}
          />
          {kind === "expense" && (
            <>
              <ReportChoice
                label="Expense category"
                options={w.work?.expenseCategories ?? []}
                value={authored.categoryId}
                authorized={!!job}
                onChange={(v) => write("categoryId", v)}
              />
              {(["vendor", "amount", "currency", "expenseDate"] as const).map(
                (key) => (
                  <ReportField
                    key={key}
                    label={expenseLabels[key]}
                    keyboardType={key === "amount" ? "decimal-pad" : undefined}
                    value={authored[key]}
                    calendar={key === "expenseDate" ? "date" : undefined}
                    onChange={(v) => write(key, v)}
                  />
                ),
              )}
            </>
          )}
          <Action
            title="Preview content and audience"
            disabled={
              !job || !actionsCurrent || mutation.busy || !!frozen.attempt
            }
            onPress={() => void review()}
          />
          {job && actionsCurrent && preview && (
            <>
              <Text>{preview.notice}</Text>
              {preview.outcome === "existing" && (
                <Text>
                  Existing work: {preview.existingTaskTitle}. Reviewed fields
                  will not be applied.
                </Text>
              )}
              <Text>
                {preview.audienceUserIds
                  .map(
                    (id) =>
                      w.work?.people.find((p) => p.id === id)?.name ??
                      "Current audience member",
                  )
                  .join(", ")}
              </Text>
              <Action
                title="I reviewed these fields and this audience"
                selected={ack}
                onPress={() => setAck(!ack)}
              />
            </>
          )}
          <Action
            title={
              frozen.attempt
                ? "Retry original submitted draft"
                : preview?.outcome === "existing"
                  ? "Confirm existing work"
                  : "Confirm reviewed creation"
            }
            disabled={
              mutation.busy ||
              !canConfirm ||
              (!frozen.attempt && (!job || !preview || !ack))
            }
            onPress={() => void confirm()}
          />
        </>
      )}
      {error !== "" && <Text accessibilityRole="alert">{error}</Text>}
    </View>
  );
}
