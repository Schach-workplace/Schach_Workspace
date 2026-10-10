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
interface Preview {
  audienceUserIds: string[];
  notice: string;
}
export default function Publication({
  source,
  conversation,
  onClose,
}: {
  source: Message;
  conversation: Conversation;
  onClose: () => void;
}) {
  const w = useWorkspace();
  const [mode, setMode, retireMode] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "mode",
    "task",
  );
  const [title, setTitle, retireTitle] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "title",
    source.body.slice(0, 200),
  );
  const [excerpt, setExcerpt, retireExcerpt] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "excerpt",
    "",
  );
  const [owner, setOwner, retireOwner] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "owner",
    w.session!.user.id,
  );
  const [reviewer, setReviewer, retireReviewer] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "reviewer",
    "",
  );
  const [department, setDepartment, retireDepartment] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "department",
    w.work?.me.departmentId ?? "",
  );
  const [dueDate, setDueDate, retireDueDate] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "dueDate",
    "",
  );
  const [timed, setTimed, retireTimed] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "timed",
    false,
  );
  const [instant, setInstant, retireInstant] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "instant",
    "",
  );
  const [zone] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "zone",
    w.work?.company.timezone ?? "Asia/Kolkata",
  );
  const [vendor, setVendor, retireVendor] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "vendor",
    "",
  );
  const [amount, setAmount, retireAmount] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "amount",
    "",
  );
  const [category, setCategory, retireCategory] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "category",
    "",
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, , retireKey] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "key",
    () => Crypto.randomUUID(),
  );
  const [pending, setPending, retirePending] = useRamInput<{
    path: string;
    body: unknown;
  } | null>(conversation.id + ":publication:" + source.id, "pending", null);
  const [error, setError] = useState("");
  const [localTime, setLocalTime, retireLocalTime] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "localTime",
    "",
  );
  const [choices, setChoices] = useState<string[]>([]);
  const active = useRef(true);
  const attemptBusy = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const root = `/companies/${w.company}/conversations/${conversation.id}`;
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
        actionId: "primary",
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
          retireKey();
          if (current()) {
            setPreview(null);
            setAck(false);
            onClose();
          }
        }
        await w.refresh();
      } else {
        const result = await client.request<Preview>(
          attempt.path + "/preview",
          "POST",
          attempt.body,
        );
        if (current() && request === previewRequest.current) setPreview(result);
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
  return (
    <View style={styles.message}>
      <Text style={styles.heading}>
        Publish selected work · revision {source.revision}
      </Text>
      <Text>
        This creates an independent work record. Review the current server
        audience before committing.
      </Text>
      {["task", "request", "expense"].map((m) => (
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
      {field("Published title", title, setTitle)}
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
      {preview && (
        <>
          <Text>{preview.notice}</Text>
          <Text>
            Current audience:{" "}
            {preview.audienceUserIds
              .map(
                (id) =>
                  w.work?.people.find((p) => p.id === id)?.name ??
                  "Company member",
              )
              .join(", ")}
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
        title="Preview server audience"
        disabled={locked || !title.trim()}
        onPress={() => void perform(false)}
      />
      <Button
        title={
          pending ? "Retry the same publication" : "Publish selected record"
        }
        disabled={busy || (!pending && (!preview || !ack))}
        onPress={() => void perform(true)}
      />
      <Button title="Close publication" onPress={onClose} />
    </View>
  );
}
