import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, FlatList, Text, View } from "react-native";
import { router } from "expo-router";
import { useWorkspace } from "./Workspace";
import { Action, ui } from "./ConnectUI";
import { ReportField, ReportChoice } from "./ReportControls";
import { useRamInput } from "./ramInput";
import { useExecutionRead, useExecutionMutation } from "./execution";
import { client } from "./client";
import { ReportTransfer } from "./reportClient";
import {
  metricLabels,
  metricValue,
  validHistoricalRequest,
  type HistoricalRequest,
  type HistoricalSnapshot,
  type HistoricalRows,
  type ExportJob,
  type ReportArtifact,
  type ReportComparison,
} from "../../shared/reports/types";
import { companyDate } from "./workDates";
export default function HistoricalReports({
  initialId = "",
  initialJob = "",
}: {
  initialId?: string;
  initialJob?: string;
}) {
  const w = useWorkspace();
  const projects = useExecutionRead<{
    projects: { id: string; name: string }[];
  }>("/projects");
  const zone = w.work?.company.timezone ?? "Asia/Kolkata";
  const now = companyDate(new Date(), zone);
  const start = new Date(now.slice(0, 7) + "-01T12:00:00Z");
  start.setUTCDate(0);
  const end = start.toISOString().slice(0, 10);
  const [request, setRequest] = useRamInput<HistoricalRequest>(
    "$report-capture",
    "request",
    {
      from: end.slice(0, 7) + "-01",
      to: end,
      reportZone: zone,
      basis: "task_history_v1",
      filters: { ownerId: "", departmentId: "", projectId: "" },
    },
  );
  const [id, setId] = useState(initialId),
    [jobId, setJob] = useState(initialJob),
    [metric, setMetric] = useState("state.cohort"),
    [membership, setMembership] = useState("contributing"),
    [cursor, setCursor] = useState(""),
    [previous, setPrevious] = useState(""),
    [comparing, setComparing] = useState(false),
    [error, setError] = useState(""),
    [sharing, setSharing] = useState(false);
  const capture = useExecutionMutation("$report-capture"),
    cancel = useExecutionMutation("$report-cancel");
  const job = useExecutionRead<{
    job: ExportJob;
    artifact: ReportArtifact | null;
  }>(`/reports/exports/${encodeURIComponent(jobId || "none")}`, !!jobId);
  const snapshotId = jobId
    ? job.ready
      ? (job.data?.job.snapshotId ?? "")
      : ""
    : id;
  const exportAction = useExecutionMutation(
    "$report-export",
    snapshotId ? [`/reports/history/snapshots/${snapshotId}`] : [],
  );
  const snap = useExecutionRead<{ snapshot: HistoricalSnapshot }>(
    `/reports/history/snapshots/${encodeURIComponent(snapshotId || "none")}`,
    !!snapshotId,
  );
  const query = new URLSearchParams({ metric, membership, limit: "100" });
  if (cursor) query.set("cursor", cursor);
  const rows = useExecutionRead<HistoricalRows>(
    `/reports/history/snapshots/${encodeURIComponent(snapshotId || "none")}/rows?${query}`,
    !!snapshotId && snap.ready,
  );
  const ready = snap.ready && rows.ready && !snap.denied && !rows.denied;
  const comparison = useExecutionRead<ReportComparison>(
    "/reports/history/compare",
    comparing && !!previous && ready,
    { leftSnapshotId: previous, rightSnapshotId: snapshotId },
  );
  const transfer = useRef(new ReportTransfer());
  const current = useRef(false);
  useLayoutEffect(() => {
    current.current = !!ready && job.ready && !!w.foreground;
  }, [ready, job.ready, w.foreground]);
  const scope = [
    w.company,
    w.session?.user.id,
    w.work?.readBasis,
    w.foreground,
    client.generation,
  ].join(":");
  useEffect(() => {
    const owned = transfer.current;
    return () => {
      void owned.cancel();
    };
  }, [scope]);
  useEffect(() => {
    if (!ready || !job.ready) void transfer.current.cancel();
  }, [ready, job.ready]);

  const disabled = !w.foreground || !w.work || capture.busy;
  async function generate() {
    try {
      await capture.execute<{ snapshotId: string }>(
        "/reports/history/snapshots",
        capture.attempt?.payload ?? { request },
        "POST",
        (r) => {
          setPrevious(snapshotId);
          setId(r.snapshotId);
          setCursor("");
          setJob("");
          setComparing(false);
        },
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function queue() {
    try {
      await exportAction.execute<{ job: ExportJob }>(
        "/reports/exports",
        exportAction.attempt?.payload ?? { snapshotId, csvSchemaVersion: 1 },
        "POST",
        (r) => setJob(r.job.id),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const header = (
    <View>
      <Text style={ui.title}>Historical reports</Text>
      <Text>
        Immutable state at period end, genuine acceptance episodes and dated
        effort. Labels reflect generation time. Choose a completed period.
      </Text>
      <ReportField
        label="Historical start date YYYY-MM-DD"
        calendar="date"
        timezone={request.reportZone}
        value={request.from}
        disabled={disabled}
        onChange={(from) => setRequest({ ...request, from })}
      />
      <ReportField
        label="Historical end date YYYY-MM-DD"
        calendar="date"
        timezone={request.reportZone}
        value={request.to}
        disabled={disabled}
        onChange={(to) => setRequest({ ...request, to })}
      />
      <ReportField
        label="Report timezone"
        value={request.reportZone}
        disabled={disabled}
        onChange={(reportZone) => setRequest({ ...request, reportZone })}
      />
      {(["ownerId", "departmentId", "projectId"] as const).map(
        (field, index) => (
          <ReportChoice
            key={field}
            label={
              [
                "Historical owner",
                "Historical department",
                "Historical project",
              ][index]
            }
            value={request.filters[field]}
            authorized={
              !!w.work && w.foreground && (index !== 2 || projects.ready)
            }
            disabled={disabled}
            options={[
              { id: "", name: "All authorized sources" },
              ...((index === 0
                ? w.work?.people.filter((p) => p.active)
                : index === 1
                  ? w.work?.departments
                  : projects.data?.projects) ?? []),
            ]}
            onChange={(value) =>
              setRequest({
                ...request,
                filters: { ...request.filters, [field]: value },
              })
            }
          />
        ),
      )}
      <Action
        title={
          capture.attempt
            ? "Retry same report generation"
            : "Generate historical report"
        }
        primary
        disabled={disabled || !validHistoricalRequest(request)}
        onPress={() => void generate()}
      />
      {capture.attempt && (
        <Action
          title="Abandon report retry"
          disabled={capture.busy}
          onPress={() =>
            Alert.alert(
              "Abandon unresolved request?",
              "It may already have created a snapshot. A new generation uses a new identity.",
              [
                { text: "Keep retry", style: "cancel" },
                { text: "Abandon", onPress: capture.abandon },
              ],
            )
          }
        />
      )}
      {(error || capture.error || snap.error || rows.error || job.error) && (
        <Text accessibilityRole="alert">
          {error || capture.error || snap.error || rows.error || job.error}
        </Text>
      )}
      {(snap.loading || rows.loading) && (
        <Text>Checking all current report sources…</Text>
      )}
      {(snap.denied || rows.denied) && (
        <Text>
          Report access changed. Generate a new report using current sources.
        </Text>
      )}
      {ready && snap.data && (
        <>
          <Text>
            Immutable snapshot · {snap.data.snapshot.request.reportZone} ·{" "}
            {snap.data.snapshot.rowCount} facts
          </Text>
          {snap.data.snapshot.summary.coverage.length > 0 && (
            <Text>
              Earlier history is unknown for some sources. Unavailable values
              are not perfect performance.
            </Text>
          )}
          {Object.values(snap.data.snapshot.summary.metrics).map((m) => (
            <Action
              key={m.code}
              title={`${metricLabels[m.code] ?? m.code}: ${metricValue(m)}${m.coverage.length ? " · incomplete coverage" : ""}`}
              selected={metric === m.code}
              onPress={() => {
                setMetric(m.code);
                setMembership("contributing");
                setCursor("");
              }}
            />
          ))}
          <ReportChoice
            label="Metric membership"
            value={membership}
            options={[
              { id: "contributing", name: "Contributing facts" },
              { id: "numerator", name: "Numerator facts" },
              { id: "denominator", name: "Denominator facts" },
            ]}
            onChange={(value) => {
              setMembership(value);
              setCursor("");
            }}
          />
          <Text style={ui.title}>{metricLabels[metric]}</Text>
          <Action
            title={
              exportAction.attempt
                ? "Retry same export request"
                : "Queue private CSV export"
            }
            disabled={exportAction.busy}
            onPress={() => void queue()}
          />
          {previous && (
            <Action
              title="Compare with previous snapshot"
              onPress={() => setComparing(true)}
            />
          )}
        </>
      )}
      {ready &&
        comparison.ready &&
        comparison.data &&
        Object.entries(comparison.data.comparisons).map(([code, c]) => (
          <Text key={code}>
            {metricLabels[code]}: {metricValue(c.left)} → {metricValue(c.right)}{" "}
            ·{" "}
            {c.percentagePoints === null
              ? "Rate difference unavailable"
              : c.percentagePoints.toFixed(1) + " percentage points"}
          </Text>
        ))}
      {comparison.loading && <Text>Checking both comparison source sets…</Text>}
      {comparison.error && <Text>{comparison.error}</Text>}
      {jobId && (
        <>
          <Text style={ui.title}>Private export</Text>
          {job.loading && <Text>Checking export access…</Text>}
          {job.ready && job.data && (
            <>
              <Text>
                {job.data.job.state} · {job.data.job.failureCode}
              </Text>
              <Action title="Recheck export" onPress={job.retry} />
              {["queued", "running", "ready"].includes(job.data.job.state) && (
                <Action
                  title="Cancel export and delivery"
                  disabled={cancel.busy}
                  onPress={() => {
                    void cancel
                      .execute(
                        `/reports/exports/${encodeURIComponent(jobId)}/cancel`,
                        {},
                        "POST",
                        () => {
                          void transfer.current.cancel();
                          job.retry();
                        },
                      )
                      .catch((e) => setError(e.message));
                  }}
                />
              )}
              {ready && job.data.artifact && (
                <>
                  <Text>
                    Expires{" "}
                    {new Date(job.data.artifact.expiresAt).toLocaleString()}.
                    Exported copies cannot be recalled.
                  </Text>
                  <Action
                    title="Download and share authorized CSV"
                    disabled={sharing}
                    onPress={() =>
                      Alert.alert(
                        "Share a report copy?",
                        "The shared copy cannot be recalled when access changes. Temporary app files are deleted after sharing.",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Download and share",
                            onPress: () => {
                              setSharing(true);
                              void transfer.current
                                .share(w.company, jobId, () => current.current)
                                .catch((e) => setError(e.message))
                                .finally(() => setSharing(false));
                            },
                          },
                        ],
                      )
                    }
                  />
                  {sharing && (
                    <Action
                      title="Cancel private download"
                      onPress={() => {
                        void transfer.current.cancel();
                      }}
                    />
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </View>
  );
  return (
    <FlatList
      style={{ flex: 1 }}
      keyboardShouldPersistTaps="handled"
      data={ready ? (rows.data?.rows ?? []) : []}
      keyExtractor={(r) => r.rowId}
      ListHeaderComponent={header}
      ListEmptyComponent={
        ready ? (
          <Text>No facts contribute to this metric membership.</Text>
        ) : null
      }
      renderItem={({ item: r }) => (
        <View>
          <Action
            title={`${r.state.code} · ${r.state.title || "Historical coverage"}`}
            onPress={() =>
              router.push({
                pathname: "/task/[id]",
                params: { id: r.taskId, company: w.company },
              })
            }
          />
          <Text>
            {r.kind} · version {r.taskVersion} ·{" "}
            {r.acceptanceKind?.replaceAll("_", " ")}{" "}
            {r.reason?.replaceAll("_", " ")} {r.entryDate}{" "}
            {r.hours ? `${r.hours} hours` : ""}{" "}
            {r.episodeIds?.length
              ? `Matching acceptance episodes: ${r.episodeIds.join(", ")}`
              : ""}
          </Text>
        </View>
      )}
      ListFooterComponent={
        ready && rows.data?.cursor ? (
          <Action
            title="Load next 100 facts"
            onPress={() => setCursor(rows.data!.cursor)}
          />
        ) : null
      }
    />
  );
}
