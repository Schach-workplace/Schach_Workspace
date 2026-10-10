import { useEffect, useMemo, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Page, useWorkspace, type WorkTask, type WorkData } from "./Workspace";
import { Action, Sheet, ui } from "./ConnectUI";
import NativeMedia from "./Media";
import { client } from "./client";
import {
  companyDate,
  DeadlineChoiceError,
  shiftDate,
  workDeadline,
} from "./workDates";
export default function WorkScreen() {
  const w = useWorkspace();
  return (
    <WorkView
      key={`${w.company}:${w.session?.user.id}:${w.work?.me.role}`}
      w={w}
    />
  );
}
function WorkView({ w }: { w: ReturnType<typeof useWorkspace> }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState("");
  const [title, setTitle] = useState("");
  const [dueDate, setDate] = useState("");
  const [time, setTime] = useState("");
  const [instant, setInstant] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const zone = w.work?.company.timezone || "Asia/Kolkata";
  const editable = !!w.work && w.work.me.role !== "viewer";
  const rows = (w.work?.tasks || []).filter(
    (t) =>
      (filter === "all" ||
        (filter === "open"
          ? !["done", "cancelled"].includes(t.status)
          : t.status === "in_review")) &&
      (!query || t.title.toLowerCase().includes(query.toLowerCase())),
  );
  const task = w.work?.tasks.find((t) => t.id === selected);
  const deadline = useMemo(() => {
    try {
      return {
        value: workDeadline(dueDate, time, zone, instant),
        error: "",
        choices: [] as string[],
      };
    } catch (e) {
      return {
        value: null,
        error: (e as Error).message,
        choices: e instanceof DeadlineChoiceError ? e.candidates : [],
      };
    }
  }, [dueDate, time, zone, instant]);
  async function run(action: () => Promise<void>) {
    if (pending.current || !editable) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (alive.current) {
        setError((e as Error).message);
        w.setError((e as Error).message);
      }
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function openCreate() {
    setTitle("");
    setDate(companyDate(new Date(), zone));
    setTime("");
    setInstant("");
    setReviewer("");
    setError("");
    setCreating(true);
  }
  function create() {
    if (!title.trim() || !deadline.value || !w.work) return;
    void run(async () => {
      await client.request(`/companies/${w.company}/tasks`, "POST", {
        title: title.trim(),
        description: "",
        ownerId: w.session!.user.id,
        departmentId: w.work!.me.departmentId,
        reviewerId: reviewer,
        requiresApproval: !!reviewer,
        ...deadline.value,
        recurrence: "none",
        priority: "medium",
        status: "todo",
        startDate: "",
        estimatedHours: 0,
        tags: [],
        checklist: [],
        dependencies: [],
        collaborators: [],
      });
      if (alive.current) setCreating(false);
      await w.refresh();
    });
  }
  function actOnTask(current: WorkTask, status: string, review = false) {
    void run(async () => {
      const fresh = await client.request<WorkData>(
        `/companies/${w.company}/workspace`,
      );
      const found = fresh.tasks.find((t) => t.id === current.id);
      if (!found || found.version !== current.version) {
        await w.refresh();
        throw Error(
          "Task changed or access changed. Review the current details before trying again.",
        );
      }
      if (review)
        await client.request(
          `/companies/${w.company}/tasks/${current.id}/review`,
          "POST",
          { version: current.version, decision: "approve", comment: reason },
        );
      else
        await client.request(
          `/companies/${w.company}/tasks/${current.id}`,
          "PATCH",
          { version: current.version, status },
        );
      if (alive.current) setSelected("");
      await w.refresh();
    });
  }
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
  return (
    <Page>
      <View style={ui.row}>
        <Text style={ui.title}>Work</Text>
        {editable && <Action title="New task" primary onPress={openCreate} />}
      </View>
      <Text style={ui.subtitle}>
        Your commitments and authorized team work · {zone}
      </Text>
      <TextInput
        accessibilityLabel="Search work"
        placeholder="Search work"
        value={query}
        onChangeText={setQuery}
        style={ui.input}
      />
      <View style={[ui.row, { flexWrap: "wrap" }]}>
        {[
          ["all", "All"],
          ["open", "Open"],
          ["review", "Awaiting review"],
        ].map(([id, name]) => (
          <Action
            key={id}
            title={name}
            selected={filter === id}
            onPress={() => setFilter(id)}
          />
        ))}
      </View>
      {!rows.length && (
        <Text style={ui.subtitle}>No work matches these filters.</Text>
      )}
      {rows.map((t) => (
        <View
          key={t.id}
          style={{
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderBottomColor: "#e9ebef",
            gap: 8,
          }}
        >
          <Text style={ui.name}>{t.title}</Text>
          <Text style={ui.subtitle}>
            {t.status.replaceAll("_", " ")} · {dateLabel(t)}
          </Text>
          <Action
            title={"Open: " + t.title}
            onPress={() => {
              setReason("");
              setError("");
              setSelected(t.id);
            }}
          />
        </View>
      ))}
      {creating && editable && (
        <Sheet
          title="New commitment"
          onClose={() => {
            if (!pending.current) setCreating(false);
          }}
          keyboard
        >
          <Text>
            One owner, a clear deadline and an independent reviewer when
            required.
          </Text>
          <Text>Task title</Text>
          <TextInput
            accessibilityLabel="Task title"
            placeholder="What needs to be delivered?"
            maxLength={240}
            value={title}
            onChangeText={setTitle}
            style={ui.input}
          />
          <Text>Deadline date</Text>
          <TextInput
            accessibilityLabel="Due date"
            placeholder="YYYY-MM-DD"
            value={dueDate}
            onChangeText={(v) => {
              setDate(v);
              setInstant("");
            }}
            style={ui.input}
          />
          <View style={[ui.row, { flexWrap: "wrap" }]}>
            {[
              [0, "Today"],
              [1, "Tomorrow"],
              [7, "In a week"],
            ].map(([days, label]) => (
              <Action
                key={label}
                title={String(label)}
                onPress={() => {
                  setDate(
                    shiftDate(companyDate(new Date(), zone), Number(days)),
                  );
                  setInstant("");
                }}
              />
            ))}
          </View>
          <Text>Optional deadline time · {zone}</Text>
          <TextInput
            accessibilityLabel="Deadline time"
            placeholder="HH:mm, for example 16:00"
            value={time}
            onChangeText={(v) => {
              setTime(v);
              setInstant("");
            }}
            maxLength={5}
            style={ui.input}
          />
          <Text style={ui.subtitle}>
            Leave time empty for an all-day commitment. Times use the company
            timezone.
          </Text>
          {!!deadline.error && (
            <Text accessibilityRole="alert">{deadline.error}</Text>
          )}
          {deadline.choices.map((at) => (
            <Action
              key={at}
              title={
                "Use " +
                new Intl.DateTimeFormat("en", {
                  timeZone: zone,
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZoneName: "shortOffset",
                }).format(new Date(at))
              }
              onPress={() => setInstant(at)}
            />
          ))}
          <Text>Reviewer</Text>
          <Action
            title="No reviewer"
            selected={!reviewer}
            onPress={() => setReviewer("")}
          />
          {w.work?.people
            .filter(
              (p) =>
                p.active && p.id !== w.session?.user.id && p.role !== "viewer",
            )
            .map((p) => (
              <Action
                key={p.id}
                title={"Reviewer: " + p.name}
                selected={reviewer === p.id}
                onPress={() => setReviewer(p.id)}
              />
            ))}
          {!!error && <Text accessibilityRole="alert">{error}</Text>}
          <Action
            title={busy ? "Creating…" : "Create task"}
            primary
            disabled={busy || !title.trim() || !deadline.value}
            onPress={create}
          />
        </Sheet>
      )}
      {task && (
        <Sheet
          title={task.title}
          onClose={() => {
            if (!pending.current) setSelected("");
          }}
          keyboard
        >
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
        </Sheet>
      )}
    </Page>
  );
}
