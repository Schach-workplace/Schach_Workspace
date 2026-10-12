import { workDeadline, DeadlineChoiceError } from "./workDates";
import { Action } from "./ConnectUI";
import PersonPicker from "./PersonPicker";
import DeadlinePicker from "./DeadlinePicker";
import { useRamInput } from "./ramInput";
import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { Button, Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { client } from "./client";
import {
  useWorkspace,
  styles,
  type Message,
  type Conversation,
} from "./Workspace";
import { exactMinor } from "./publication";
// Mirrors backend previewTaskConversion. "existing" means this instruction
// action already has a task: no new task is created, the message links to
// that task and the audience listed is the existing task's audience.
interface Preview {
  outcome?: "created" | "existing";
  existingTaskId?: string;
  existingTaskTitle?: string;
  audienceUserIds: string[];
  notice: string;
}
interface WorkAction {
  id: string;
  title: string;
  sourceRevision: number;
}
export default function Publication({
  source,
  conversation,
  onClose,
  only,
}: {
  source: Message;
  conversation: Conversation;
  onClose: () => void;
  // "task" mirrors the browser "Create task" flow: task-only, with the
  // server-declared instruction actions and an explicit title/audience check.
  only?: "task";
}) {
  const w = useWorkspace();
  // Task conversion keeps its own frozen key/attempt, separate from the
  // request/expense publication of the same message.
  const form =
    conversation.id +
    (only ? ":task-conversion:" : ":publication:") +
    source.id;
  const [storedMode, setMode, retireMode] = useRamInput(
    form,
    "mode",
    only ? "task" : "request",
  );
  // Tasks are created only through the explicit task disclosure flow.
  const mode = only ?? storedMode;
  const [title, setTitle, retireTitle] = useRamInput(
    form,
    "title",
    source.body.slice(0, 200),
  );
  const [excerpt, setExcerpt, retireExcerpt] = useRamInput(
    form,
    "excerpt",
    "",
  );
  const [owner, setOwner, retireOwner] = useRamInput(
    form,
    "owner",
    w.session!.user.id,
  );
  const [reviewer, setReviewer, retireReviewer] = useRamInput(
    form,
    "reviewer",
    "",
  );
  const [department, setDepartment, retireDepartment] = useRamInput(
    form,
    "department",
    w.work?.me.departmentId ?? "",
  );
  const [dueDate, setDueDate, retireDueDate] = useRamInput(
    form,
    "dueDate",
    "",
  );
  const [timed, setTimed, retireTimed] = useRamInput(
    form,
    "timed",
    false,
  );
  const [instant, setInstant, retireInstant] = useRamInput(
    form,
    "instant",
    "",
  );
  const [zone] = useRamInput(
    form,
    "zone",
    w.work?.company.timezone ?? "Asia/Kolkata",
  );
  const [vendor, setVendor, retireVendor] = useRamInput(
    form,
    "vendor",
    "",
  );
  const [amount, setAmount, retireAmount] = useRamInput(
    form,
    "amount",
    "",
  );
  const [category, setCategory, retireCategory] = useRamInput(
    form,
    "category",
    "",
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, , retireKey] = useRamInput(
    form,
    "key",
    () => Crypto.randomUUID(),
  );
  const [pending, setPending, retirePending] = useRamInput<{
    path: string;
    body: unknown;
  } | null>(form, "pending", null);
  const [error, setError] = useState("");
  const [localTime, setLocalTime, retireLocalTime] = useRamInput(
    form,
    "localTime",
    "",
  );
  const [choices, setChoices] = useState<string[]>([]);
  const [actionId, setActionId, retireActionId] = useRamInput(
    form,
    "actionId",
    "primary",
  );
  const [workActions, setWorkActions] = useState<WorkAction[]>([]);
  const active = useRef(true);
  const attemptBusy = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const root = `/companies/${w.company}/conversations/${conversation.id}`;
  useEffect(() => {
    if (!only) return;
    let alive = true;
    const generation = client.generation;
    // Only current server-issued split identifiers may be selected.
    client
      .request<{ actions: WorkAction[] }>(
        `${root}/work-actions?anchorMessageId=${encodeURIComponent(source.id)}`,
      )
      .then((v) => {
        if (alive && generation === client.generation)
          setWorkActions(
            v.actions.filter((a) => a.sourceRevision === source.revision),
          );
      })
      .catch(() => {
        if (alive) setWorkActions([]);
      });
    return () => {
      alive = false;
    };
  }, [only, root, source.id, source.revision]);
  const ownerKey = JSON.stringify([
    root,
    source.id,
    source.revision,
    conversation.version,
  ]);
  const [previewOwner, setPreviewOwner] = useState(ownerKey);
  if (previewOwner !== ownerKey) {
    setPreviewOwner(ownerKey);
    setPreview(null);
    setAck(false);
  }
  const ownership = useRef({
    root,
    source: source.id,
    revision: source.revision,
    version: conversation.version,
  });
  const previewRequest = useRef(0);
  useLayoutEffect(() => {
    ownership.current = {
      root,
      source: source.id,
      revision: source.revision,
      version: conversation.version,
    };
    previewRequest.current++;
  }, [root, source.id, source.revision, conversation.version]);
  function change() {
    previewRequest.current++;
    setPreview(null);
    setAck(false);
  }
  function input() {
    const common = {
      retryKey: key,
      anchorMessageId: source.id,
      expectedPolicyVersion: conversation.version,
    };
    if (mode === "request")
      return {
        path: root + "/requests",
        body: {
          ...common,
          sourceRevision: source.revision,
          departmentId: department,
          title,
          summary: excerpt,
        },
      };
    const publication = { excerpt, attachmentIds: [] };
    const sources = [{ messageId: source.id, revision: source.revision }];
    if (mode === "expense")
      return {
        path: root + "/expense-conversions",
        body: {
          ...common,
          sources,
          publication,
          expense: {
            departmentId: department,
            categoryId: category,
            title,
            description: "",
            vendor,
            invoiceNumber: "",
            expenseDate: dueDate,
            amountMinor: exactMinor(amount),
            projectId: "",
            taskId: "",
            receiptExceptionReason: "",
          },
        },
      };
    return {
      path: root + "/task-conversions",
      body: {
        ...common,
        sources,
        publication,
        actionId: only ? actionId : "primary",
        task: {
          title,
          description: "",
          ownerId: owner,
          reviewerId: reviewer,
          departmentId:
            w.work?.people.find((p) => p.id === owner)?.departmentId ?? "",
          projectId: "",
          parentId: "",
          priority: "medium",
          status: "todo",
          ...workDeadline(dueDate, timed ? localTime : "", zone, instant),
          startDate: "",
          estimatedHours: 0,
          tags: [],
          checklist: [],
          dependencies: [],
          collaborators: [],
          recurrence: "none",
          requiresApproval: !!reviewer,
        },
      },
    };
  }
  async function perform(create: boolean) {
    if (attemptBusy.current) return;
    attemptBusy.current = true;
    setBusy(true);
    setError("");
    const generation = client.generation;
    const target = ownership.current;
    const request = ++previewRequest.current;
    const current = () =>
      active.current &&
      target === ownership.current &&
      generation === client.generation;
    try {
      const attempt = pending ?? input();
      if (create) {
        setPending(attempt);
        await client.request(attempt.path, "POST", attempt.body);
        if (generation !== client.generation) return;
        if (retirePending(attempt)) {
          retireMode();
          retireTitle();
          retireExcerpt();
          retireOwner();
          retireReviewer();
          retireDepartment();
          retireDueDate();
          retireTimed();
          retireInstant();
          retireVendor();
          retireAmount();
          retireCategory();
          retireLocalTime();
          retireActionId();
          retireKey();
          if (current()) {
            setPreview(null);
            setAck(false);
            onClose();
          }
        }
        await w.refresh();
      } else {
        // A new preview always needs a fresh confirmation.
        setAck(false);
        const result = await client.request<Preview>(
          attempt.path + "/preview",
          "POST",
          attempt.body,
        );
        if (current() && request === previewRequest.current) {
          setAck(false);
          setPreview(result);
        }
      }
    } catch (e) {
      if (current()) {
        if (e instanceof DeadlineChoiceError) setChoices(e.candidates);
        setError((e as Error).message);
      }
    } finally {
      attemptBusy.current = false;
      if (active.current) setBusy(false);
    }
  }
  const locked = !!pending || busy;
  const existing = preview?.outcome === "existing";
  const existingNotice =
    "No new task will be created. This message links to the existing task \u201c" +
    (preview?.existingTaskTitle ?? "") +
    "\u201d and confirming opens it; the fields above are not applied.";
  const field = (label: string, value: string, set: (v: string) => void) => (
    <TextInput
      key={label}
      accessibilityLabel={label}
      placeholder={label}
      style={styles.input}
      value={value}
      editable={!locked}
      onChangeText={(v) => {
        set(v);
        change();
      }}
    />
  );
  const personName = (id: string) =>
    w.work?.people.find((p) => p.id === id)?.name ?? "Company member";
  const taskReady = mode !== "task" || !!dueDate;
  return (
    <View style={styles.message}>
      <Text style={styles.heading}>
        {only ? "Create task from message" : "Publish selected work"} ·
        revision {source.revision}
      </Text>
      <Text>
        This creates an independent work record. Review the current server
        audience before committing.
      </Text>
      {(only ? [] : ["request", "expense"]).map((m) => (
        <Button
          key={m}
          title={m + (mode === m ? " ✓" : "")}
          disabled={locked}
          onPress={() => {
            setMode(m);
            change();
          }}
        />
      ))}
      {only && (
        <>
          <Text>Instruction action</Text>
          {[{ id: "primary", title: "Primary instruction" }, ...workActions].map(
            (a) => (
              <Button
                key={a.id}
                title={a.title + (actionId === a.id ? " ✓" : "")}
                disabled={locked}
                onPress={() => {
                  setActionId(a.id);
                  if (a.id !== "primary") setTitle(a.title);
                  change();
                }}
              />
            ),
          )}
        </>
      )}
      {field(only ? "Task title" : "Published title", title, setTitle)}
      {field("Selected excerpt (optional)", excerpt, setExcerpt)}
      {mode === "task" ? (
        <>
          <PersonPicker
            departmentNames={Object.fromEntries(
              (w.work?.departments ?? []).map((d) => [d.id, d.name]),
            )}
            label="Task owner"
            people={w.work?.people ?? []}
            value={owner}
            onChange={(id) => {
              setOwner(id);
              setReviewer("");
              change();
            }}
            disabled={locked}
          />
          <PersonPicker
            departmentNames={Object.fromEntries(
              (w.work?.departments ?? []).map((d) => [d.id, d.name]),
            )}
            label="Independent reviewer"
            people={w.work?.people ?? []}
            value={reviewer}
            excludeIds={[owner]}
            allowNone
            onChange={(id) => {
              setReviewer(id);
              change();
            }}
            disabled={locked}
          />
          <DeadlinePicker
            date={dueDate}
            time={timed ? localTime : ""}
            timezone={zone}
            disabled={locked}
            onChange={(v) => {
              setDueDate(v.date);
              setLocalTime(v.time);
              setTimed(!!v.time);
              setInstant("");
              setChoices([]);
              change();
            }}
          />
          {choices.map((at) => (
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
              onPress={() => {
                setInstant(at);
                change();
              }}
            />
          ))}
        </>
      ) : (
        <>
          <Text>Responsible department</Text>
          {w.work?.departments.map((d) => (
            <Button
              key={d.id}
              title={d.name + (department === d.id ? " ✓" : "")}
              disabled={locked}
              onPress={() => {
                setDepartment(d.id);
                change();
              }}
            />
          ))}
        </>
      )}
      {mode === "expense" && (
        <>
          {field("Vendor", vendor, setVendor)}
          {field("Incurred date YYYY-MM-DD", dueDate, setDueDate)}
          {field("Amount in minor units", amount, setAmount)}
          {w.work?.expenseCategories
            .filter((c) => c.active)
            .map((c) => (
              <Button
                key={c.id}
                title={c.name + (category === c.id ? " ✓" : "")}
                disabled={locked}
                onPress={() => {
                  setCategory(c.id);
                  change();
                }}
              />
            ))}
        </>
      )}
      {preview && only && (
        <View accessibilityLabel="Task disclosure">
          <Text>{preview.notice}</Text>
          {existing ? (
            <>
              <Text>{"Task title: " + (preview.existingTaskTitle ?? "")}</Text>
              <Text>{existingNotice}</Text>
            </>
          ) : (
            <>
              <Text>{"Task title: " + title}</Text>
              <Text>{"Owner: " + personName(owner)}</Text>
              <Text>
                {"Reviewer: " + (reviewer ? personName(reviewer) : "None")}
              </Text>
              <Text>
                {"Due: " +
                  dueDate +
                  (timed && localTime ? " " + localTime : "")}
              </Text>
              <Text>
                {excerpt
                  ? "Published excerpt: " + excerpt
                  : "No message excerpt is published."}
              </Text>
            </>
          )}
          <Text>
            {"Visible to: " +
              preview.audienceUserIds.map(personName).join(", ")}
          </Text>
          <Button
            title={
              existing
                ? ack
                  ? "Existing task and audience confirmed ✓"
                  : "I confirm this existing task and its audience"
                : ack
                  ? "Task title and audience confirmed ✓"
                  : "I confirm this task title and audience"
            }
            disabled={locked}
            onPress={() => setAck(true)}
          />
        </View>
      )}
      {pending && !preview && only && (
        <Text>
          {"Retrying the already confirmed task: " +
            ((pending.body as { task?: { title?: string } }).task?.title ??
              "")}
        </Text>
      )}
      {preview && !only && (
        <>
          <Text>{preview.notice}</Text>
          {existing && (
            <>
              <Text>{"Existing task: " + (preview.existingTaskTitle ?? "")}</Text>
              <Text>{existingNotice}</Text>
            </>
          )}
          <Text>
            Current audience:{" "}
            {preview.audienceUserIds.map(personName).join(", ")}
          </Text>
          <Button
            title={
              ack
                ? "Audience reviewed ✓"
                : "I reviewed the selected content and audience"
            }
            disabled={locked}
            onPress={() => setAck(true)}
          />
        </>
      )}
      {error && <Text accessibilityRole="alert">{error}</Text>}
      <Button
        title={only ? "Preview task audience" : "Preview server audience"}
        disabled={locked || !title.trim() || (!!only && !taskReady)}
        onPress={() => void perform(false)}
      />
      <Button
        title={
          pending
            ? "Retry the same publication"
            : existing
              ? "Link to existing task"
              : only
                ? "Create task"
              : "Publish selected record"
        }
        disabled={busy || (!pending && (!preview || !ack))}
        onPress={() => void perform(true)}
      />
      <Button title="Close publication" onPress={onClose} />
    </View>
  );
}
