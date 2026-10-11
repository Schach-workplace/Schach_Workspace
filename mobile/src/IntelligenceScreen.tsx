import { useRamInput } from "./ramInput";
import {
  businessAttemptGeneration,
  subscribeAttempts,
  useBusinessAttempt,
} from "./businessAttempts";
import { client } from "./client";
import IntelligenceGeometry from "./IntelligenceGeometry";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
  sourceRead,
}: {
  choices?: IntelligenceChoice[];
  initialOperation?: IntelligenceOperation;
  initialJob?: string;
  sourceRead?: { ready: boolean; denied: boolean };
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
  // Summary GETs issue new handles even for identical facts. Reauthorize the
  // exact human-selected snapshot; only Choose latest may replace its handle.
  const selectedReport = useExecutionRead<IntelligencePreview>(
    "/intelligence/selection-preview",
    !!sourceRead &&
      sourceRead.ready &&
      !sourceRead.denied &&
      selected.length > 0,
    { operation, sources: selected },
  );
  const [expiredProof, setExpiredProof] = useState<string>();
  const proofExpiry = selectedReport.data?.expiresAt;
  useEffect(() => {
    if (!proofExpiry) return;
    const timer = setTimeout(
      () => setExpiredProof(proofExpiry),
      Math.max(0, Date.parse(proofExpiry) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [proofExpiry]);
  const enqueue = useExecutionMutation(
    "$intelligence-enqueue",
    selected.map((s) =>
      s.conversationId
        ? "/conversations/" + s.conversationId
        : "/tasks/" + (s.parentId || s.id),
    ),
  );
  const retirement = useSyncExternalStore(
    subscribeAttempts,
    businessAttemptGeneration,
  );
  const scope = JSON.stringify([
    client.endpoint,
    client.generation,
    w.company,
    w.session?.user.id,
    w.work?.readBasis,
    w.policyEpoch,
    w.foreground,
    retirement,
  ]);
  const latest = useRef(scope);
  const revision = useRef(0);
  const live = useRef(true);
  const workspaceReady = w.foreground && !!w.work;
  const selectionBasis = JSON.stringify([
    selected,
    operation,
    scope,
    w.foreground,
    w.recordEpoch,
    !!sourceRead?.denied,
    !!sourceRead && !!selectedReport.error,
  ]);
  const sourceBinding =
    selectedReport.ready && selectedReport.data
      ? JSON.stringify([
          selectedReport.data.selectionHash,
          selectedReport.data.policyVersion,
        ])
      : undefined;
  const [previewOwner, setPreviewOwner] = useState({
    selectionBasis,
    sourceBinding,
  });
  if (
    previewOwner.selectionBasis !== selectionBasis ||
    (sourceBinding !== undefined &&
      previewOwner.sourceBinding !== sourceBinding)
  ) {
    setPreviewOwner({ selectionBasis, sourceBinding });
    setPreview(undefined);
    setOptIn(false);
    setBusy(false);
    setError("");
  }
  // Parent report refreshes withhold current choices, not the open Sheet or
  // original owned job. Only equivalent positive source proof restores consent.
  const reportProofReady =
    !sourceRead ||
    (sourceRead.ready &&
      selectedReport.ready &&
      !!selectedReport.data &&
      selectedReport.data.expiresAt !== expiredProof);
  const reportProofCurrent = () =>
    !sourceRead ||
    (reportProofReady &&
      Date.parse(selectedReport.data!.expiresAt) > Date.now());
  const sourcesCurrent =
    w.foreground && !!w.work && !sourceRead?.denied && reportProofReady;
  const previewCurrent =
    sourcesCurrent &&
    preview &&
    (!sourceRead ||
      (preview.selectionHash === selectedReport.data?.selectionHash &&
        preview.policyVersion === selectedReport.data?.policyVersion));
  const currentChoices =
    w.foreground && !sourceRead?.denied && (!sourceRead || sourceRead.ready)
      ? sourceRead && selected.length
        ? sourcesCurrent
          ? selected.map((source) => ({
              label: "Selected report facts",
              source,
            }))
          : []
        : transcript
          ? [...choices, transcript]
          : choices
      : [];
  function chooseLatestReport() {
    revision.current++;
    setPreview(undefined);
    setOptIn(false);
    setBusy(false);
    setError("");
    setSelected(choices.map((choice) => choice.source));
    selectedReport.retry();
  }
  useLayoutEffect(() => {
    latest.current = scope;
    live.current = workspaceReady;
    revision.current++;
    return () => {
      live.current = false;
    };
  }, [previewOwner, scope, workspaceReady]);
  async function inspect() {
    if (!sourcesCurrent || !reportProofCurrent() || !selected.length) return;
    const captured = scope;
    const serial = revision.current;
    const generation = client.generation;
    const retirement = businessAttemptGeneration();
    const current = () =>
      latest.current === captured &&
      revision.current === serial &&
      live.current &&
      client.generation === generation &&
      businessAttemptGeneration() === retirement;
    try {
      setBusy(true);
      setError("");
      const p = await intelligenceRequest<IntelligencePreview>(
        w.company,
        "/intelligence/selection-preview",
        canonicalSelection({ operation, sources: selected }),
      );
      if (current()) setPreview(p);
    } catch (e) {
      if (current()) setError((e as Error).message);
    } finally {
      if (current()) setBusy(false);
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
    if (!previewCurrent || !reportProofCurrent() || !preview || !optIn) return;
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
        choices={currentChoices}
        selected={selected}
        onChange={setSelected}
        disabled={!w.foreground || busy}
      />
      {sourceRead && selected.length > 0 && (
        <>
          <Text>
            {selectedReport.error ||
            (!!proofExpiry && proofExpiry === expiredProof)
              ? "Selected report facts are unavailable. Choose the latest facts and review again."
              : "Your selected report facts stay fixed until you choose the latest facts."}
          </Text>
          <Action
            title="Choose latest report facts"
            disabled={
              !w.foreground ||
              !sourceRead.ready ||
              sourceRead.denied ||
              !choices.length
            }
            onPress={chooseLatestReport}
          />
        </>
      )}
      <Action
        title="Review selected sources"
        disabled={
          !sourcesCurrent ||
          busy ||
          !selected.length ||
          !capabilities.data?.operations[operation]
        }
        onPress={() => void inspect()}
      />
      {previewCurrent && preview && (
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
