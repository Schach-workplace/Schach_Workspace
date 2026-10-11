import { useRamInput } from "./ramInput";
import { useBusinessAttempt } from "./businessAttempts";
import IntelligenceGeometry from "./IntelligenceGeometry";
import { useLayoutEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Action } from "./ConnectUI";
import { ReportChoice } from "./ReportControls";
import { useWorkspace } from "./Workspace";
import { useExecutionRead, useExecutionMutation } from "./execution";
import {
  intelligenceRequest,
  useIntelligence,
  type IntelligenceCapabilities,
  type IntelligenceJob,
  type IntelligenceOperation,
  type IntelligencePreview,
  type IntelligenceSourceRequest,
} from "./intelligenceClient";
import IntelligenceSelection, {
  type IntelligenceChoice,
} from "./IntelligenceSelection";
import IntelligenceResult from "./IntelligenceResult";
import IntelligenceDraftReview from "./IntelligenceDraftReview";
import { canonicalSelection } from "../../shared/intelligence/selection";
export default function IntelligenceScreen({
  choices = [],
  initialOperation = "summary",
  initialJob = "",
}: {
  choices?: IntelligenceChoice[];
  initialOperation?: IntelligenceOperation;
  initialJob?: string;
}) {
  const w = useWorkspace();
  const frozen = useBusinessAttempt<Record<string, unknown>>(
    "$intelligence-enqueue",
  );
  const [selected, setSelected] = useState<IntelligenceSourceRequest[]>([]);
  const [operation, setOperation] =
    useState<IntelligenceOperation>(initialOperation);
  const [preview, setPreview] = useState<IntelligencePreview>();
  const [optIn, setOptIn] = useState(false);
  const [jobId, setJobId] = useRamInput(
    "$intelligence-panel",
    "job:" + initialJob,
    initialJob,
  );
  const [draft, setDraft] = useRamInput<{
    index: number;
    kind: "task" | "expense" | "intake";
  } | null>("$intelligence-panel", "draft:" + initialJob, null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState<IntelligenceChoice>();
  const capabilities = useExecutionRead<IntelligenceCapabilities>(
    "/intelligence/capabilities",
  );
  const history = useExecutionRead<{ jobs: IntelligenceJob[] }>(
    "/intelligence/jobs",
  );
  const job = useIntelligence(jobId);
  const enqueue = useExecutionMutation(
    "$intelligence-enqueue",
    selected.map((s) =>
      s.conversationId
        ? "/conversations/" + s.conversationId
        : "/tasks/" + (s.parentId || s.id),
    ),
  );
  const scope = w.company + ":" + w.session?.user.id + ":" + w.policyEpoch;
  const latest = useRef(scope);
  const revision = useRef(0);
  const live = useRef(true);
  const selectionBasis = JSON.stringify([
    selected,
    operation,
    scope,
    w.foreground,
    w.recordEpoch,
  ]);
  const [previewOwner, setPreviewOwner] = useState(selectionBasis);
  if (previewOwner !== selectionBasis) {
    setPreviewOwner(selectionBasis);
    setPreview(undefined);
    setOptIn(false);
  }
  useLayoutEffect(() => {
    latest.current = scope;
    live.current = w.foreground && !!w.work;
    revision.current++;
  }, [selectionBasis, scope, w.foreground, w.work]);
  async function inspect() {
    try {
      setBusy(true);
      setError("");
      const captured = scope;
      const serial = revision.current;
      const p = await intelligenceRequest<IntelligencePreview>(
        w.company,
        "/intelligence/selection-preview",
        canonicalSelection({ operation, sources: selected }),
      );
      if (
        latest.current === captured &&
        revision.current === serial &&
        live.current
      )
        setPreview(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function generate() {
    if (frozen.attempt?.state === "unknown") {
      try {
        await enqueue.execute<{ jobId: string }>(
          "/intelligence/jobs",
          frozen.attempt.payload,
          "POST",
          (r) => {
            setJobId(r.jobId);
            setDraft(null);
            setPreview(undefined);
            setOptIn(false);
          },
        );
      } catch (e) {
        setError((e as Error).message);
      }
      return;
    }
    if (!preview || !optIn) return;
    try {
      await enqueue.execute<{ jobId: string }>(
        "/intelligence/jobs",
        {
          operation,
          sources: selected,
          selectionHash: preview.selectionHash,
          optIn: { accepted: true, policyVersion: preview.policyVersion },
        },
        "POST",
        (r) => {
          setJobId(r.jobId);
          setDraft(null);
          setPreview(undefined);
          setOptIn(false);
        },
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function cancel() {
    try {
      await intelligenceRequest(
        w.company,
        "/intelligence/jobs/" + jobId + "/cancel",
        {},
      );
      job.retry();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const result = job.ready ? job.data : undefined;
  return (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header">Local assistance</Text>
      <Text>
        {capabilities.data?.notice ??
          "Select sources explicitly. Continue normal work while local assistance is unavailable."}
      </Text>
      <ReportChoice
        label="Operation"
        value={operation}
        options={[
          { id: "summary", name: "Summarize selected sources" },
          { id: "transcript", name: "Transcribe selected audio" },
          { id: "action_draft", name: "Suggest reviewed actions" },
          { id: "report_explanation", name: "Explain selected facts" },
        ]}
        onChange={(v) => setOperation(v as IntelligenceOperation)}
      />
      <IntelligenceSelection
        choices={
          w.foreground ? (transcript ? [...choices, transcript] : choices) : []
        }
        selected={selected}
        onChange={setSelected}
        disabled={!w.foreground || busy}
      />
      <Action
        title="Review selected sources"
        disabled={
          !w.foreground ||
          busy ||
          !selected.length ||
          !capabilities.data?.operations[operation]
        }
        onPress={() => void inspect()}
      />
      {w.foreground && preview && (
        <>
          <Text>{preview.sources.map((s) => s.label).join(" · ")}</Text>
          <Action
            title="I agree to local processing of these selected sources"
            selected={optIn}
            onPress={() => setOptIn(!optIn)}
          />
          <Action
            title="Generate local result"
            disabled={!optIn || enqueue.busy}
            onPress={() => void generate()}
          />
        </>
      )}
      {frozen.attempt?.state === "unknown" && (
        <Action
          title="Retry original local request"
          disabled={!w.foreground || enqueue.busy}
          onPress={() => void generate()}
        />
      )}
      {jobId !== "" && (
        <>
          <Text accessibilityRole="alert">
            {job.loading
              ? "Checking current source permissions…"
              : (result?.state ??
                "Result unavailable. Continue manually or retry.")}
          </Text>
          <Action title="Recheck current result" onPress={job.retry} />
          <Action
            title="Cancel and clear this result"
            disabled={!w.foreground}
            onPress={() => void cancel()}
          />
          {result?.reasonCode && (
            <Text>
              {result.reasonCode.replaceAll("_", " ")}. Continue manually or
              reselect sources.
            </Text>
          )}
          <IntelligenceGeometry
            visible={result?.state === "ready" && !!result.result}
          >
            {result?.state === "ready" && result.result && (
              <IntelligenceResult
                job={result}
                onReview={(index, kind) => setDraft({ index, kind })}
                onTranscript={() => {
                  const source: IntelligenceSourceRequest = {
                    kind: "transcript",
                    id: result.jobId,
                    selectedFieldSet: "segments",
                  };
                  setTranscript({ label: "Selected ready transcript", source });
                  setSelected([source]);
                  setOperation("summary");
                }}
              />
            )}
          </IntelligenceGeometry>
          {draft !== null && (
            <IntelligenceDraftReview
              key={`${jobId}:${draft.kind}:${draft.index}`}
              jobId={jobId}
              index={draft.index}
              kind={draft.kind}
              job={result?.state === "ready" ? result : undefined}
              current={job.ready}
              denied={!!job.denied || result?.state === "invalidated"}
            />
          )}
        </>
      )}
      {history.ready && history.data && (
        <>
          <Text>Your local request history</Text>
          {history.data.jobs.map((j, i) => (
            <Action
              key={j.jobId}
              title={
                (j.operation?.replaceAll("_", " ") ?? "Local") +
                " request " +
                (i + 1) +
                " · " +
                j.state
              }
              onPress={() => {
                setJobId(j.jobId);
                setDraft(null);
              }}
            />
          ))}
        </>
      )}
      {error !== "" && <Text accessibilityRole="alert">{error}</Text>}
      <Text>
        Continue manually using the existing conversation, task, finance or
        report tools.
      </Text>
    </View>
  );
}
