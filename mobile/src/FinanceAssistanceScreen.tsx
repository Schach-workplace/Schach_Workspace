import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { FlatList, Text, View } from "react-native";
import { router } from "expo-router";
import { client } from "./client";
import {
  captureOwner,
  authorizeCapture,
  chooseFinanceFile,
  type CaptureScope,
  type PreviewFile,
} from "./capture";
import { Page, useWorkspace, styles } from "./Workspace";
import { Action } from "./ConnectUI";
import { useRamInput } from "./ramInput";
import { useExecutionRead, useExecutionMutation } from "./execution";
import type {
  FinanceIntake,
  ReceiptJob,
} from "../../shared/finance/assistanceIntent";
import FinanceIntakeReview, { financePreviewHash } from "./FinanceIntakeReview";
import FinanceReceiptReview from "./FinanceReceiptReview";
import FinanceStatementReview from "./FinanceStatementReview";
import FinanceDuplicateReview from "./FinanceDuplicateReview";
import FinanceReconciliation from "./FinanceReconciliation";
export default function FinanceAssistanceScreen({
  initialJob = "",
  initialIntake = "",
  initialTool = "",
  initialCandidate = "",
  initialRow = "",
  initialImport = "",
}: {
  initialJob?: string;
  initialIntake?: string;
  initialTool?: string;
  initialCandidate?: string;
  initialRow?: string;
  initialImport?: string;
}) {
  const w = useWorkspace();
  const [intake, setIntake] = useRamInput(
    "$finance-assistance",
    "intake",
    initialIntake,
  );
  const [job, setJob] = useRamInput("$finance-assistance", "job", initialJob);
  const [department, setDepartment] = useRamInput(
    "$finance-assistance",
    "destination",
    "",
  );
  const [tool, setTool] = useState(initialTool);
  const [importId, setImport] = useRamInput(
    "$finance-assistance",
    "import",
    initialImport,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pendingFile = useRef<PreviewFile | undefined>(undefined);
  const m = useExecutionMutation("$finance-intake-reserve");
  const list = useExecutionRead<{ items: FinanceIntake[] }>("/finance/intakes");
  const jobs = useExecutionRead<{ items: ReceiptJob[] }>(
    "/finance/receipt-extractions",
  );
  const authority = ["founder", "ceo", "admin", "finance"].includes(
    w.work?.me.role ?? "",
  );
  const ready = w.foreground && !!w.work;
  const captured = [
    client.endpoint,
    client.generation,
    w.company,
    w.session?.user.id,
    w.policyEpoch,
  ].join(":");
  const current = useRef(captured);
  useLayoutEffect(() => {
    current.current = captured;
  }, [captured]);
  useEffect(() => {
    const clear = () => {
      pendingFile.current?.delete();
      pendingFile.current = undefined;
    };
    const stop = client.registerCancellation(clear);
    return () => {
      stop();
      clear();
    };
  }, []);
  useEffect(() => {
    if (!w.foreground) {
      pendingFile.current?.delete();
      pendingFile.current = undefined;
    }
  }, [w.foreground]);
  async function reserve(capture: boolean, purpose: "receipt" | "statement") {
    if (!ready || busy) return;
    const origin = captured;
    setBusy(true);
    try {
      let selectedFile = pendingFile.current;
      let canonicalId = "";
      let payload = m.attempt?.payload;
      if (!payload) {
        if (capture) {
          payload = {
            capture: true,
            purpose: "receipt",
            destinationDepartmentId: department,
          };
        } else {
          const selected = await chooseFinanceFile(
            client.endpoint,
            w.company,
            w.session!.user.id,
            purpose,
          );
          if (!selected) return;
          selectedFile = selected;
          pendingFile.current = selected;

          const sha256 = await financePreviewHash(selected.uri);
          if (current.current !== origin)
            throw Error("Company access changed.");
          payload = {
            purpose,
            fileName: selected.name,
            size: selected.size,
            sha256,
            ...(purpose === "receipt"
              ? { destinationDepartmentId: department }
              : {}),
          };
        }
      }
      await m.execute<FinanceIntake>(
        "/finance/intakes",
        payload,
        "POST",
        (r) => {
          canonicalId = r.id;
          setIntake(r.id);
        },
      );
      if (selectedFile) {
        const scope: CaptureScope = {
          serverOrigin: client.endpoint,
          companyId: w.company,
          userId: w.session!.user.id,
          targetKind: "finance_intake",
          targetId: canonicalId,
        };
        await authorizeCapture(scope);
        captureOwner(scope).select(selectedFile);
        pendingFile.current = undefined;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page scroll={false} safeBottom>
      <Text style={styles.heading}>Finance assistance</Text>
      {!ready ? (
        <Text>Checking current finance access…</Text>
      ) : w.work?.me.role === "viewer" ? (
        <Text>Your role cannot access finance.</Text>
      ) : (
        <>
          <FlatList
            data={list.data?.items ?? []}
            keyExtractor={(i) => i.id}
            ListHeaderComponent={
              <View>
                <Text>
                  Manual finance remains available. Extraction candidates
                  require human review; statement associations never pay
                  expenses.
                </Text>
                <Text>Receipt destination department</Text>
                {w.work?.departments
                  .filter((d) => authority || d.id === w.work?.me.departmentId)
                  .map((d) => (
                    <Action
                      key={d.id}
                      title={d.name}
                      selected={department === d.id}
                      disabled={busy || !!m.attempt}
                      onPress={() => setDepartment(d.id)}
                    />
                  ))}
                {m.attempt && (
                  <Action
                    title="Retry same private reservation"
                    disabled={busy}
                    onPress={() =>
                      void reserve(
                        m.attempt!.payload.capture === true,
                        m.attempt!.payload.purpose as "receipt" | "statement",
                      )
                    }
                  />
                )}
                <Action
                  title="Reserve receipt camera capture"
                  disabled={
                    busy ||
                    !department ||
                    (!!m.attempt && m.attempt.payload.capture !== true)
                  }
                  onPress={() => void reserve(true, "receipt")}
                />
                <Action
                  title="Choose receipt file"
                  disabled={busy || !department || !!m.attempt}
                  onPress={() => void reserve(false, "receipt")}
                />
                {authority && (
                  <Action
                    title="Choose bank CSV"
                    disabled={busy || !!m.attempt}
                    onPress={() => void reserve(false, "statement")}
                  />
                )}
                <Action
                  title="Duplicate review"
                  onPress={() => setTool("duplicates")}
                />
                {authority && (
                  <Action
                    title="Statement reconciliation"
                    onPress={() => setTool("reconciliation")}
                  />
                )}
                <Text accessibilityRole="alert">
                  {error || m.error || list.error}
                </Text>
                <Text>Your current private sources</Text>
              </View>
            }
            renderItem={({ item: i }) => (
              <View style={styles.message}>
                <Text>
                  {i.fileName || "Camera reservation"} · {i.state}
                </Text>
                <Action
                  title="Open current intake"
                  onPress={() => setIntake(i.id)}
                />
              </View>
            )}
            ListFooterComponent={
              <View>
                <Text>Your extraction requests</Text>
                {jobs.data?.items.map((j) => (
                  <Action
                    key={j.id}
                    title={"Open " + j.status + " extraction"}
                    onPress={() => setJob(j.id)}
                  />
                ))}
                <Text accessibilityRole="alert">{jobs.error}</Text>
              </View>
            }
          />
          {intake && !tool && !job && (
            <FinanceIntakeReview
              id={intake}
              onClose={() => setIntake("")}
              onExtracted={setJob}
              onStatement={() => setTool("statement")}
            />
          )}
          {job && (
            <FinanceReceiptReview
              jobId={job}
              onClose={() => setJob("")}
              onCreated={(id) => {
                setJob("");
                router.push({
                  pathname: "/expense/[id]",
                  params: { id, company: w.company },
                });
              }}
            />
          )}
          {tool === "statement" && intake && authority && (
            <FinanceStatementReview
              intakeId={intake}
              onClose={() => setTool("")}
              onImported={(id) => {
                setImport(id);
                setTool("reconciliation");
              }}
            />
          )}
          {tool === "duplicates" && (
            <FinanceDuplicateReview
              initialCandidate={initialCandidate}
              onClose={() => setTool("")}
            />
          )}
          {tool === "reconciliation" && authority && (
            <FinanceReconciliation
              initialRow={initialRow}
              initialImport={importId}
              onClose={() => setTool("")}
            />
          )}
        </>
      )}
    </Page>
  );
}
