import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { Directory, File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { client, NativeApiError } from "./client";
import { useWorkspace } from "./Workspace";
import { Action, Sheet, ui } from "./ConnectUI";
import { useExecutionRead, type ExecutionProject } from "./execution";
import {
  useBusinessAttempt,
  beginAttempt,
  businessKey,
  markAttemptCommitted,
  retireAttempt,
  clearAttemptScope,
} from "./businessAttempts";
import { companyDate } from "./workDates";
import {
  createTaskCSVTemplate,
  exportTasksCSV,
  importRowErrors,
  maxTaskCsvBytes,
  parseTaskCSV,
  type TaskCsvDirectory,
  type TaskCsvTask,
  type TaskImportRow,
} from "./taskCsvModel";

// Writes the CSV to a private per-share cache folder, hands that exact file to
// the OS share sheet and always removes the folder afterwards.
export async function shareCsv(
  fileName: string,
  text: string,
  current: () => boolean,
) {
  if (!(await Sharing.isAvailableAsync()))
    throw Error("Sharing is unavailable on this device.");
  if (!current()) throw Error("Company access changed. Refresh before sharing.");
  const folder = new Directory(Paths.cache, "task-csv-" + randomUUID());
  try {
    folder.create();
    const file = new File(folder, fileName);
    file.create();
    file.write(text);
    await Sharing.shareAsync(file.uri, {
      mimeType: "text/csv",
      UTI: "public.comma-separated-values-text",
      dialogTitle: "Share tasks CSV",
    });
  } finally {
    try {
      if (folder.exists) folder.delete();
    } catch {
      // Cache is OS-reclaimable; a failed cleanup must not mask the result.
    }
  }
}

// Mirrors the browser Tasks page CSV controls: export of the shown tasks for
// every role; template + preview + explicit confirm import for non-viewers,
// using the same frozen `task-import` attempt and `/tasks/import` body.
export default function TaskCsv({
  tasks,
  onClose,
}: {
  tasks: TaskCsvTask[];
  onClose: () => void;
}) {
  const w = useWorkspace();
  const business = useBusinessAttempt<{ rows: TaskImportRow[] }>("task-import");
  const editable = !!w.work && w.work.me.role !== "viewer";
  const projects = useExecutionRead<{ projects: ExecutionProject[] }>(
    "/projects",
    !!w.work,
  );
  const [rows, setRows] = useState<TaskImportRow[]>(
    () => business.attempt?.payload.rows ?? [],
  );
  const [error, setError] = useState("");
  const [rowErrors, setRowErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const zone = w.work?.company.timezone || "UTC";
  const directory: TaskCsvDirectory | undefined =
    w.work && projects.ready && projects.data
      ? {
          me: w.work.me,
          company: { timezone: zone },
          people: w.work.people,
          departments: w.work.departments,
          projects: projects.data.projects,
        }
      : undefined;
  const shown = business.attempt?.payload.rows ?? rows;
  // Each async step is bound to the account/company generation it started in.
  async function guarded(step: (current: () => boolean) => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setRowErrors([]);
    setNotice("");
    const generation = client.generation;
    const current = () => alive.current && generation === client.generation;
    try {
      await step(current);
    } catch (e) {
      if (
        e instanceof NativeApiError &&
        [401, 403, 404].includes(e.status)
      )
        clearAttemptScope(business.scope);
      if (alive.current) {
        setError(e instanceof Error ? e.message : "CSV action failed.");
        setRowErrors(importRowErrors(e));
      }
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const exportShown = () =>
    guarded(async (current) => {
      if (!directory) return;
      const text = exportTasksCSV(tasks, directory);
      await shareCsv(
        `schach-tasks-${companyDate(new Date(), zone)}.csv`,
        text,
        current,
      );
      if (current()) setNotice(`Exported ${tasks.length} tasks.`);
    });
  const shareTemplate = () =>
    guarded(async (current) => {
      if (!directory || !editable) return;
      await shareCsv(
        "schach-task-template.csv",
        createTaskCSVTemplate(directory),
        current,
      );
    });
  const choose = () =>
    guarded(async (current) => {
      if (!directory || !editable || business.attempt) return;
      setRows([]);
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "text/comma-separated-values",
          "application/csv",
          "text/plain",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !current()) return;
      const asset = picked.assets[0];
      const file = new File(asset.uri);
      try {
        if ((asset.size ?? 0) > maxTaskCsvBytes)
          throw new Error("Choose a CSV smaller than 2 MB.");
        const text = await file.text();
        if (!current()) return;
        setRows(parseTaskCSV(text, directory));
      } finally {
        // Remove the picker's private cache copy once it has been read.
        try {
          if (asset.uri.startsWith(Paths.cache.uri) && file.exists)
            file.delete();
        } catch {
          // OS-reclaimable cache; ignore.
        }
      }
    });
  const confirmImport = () =>
    guarded(async (current) => {
      if (!editable || (!rows.length && !business.attempt)) return;
      const attempt = beginAttempt(
        business.scope,
        business.attempt?.payload ?? { rows },
        businessKey(),
        { path: "/tasks/import", method: "POST" },
      );
      let created = attempt.result?.ids.length ?? attempt.payload.rows.length;
      if (attempt.state !== "committed") {
        const result = await client.request<{
          ok: boolean;
          created: number;
          ids: string[];
        }>(`/companies/${w.company}/tasks/import`, "POST", {
          ...attempt.payload,
          retryKey: attempt.retryKey,
        });
        if (!current()) return;
        markAttemptCommitted(business.scope, attempt.retryKey, {
          ids: result.ids ?? [],
        });
        created = result.created ?? result.ids?.length ?? created;
      }
      retireAttempt(business.scope, attempt.retryKey);
      setRows([]);
      setNotice(`Imported ${created} tasks.`);
      await w.refresh("tasks");
    });
  return (
    <Sheet
      title="Tasks CSV"
      onClose={() => {
        if (!pending.current) onClose();
      }}
    >
      {projects.error ? (
        <View>
          <Text accessibilityRole="alert">{projects.error}</Text>
          {!projects.denied && (
            <Action title="Retry projects" onPress={projects.retry} />
          )}
        </View>
      ) : (
        !directory && (
          <Text style={ui.subtitle}>Checking authorized projects…</Text>
        )
      )}
      <Text style={ui.name}>Export</Text>
      <Text style={ui.subtitle}>
        Exports the tasks currently shown on Work, as in the browser.
      </Text>
      <Action
        title={`Export ${tasks.length} shown tasks`}
        disabled={busy || !directory}
        onPress={() => void exportShown()}
      />
      {!editable ? (
        <Text style={ui.subtitle}>
          Viewers can export visible tasks. Importing requires a role that can
          create tasks.
        </Text>
      ) : (
        <>
          <Text style={ui.name}>Import</Text>
          <Text style={ui.subtitle}>
            Use exact department and project names, and existing owner emails.
            The whole import is validated together; failed rows are never
            partially added. Up to 200 tasks.
          </Text>
          <Action
            title="Share CSV template"
            disabled={busy || !directory}
            onPress={() => void shareTemplate()}
          />
          <Action
            title="Choose CSV"
            disabled={busy || !directory || !!business.attempt}
            onPress={() => void choose()}
          />
          {shown.length > 0 && (
            <View>
              <Text style={ui.name}>
                {`${shown.length} tasks ready to import`}
              </Text>
              {shown.slice(0, 5).map((r, i) => (
                <Text key={i} style={ui.subtitle}>
                  {r.title}
                </Text>
              ))}
              {shown.length > 5 && (
                <Text style={ui.subtitle}>
                  {`And ${shown.length - 5} more`}
                </Text>
              )}
            </View>
          )}
          {!!business.attempt && (
            <Text accessibilityRole="alert">
              The previous import may already exist. Retry its original frozen
              rows; choosing another CSV will not replace this attempt.
            </Text>
          )}
          {!!business.attempt && (
            <Action
              title="Abandon retry; prior work may exist"
              disabled={busy}
              onPress={() => {
                if (pending.current) return;
                clearAttemptScope(business.scope);
                setError("");
                setRowErrors([]);
                setRows([]);
              }}
            />
          )}
          <Action
            primary
            title={
              busy
                ? "Importing…"
                : business.attempt
                  ? "Retry same import"
                  : shown.length
                    ? `Import ${shown.length} tasks`
                    : "Import tasks"
            }
            disabled={busy || (!rows.length && !business.attempt)}
            onPress={() => void confirmImport()}
          />
        </>
      )}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
      {rowErrors.map((message) => (
        <Text key={message} accessibilityRole="alert">
          {message}
        </Text>
      ))}
      {!!notice && <Text accessibilityLiveRegion="polite">{notice}</Text>}
    </Sheet>
  );
}
