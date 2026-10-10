import { workDeadline, DeadlineChoiceError } from "./workDates";
import { Action } from "./ConnectUI";
import PersonPicker from "./PersonPicker";
import DeadlinePicker from "./DeadlinePicker";
import { useRamInput } from "./ramInput";
import { useState } from "react";
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
  const [mode, setMode] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "mode",
    "task",
  );
  const [title, setTitle] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "title",
    source.body.slice(0, 200),
  );
  const [excerpt, setExcerpt] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "excerpt",
    "",
  );
  const [owner, setOwner] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "owner",
    w.session!.user.id,
  );
  const [reviewer, setReviewer] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "reviewer",
    "",
  );
  const [department, setDepartment] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "department",
    w.work?.me.departmentId ?? "",
  );
  const [dueDate, setDueDate] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "dueDate",
    "",
  );
  const [timed, setTimed] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "timed",
    false,
  );
  const [instant, setInstant] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "instant",
    "",
  );
  const [zone] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "zone",
    w.work?.company.timezone ?? "Asia/Kolkata",
  );
  const [vendor, setVendor] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "vendor",
    "",
  );
  const [amount, setAmount] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "amount",
    "",
  );
  const [category, setCategory] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "category",
    "",
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "key",
    () => Crypto.randomUUID(),
  );
  const [pending, setPending] = useRamInput<{
    path: string;
    body: unknown;
  } | null>(conversation.id + ":publication:" + source.id, "pending", null);
  const [error, setError] = useState("");
  const [localTime, setLocalTime] = useRamInput(
    conversation.id + ":publication:" + source.id,
    "localTime",
    "",
  );
  const [choices, setChoices] = useState<string[]>([]);
  const root = `/companies/${w.company}/conversations/${conversation.id}`;
  function change() {
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
    setBusy(true);
    try {
      const attempt = pending ?? input();
      if (create) {
        setPending(attempt);
        await client.request(attempt.path, "POST", attempt.body);
        await w.refresh();
        onClose();
      } else {
        setPreview(
          await client.request<Preview>(
            attempt.path + "/preview",
            "POST",
            attempt.body,
          ),
        );
      }
    } catch (e) {
      if (e instanceof DeadlineChoiceError) setChoices(e.candidates);
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
