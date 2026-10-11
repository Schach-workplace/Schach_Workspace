import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, Image } from "react-native";
import { File } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { client } from "./client";
import {
  captureImage,
  captureOwner,
  authorizeCapture,
  chooseCapture,
  type CaptureScope,
} from "./capture";
import { useWorkspace } from "./Workspace";
import { Sheet, Action } from "./ConnectUI";
import { useRamInput } from "./ramInput";
import { useExecutionRead, useExecutionMutation } from "./execution";
import {
  financeAssessmentMessage,
  type FinanceIntake,
  type ReceiptJob,
} from "../../shared/finance/assistanceIntent";
export async function financePreviewHash(uri: string) {
  const bytes = await new File(uri).bytes();
  const hash = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    new Uint8Array(bytes),
  );
  return Array.from(new Uint8Array(hash), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
export default function FinanceIntakeReview({
  id,
  onClose,
  onExtracted,
  onStatement,
}: {
  id: string;
  onClose: () => void;
  onExtracted: (id: string) => void;
  onStatement: () => void;
}) {
  const w = useWorkspace();
  const path = "/finance/intakes/" + id;
  const scope = useMemo<CaptureScope>(
    () => ({
      serverOrigin: client.endpoint,
      companyId: w.company,
      userId: w.session?.user.id ?? "",
      targetKind: "finance_intake",
      targetId: id,
    }),
    [w.company, w.session?.user.id, id],
  );
  const owner = captureOwner(scope);
  const state = useSyncExternalStore(owner.subscribe, () => owner.state);
  const q = useExecutionRead<FinanceIntake>(path);
  const bind = useExecutionMutation("$intake-bind:" + id, [path]);
  const finalize = useExecutionMutation("$intake-finalize:" + id, [path]);
  const cancel = useExecutionMutation("$intake-cancel:" + id, [path]);
  const assessmentRetry = useExecutionMutation(
    "$intake-assessment-retry:" + id,
    [path],
  );
  const extract = useExecutionMutation("$intake-extract:" + id, [path]);
  const [optIn, setOptIn] = useRamInput("$intake:" + id, "optIn", false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.denied) owner.clear();
  }, [q.denied, owner]);
  async function take() {
    try {
      setBusy(true);
      const file = await captureImage(scope);
      if (!file && q.data) {
        await cancel.execute(path + "/cancel", {
          expectedVersion: q.data.version,
        });
        onClose();
      }
    } catch (e) {
      setError((e as Error).message);
      try {
        if (q.ready && q.data) {
          await cancel.execute(path + "/cancel", {
            expectedVersion: q.data.version,
          });
          onClose();
        }
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  async function stage() {
    if (!state.file || !q.data || busy) return;
    setBusy(true);
    try {
      const file = state.file;
      const current = await authorizeCapture(scope);
      if (bind.attempt || current.state === "capture_reserved") {
        const sha256 = await financePreviewHash(file.uri);
        await authorizeCapture(scope);
        await bind.execute(
          path + "/bind-content",
          bind.attempt?.payload ?? {
            expectedVersion: q.data.version,
            fileName: file.name,
            size: file.size,
            sha256,
          },
        );
      }
      await authorizeCapture(scope);
      await client.stageFinanceFile(scope.companyId, id, new File(file.uri));
      await authorizeCapture(scope);
      owner.clear();
      void q.retry();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title="Private finance intake"
      onClose={onClose}
      busy={
        busy ||
        bind.busy ||
        cancel.busy ||
        finalize.busy ||
        assessmentRetry.busy ||
        extract.busy
      }
    >
      {q.data && (
        <>
          <Text>
            {q.data.fileName || "Unbound receipt capture reservation"} ·{" "}
            {q.data.state}. Expires {q.data.expiresAt}.
          </Text>
          {q.data.state === "capture_reserved" && !state.file && (
            <Action
              title="Capture receipt for this real reservation"
              disabled={busy}
              onPress={() => void take()}
            />
          )}
          {q.data.state === "reserved" && !state.file && (
            <Action
              title="Reselect the exact reserved file"
              disabled={busy}
              onPress={() =>
                void chooseCapture(scope).catch((e) => setError(e.message))
              }
            />
          )}
          {state.file && (
            <>
              <Text>
                {state.file.name} · {state.file.size} bytes
              </Text>
              {state.file.mime.startsWith("image/") && (
                <Image
                  source={{ uri: state.file.uri }}
                  style={{ width: "100%", height: 220 }}
                  accessibilityLabel="Owned receipt preview"
                />
              )}
              <Action
                title={
                  bind.attempt
                    ? "Retry same content binding and staging"
                    : "Bind actual content and stage this exact file"
                }
                disabled={busy}
                onPress={() => void stage()}
              />
            </>
          )}
          {(q.data.state === "uploaded" || !!finalize.attempt) && (
            <Action
              title={
                finalize.attempt
                  ? "Retry same clean request"
                  : "Request clean assessment"
              }
              disabled={finalize.busy}
              onPress={() =>
                void finalize
                  .execute(
                    path + "/finalize",
                    finalize.attempt?.payload ?? {
                      expectedVersion: q.data!.version,
                    },
                  )
                  .then(() => q.retry())
                  .catch(() => {})
              }
            />
          )}
          {q.data.state === "scanning" && !financeAssessmentMessage(q.data) && (
            <Action
              title="Check clean assessment"
              onPress={() => void q.retry()}
            />
          )}
          {financeAssessmentMessage(q.data) && (
            <Text accessibilityRole="alert">
              {financeAssessmentMessage(q.data)}
            </Text>
          )}
          {(q.data.assessment?.retryable || assessmentRetry.attempt) && (
            <Action
              title={
                assessmentRetry.attempt
                  ? "Retry same clean assessment request"
                  : "Retry unavailable clean assessment"
              }
              disabled={!q.ready || assessmentRetry.busy || !!finalize.attempt}
              onPress={() =>
                void assessmentRetry
                  .execute(
                    path + "/finalize",
                    assessmentRetry.attempt?.payload ?? {
                      expectedVersion: q.data!.version,
                      retryAssessment: true,
                    },
                  )
                  .then(() => q.retry())
                  .catch(() => {})
              }
            />
          )}
          {q.data.state === "clean" && q.data.purpose === "receipt" && (
            <>
              <Action
                title="Use local extraction; I will review all candidates"
                selected={optIn}
                disabled={!!extract.attempt || extract.busy}
                onPress={() => setOptIn(!optIn)}
              />
              <Action
                title={
                  extract.attempt
                    ? "Retry same extraction request"
                    : "Extract this clean receipt"
                }
                disabled={!optIn || extract.busy}
                onPress={() =>
                  void extract
                    .execute<ReceiptJob>(
                      "/finance/receipt-extractions",
                      extract.attempt?.payload ?? {
                        source: {
                          kind: "intake",
                          id,
                          expectedVersion: q.data!.version,
                        },
                        destinationDepartmentId:
                          q.data!.destinationDepartmentId,
                        optIn: true,
                      },
                      "POST",
                      (r) => onExtracted(r.id),
                    )
                    .catch(() => {})
                }
              />
            </>
          )}
          {q.data.state === "clean" && q.data.purpose === "statement" && (
            <Action
              title="Map and review this bank CSV"
              onPress={onStatement}
            />
          )}
          <Action
            title="Cancel private intake"
            disabled={cancel.busy || busy}
            onPress={() =>
              void cancel
                .execute(
                  path + "/cancel",
                  cancel.attempt?.payload ?? {
                    expectedVersion: q.data!.version,
                  },
                )
                .then(() => {
                  owner.clear();
                  onClose();
                })
                .catch(() => {})
            }
          />
        </>
      )}
      <Text accessibilityRole="alert">
        {error ||
          bind.error ||
          finalize.error ||
          assessmentRetry.error ||
          cancel.error ||
          extract.error ||
          q.error}
      </Text>
    </Sheet>
  );
}
