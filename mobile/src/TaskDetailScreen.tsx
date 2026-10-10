import { readNativeDetail } from "./readScopes";
import CaptureControl from "./CaptureControl";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Page, useWorkspace, type WorkTask } from "./Workspace";
import { Action, ui } from "./ConnectUI";
import NativeMedia from "./Media";
import { client } from "./client";
import { useRamInput } from "./ramInput";
export default function TaskDetailScreen({ id }: { id: string }) {
  const w = useWorkspace();
  const [task, setTask] = useState<WorkTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useRamInput("$task:" + id, "reason", "");
  const pending = useRef(false);
  const alive = useRef(true);
  const requestRevision = useRef(0);
  const editable = !!w.work && w.work.me.role !== "viewer";
  const zone = w.work?.company.timezone ?? "Asia/Kolkata";
  async function load() {
    if (!w.foreground || !w.work) return;
    const revision = ++requestRevision.current;
    setLoading(true);
    try {
      const v = await readNativeDetail<{ task: WorkTask }>(
        (path) => client.request(path),
        `/companies/${w.company}/tasks/${id}`,
        "task",
      );
      if (alive.current && revision === requestRevision.current) {
        setTask(v.task);
        setError("");
      }
    } catch (e) {
      if (alive.current && revision === requestRevision.current) {
        setTask(null);
        setError((e as Error).message);
      }
    } finally {
      if (alive.current && revision === requestRevision.current)
        setLoading(false);
    }
  }
  const reload = useEffectEvent(load);
  useEffect(() => {
    alive.current = true;
    const invalidate = () => {
      requestRevision.current++;
    };
    void Promise.resolve().then(() => reload());
    const timer = setInterval(() => void reload(), 15000);
    return () => {
      alive.current = false;
      invalidate();
      clearInterval(timer);
    };
  }, [id, w.company, w.foreground, w.work?.readBasis, w.recordEpoch]);
  function dateLabel(t: WorkTask) {
    return t.deadlineMode === "timed" && t.dueAt
      ? new Intl.DateTimeFormat("en-IN", {
          timeZone: t.dueTimezone || zone,
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(t.dueAt)) +
          " · " +
          (t.dueTimezone || zone)
      : t.dueDate || "No deadline";
  }
  function actOnTask(current: WorkTask, status: string, review = false) {
    if (pending.current || !editable) return;
    pending.current = true;
    setBusy(true);
    setError("");
    void (async () => {
      const fresh = await readNativeDetail<{ task: WorkTask }>(
        (path) => client.request(path),
        `/companies/${w.company}/tasks/${id}`,
        "task",
      );
      if (fresh.task.version !== current.version) {
        setTask(fresh.task);
        await w.refresh("tasks");
        throw Error(
          "Task changed or access changed. Review current details before trying again.",
        );
      }
      if (review)
        await client.request(
          `/companies/${w.company}/tasks/${id}/review`,
          "POST",
          { version: current.version, decision: "approve", comment: reason },
        );
      else
        await client.request(`/companies/${w.company}/tasks/${id}`, "PATCH", {
          version: current.version,
          status,
        });
      await w.refresh("tasks");
      await load();
    })()
      .catch((e) => {
        if (alive.current) setError(e.message);
      })
      .finally(() => {
        pending.current = false;
        if (alive.current) setBusy(false);
      });
  }
  return (
    <Page safeBottom>
      <Action title="‹ Back" disabled={busy} onPress={() => router.back()} />
      {error && <Text accessibilityRole="alert">{error}</Text>}
      {loading || !task ? (
        <Text>
          {loading ? "Checking current task access…" : "Task unavailable."}
        </Text>
      ) : (
        <View>
          <Text style={ui.title}>{task.title}</Text>
          <Text>
            {task.status.replaceAll("_", " ")} · {dateLabel(task)}
          </Text>
          <Text>{task.description}</Text>
          <Text style={ui.subtitle}>
            Original commitment:{" "}
            {task.originalDueAt ||
              task.originalDueDate ||
              "No original deadline"}
          </Text>
          {task.attachments.map((a) => (
            <Action
              key={a.id}
              title={"Inspect evidence: " + a.fileName}
              onPress={() =>
                void NativeMedia.downloadPath(
                  `/companies/${w.company}/attachments/${a.id}`,
                  a.id,
                ).catch((e) => setError(e.message))
              }
            />
          ))}
          {editable && (
            <CaptureControl
              scope={{
                serverOrigin: client.endpoint,
                companyId: w.company,
                userId: w.session?.user.id ?? "",
                targetKind: "task",
                targetId: id,
              }}
              label={"Task evidence: " + task.title}
              onUploaded={async () => {
                await w.refresh("tasks");
                await load();
              }}
            />
          )}
          {editable && (
            <>
              <TextInput
                accessibilityLabel="Review reason"
                placeholder="Review or change reason"
                value={reason}
                onChangeText={setReason}
                style={ui.input}
              />
              {!["done", "cancelled"].includes(task.status) && (
                <>
                  <Action
                    title="Mark in progress"
                    disabled={busy}
                    onPress={() => actOnTask(task, "in_progress")}
                  />
                  <Action
                    title="Submit for review / complete"
                    primary
                    disabled={busy}
                    onPress={() =>
                      actOnTask(
                        task,
                        task.requiresApproval ? "in_review" : "done",
                      )
                    }
                  />
                </>
              )}
              {task.reviewerId === w.session?.user.id &&
                task.ownerId !== w.session?.user.id &&
                task.status === "in_review" && (
                  <Action
                    title="Accept submitted evidence"
                    disabled={busy}
                    onPress={() => actOnTask(task, "", true)}
                  />
                )}
            </>
          )}
          {!!error && <Text accessibilityRole="alert">{error}</Text>}
        </View>
      )}
    </Page>
  );
}
