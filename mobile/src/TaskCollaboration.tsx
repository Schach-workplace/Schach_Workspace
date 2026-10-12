import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useWorkspace } from "./Workspace";
import { Action, ui } from "./ConnectUI";
import { client } from "./client";
import { useRamInput } from "./ramInput";
import { companyDate } from "./workDates";
import {
  DEFAULT_NUDGE,
  taskCollaborationRights,
  timeEntryBody,
  type CollaborationTask,
} from "./taskCollaboration";
export interface CollaborationDetail extends CollaborationTask {
  id: string;
  comments?: { id: string; body: string; userId?: string; createdAt?: string }[];
  actualHours?: number;
}
/**
 * Task conversation, time logging and owner nudges. Request bodies match the
 * web TaskDrawer exactly (no retry keys: these endpoints are not idempotent on
 * the web either), so a single in-flight guard prevents duplicate posts.
 */
export default function TaskCollaboration({
  task,
  onChanged,
}: {
  task: CollaborationDetail;
  onChanged: () => Promise<void>;
}) {
  const w = useWorkspace();
  const zone = w.work?.company.timezone || "Asia/Kolkata";
  const form = "$task-collab:" + task.id;
  const [comment, setComment] = useRamInput(form, "comment", "");
  const [nudge, setNudge] = useRamInput(form, "nudge", "");
  const [hours, setHours] = useRamInput(form, "hours", "1");
  const [timeDate, setTimeDate] = useRamInput(form, "timeDate", () =>
    companyDate(new Date(), zone),
  );
  const [timeNote, setTimeNote] = useRamInput(form, "timeNote", "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  if (!w.work) return null;
  const rights = taskCollaborationRights(
    { me: w.work.me, people: w.work.people },
    task,
  );
  const company = w.company;
  const root = `/companies/${company}/tasks/${task.id}`;
  function perform(
    path: string,
    body: unknown,
    done: () => void,
    message: string,
  ) {
    if (pending.current) return;
    pending.current = true;
    const generation = client.generation;
    const current = () =>
      alive.current && client.generation === generation && w.company === company;
    setBusy(true);
    setError("");
    setNotice("");
    void (async () => {
      await client.request(root + path, "POST", body);
      if (!current()) return;
      done();
      setNotice(message);
      await onChanged();
    })()
      .catch((e) => {
        if (current())
          setError(
            e instanceof Error
              ? e.message
              : "The change could not be saved. Please try again.",
          );
      })
      .finally(() => {
        pending.current = false;
        if (alive.current) setBusy(false);
      });
  }
  const person = (id?: string) =>
    w.work?.people.find((p) => p.id === id)?.name || "Unassigned";
  const comments = task.comments ?? [];
  return (
    <View style={{ gap: 10 }}>
      <Text style={ui.name}>Conversation</Text>
      {comments.length === 0 && (
        <Text style={ui.subtitle}>
          No comments yet. Share an update or ask a question.
        </Text>
      )}
      {comments.map((c) => (
        <View key={c.id}>
          <Text style={ui.subtitle}>
            {person(c.userId)}
            {c.createdAt ? " · " + new Date(c.createdAt).toLocaleString() : ""}
          </Text>
          <Text>{c.body}</Text>
        </View>
      ))}
      {rights.comment && (
        <>
          <TextInput
            accessibilityLabel="Write a comment"
            placeholder="Share progress, context, or a question…"
            multiline
            maxLength={10000}
            value={comment}
            onChangeText={setComment}
            style={ui.input}
          />
          <Action
            title="Post comment"
            primary
            disabled={busy || !comment.trim()}
            onPress={() =>
              perform(
                "/comments",
                { body: comment.trim() },
                () => setComment(""),
                "Comment posted.",
              )
            }
          />
        </>
      )}
      {rights.nudge && (
        <>
          <Text style={ui.name}>Ask for an update</Text>
          <Text style={ui.subtitle}>
            Send an in-app notification to {person(task.ownerId)}.
          </Text>
          <TextInput
            accessibilityLabel="Nudge message"
            placeholder="A quick update would help…"
            maxLength={2000}
            value={nudge}
            onChangeText={setNudge}
            style={ui.input}
          />
          <Action
            title="Nudge"
            disabled={busy}
            onPress={() =>
              perform(
                "/nudge",
                { message: nudge || DEFAULT_NUDGE },
                () => setNudge(""),
                "Update requested in the owner’s inbox.",
              )
            }
          />
        </>
      )}
      {rights.logTime && (
        <>
          <Text style={ui.name}>Log time</Text>
          <Text style={ui.subtitle}>
            Self-reported time helps plan future work. It is not an employee
            performance rating.
            {task.actualHours ? ` Logged so far: ${task.actualHours} h.` : ""}
          </Text>
          <TextInput
            accessibilityLabel="Hours"
            keyboardType="decimal-pad"
            value={hours}
            onChangeText={setHours}
            style={ui.input}
          />
          <TextInput
            accessibilityLabel="Work date"
            placeholder="YYYY-MM-DD"
            value={timeDate}
            onChangeText={setTimeDate}
            style={ui.input}
          />
          <TextInput
            accessibilityLabel="Work completed"
            placeholder="What did you work on?"
            maxLength={4000}
            value={timeNote}
            onChangeText={setTimeNote}
            style={ui.input}
          />
          <Action
            title="Log time"
            disabled={busy}
            onPress={() => {
              let body: ReturnType<typeof timeEntryBody>;
              try {
                body = timeEntryBody(hours, timeDate, timeNote);
              } catch (e) {
                setError((e as Error).message);
                return;
              }
              perform(
                "/time",
                body,
                () => {
                  setTimeNote("");
                  setHours("1");
                },
                "Time logged.",
              );
            }}
          />
        </>
      )}
      {!!notice && <Text>{notice}</Text>}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
    </View>
  );
}
