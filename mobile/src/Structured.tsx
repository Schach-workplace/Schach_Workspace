import {
  structuredPeople,
  type StructuredMember,
} from "../../shared/communication/structuredPeople";
import DeadlinePicker from "./DeadlinePicker";
import { workDeadline, DeadlineChoiceError } from "./workDates";
import { Action, ui } from "./ConnectUI";
import IntelligenceLauncher from "./IntelligenceLauncher";
import {
  useEffect,
  useEffectEvent,
  useState,
  useRef,
  useLayoutEffect,
} from "react";
import { Button, FlatList, Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { client } from "./client";
import { useWorkspace, styles, type Message } from "./Workspace";
interface RecordItem {
  anchorMessageId: string;
  id: string;
  title: string;
  body: string;
  revision: number;
  kind: string;
  options: string[];
  state: string;
  createdBy: string;
  dueAt: string;
}
interface Response {
  recordId: string;
  revision: number;
  userId: string;
  response: string;
}
export default function Structured({
  source,
  onClose,
  recordId = "",
  conversation,
  members = [],
  sourceReady = false,
}: {
  source: Message | null;
  conversation?: { id: string; public: boolean };
  members?: StructuredMember[];
  sourceReady?: boolean;
  onClose: () => void;
  recordId?: string;
}) {
  const w = useWorkspace();
  const [kind, setKind] = useState("ack");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [options, setOptions] = useState("Yes\nNo");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [reviewer, setReviewer] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [fold, setFold] = useState("");
  const [offsets, setOffsets] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const creating = useRef(false);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [responses, setResponses] = useState<Response[]>([]);
  const [key] = useState(() => Crypto.randomUUID());
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<RecordItem | null>(null);
  const [revisionBody, setRevisionBody] = useState("");
  const [reason, setReason] = useState("");
  const root = `/companies/${w.company}/conversations/${w.selected}/records`;
  const scope = [
    root,
    recordId,
    w.recordEpoch,
    w.attentionEpoch,
    w.work?.readBasis,
    w.foreground,
    w.session?.user.id,
    client.generation,
    source?.id,
    source?.revision,
  ].join(":");
  const current = useRef(scope);
  const request = useRef(0);
  useLayoutEffect(() => {
    current.current = scope;
    request.current++;
    return () => {
      current.current = "";
    };
  }, [scope]);
  const [confirmed, setConfirmed] = useState("");
  async function refresh() {
    if (!w.foreground || current.current !== scope) return;
    const attempt = ++request.current;
    const generation = client.generation;
    setConfirmed("");
    setError("");
    try {
      const v = recordId
        ? await client
            .request<{ record: RecordItem; responses: Response[] }>(
              root + "/" + recordId,
            )
            .then((v) => ({ records: [v.record], responses: v.responses }))
        : await client.request<{
            records: RecordItem[];
            responses: Response[];
          }>(root);
      if (
        current.current === scope &&
        attempt === request.current &&
        generation === client.generation
      ) {
        setRecords(v.records);
        setResponses(v.responses);
        setConfirmed(scope);
        setError("");
      }
    } catch (e) {
      if (
        current.current === scope &&
        attempt === request.current &&
        generation === client.generation
      )
        throw e;
    }
  }
  const load = useEffectEvent(
    () =>
      void refresh().catch((e) => {
        if (current.current === scope) {
          setRecords([]);
          setResponses([]);
          setConfirmed("");
          setError(e.message);
        }
      }),
  );
  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [scope]);
  const sourceCurrent =
    sourceReady &&
    w.foreground &&
    !!conversation &&
    conversation.id === w.selected &&
    source?.conversationId === conversation.id;
  const choices = structuredPeople(
    w.work?.people ?? [],
    members,
    conversation?.public ?? false,
    source?.sequence ?? 0,
    w.session?.user.id ?? "",
    kind === "decision",
  );
  const matching = choices.filter((p) =>
    p.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const selectionReady =
    kind === "decision"
      ? choices.some((p) => p.id === reviewer)
      : recipients.length > 0 &&
        recipients.every((id) => choices.some((p) => p.id === id));
  const zone = w.work?.company.timezone ?? "Asia/Kolkata";
  async function create() {
    if (
      !source ||
      !sourceCurrent ||
      creating.current ||
      (!pending && !selectionReady)
    )
      return;
    const generation = client.generation;
    const valid = () =>
      current.current === scope && generation === client.generation;
    creating.current = true;
    setBusy(true);
    setError("");
    try {
      let input = pending;
      if (!input) {
        if (!!dueDate !== !!dueTime)
          throw Error(
            "Choose both a response deadline date and time, or leave both empty.",
          );
        const dueAt = dueDate
          ? workDeadline(dueDate, dueTime, zone, fold || undefined).dueAt
          : "";
        input = {
          retryKey: key,
          kind,
          anchorMessageId: source.id,
          sourceRevision: source.revision,
          title,
          body,
          options: kind === "poll" ? options.split("\n").filter(Boolean) : [],
          recipientIds: recipients,
          reviewerId: kind === "decision" ? reviewer : "",
          dueAt,
        };
        setPending(input);
      }
      await client.request(root, "POST", input);
      if (valid()) onClose();
    } catch (e) {
      if (valid()) {
        if (e instanceof DeadlineChoiceError) setOffsets(e.candidates);
        setError((e as Error).message);
      }
    } finally {
      creating.current = false;
      if (valid()) setBusy(false);
    }
  }
  async function respond(item: RecordItem, response: string) {
    try {
      await client.request(root + `/${item.id}/respond`, "POST", {
        expectedRevision: item.revision,
        response,
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function revise() {
    if (!editing) return;
    try {
      await client.request(root + "/" + editing.id, "PATCH", {
        expectedRevision: editing.revision,
        title: editing.title,
        body: revisionBody,
        options: editing.options,
        dueAt: editing.dueAt,
        reason,
      });
      setEditing(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const locked = busy || !!pending;
  return (
    <View style={styles.message}>
      <Text style={styles.heading}>
        Acknowledgements, polls, events and decisions
      </Text>
      <Text>
        These responses never approve tasks or payments. Material edits require
        a new revision.
      </Text>
      {source && (
        <>
          <Text>Source revision {source.revision}</Text>
          {["ack", "poll", "event", "decision"].map((k) => (
            <Button
              key={k}
              title={k + (kind === k ? " ✓" : "")}
              disabled={locked}
              onPress={() => setKind(k)}
            />
          ))}
          <TextInput
            style={styles.input}
            placeholder="Record title"
            accessibilityLabel="Record title"
            editable={!locked}
            value={title}
            onChangeText={setTitle}
          />
          <TextInput
            style={styles.input}
            placeholder="Selected record content"
            accessibilityLabel="Selected record content"
            editable={!locked}
            multiline
            value={body}
            onChangeText={setBody}
          />
          {kind === "poll" && (
            <TextInput
              style={styles.input}
              placeholder="One poll option per line"
              accessibilityLabel="Poll options"
              editable={!locked}
              multiline
              value={options}
              onChangeText={setOptions}
            />
          )}
          <DeadlinePicker
            label="Optional response deadline"
            dateLabel="Response deadline date"
            timeLabel="Response deadline time"
            date={dueDate}
            time={dueTime}
            timezone={zone}
            disabled={locked}
            requireTime
            onChange={(v) => {
              setDueDate(v.date);
              setDueTime(v.time);
              setFold("");
              setOffsets([]);
            }}
          />
          <Action
            title="Clear response deadline"
            disabled={locked}
            onPress={() => {
              setDueDate("");
              setDueTime("");
              setFold("");
              setOffsets([]);
            }}
          />
          {offsets.map((instant) => (
            <Action
              key={instant}
              title={"Use offset " + instant}
              selected={fold === instant}
              disabled={locked}
              onPress={() => setFold(instant)}
            />
          ))}
          <Text>
            {kind === "decision"
              ? "Independent reviewer"
              : "Fixed recipients with source access"}
          </Text>
          {!sourceCurrent && <Text>Checking current source access…</Text>}
          <TextInput
            accessibilityLabel="Search eligible people"
            placeholder="Search eligible people"
            value={search}
            onChangeText={setSearch}
            style={ui.input}
          />
          <FlatList
            data={sourceCurrent ? matching : []}
            keyExtractor={(p) => p.id}
            style={{ maxHeight: 240 }}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: p }) => (
              <Action
                title={
                  p.name +
                  ((
                    kind === "decision"
                      ? reviewer === p.id
                      : recipients.includes(p.id)
                  )
                    ? " ✓"
                    : "")
                }
                disabled={locked || !sourceCurrent}
                onPress={() =>
                  kind === "decision"
                    ? setReviewer(p.id)
                    : setRecipients((ids) =>
                        ids.includes(p.id)
                          ? ids.filter((id) => id !== p.id)
                          : [...ids, p.id],
                      )
                }
              />
            )}
          />
          <Button
            title={
              pending
                ? "Retry same structured record"
                : "Create structured record"
            }
            disabled={
              busy ||
              !sourceCurrent ||
              !title.trim() ||
              (!pending && !selectionReady)
            }
            onPress={() => void create()}
          />
          {!!pending && (
            <Text>
              Submitted intent is frozen. Retry it unchanged. If you close,
              inspect existing records before creating another.
            </Text>
          )}
        </>
      )}
      <IntelligenceLauncher
        choices={(w.foreground && confirmed === scope ? records : []).flatMap(
          (item) =>
            ["content", "content_responses"].map((selectedFieldSet) => ({
              label:
                item.title +
                (selectedFieldSet === "content_responses"
                  ? " and current responses"
                  : ""),
              source: {
                kind: "record",
                id: item.id,
                parentId: item.anchorMessageId,
                conversationId: w.selected,
                expectedRevision: item.revision,
                selectedFieldSet,
              },
            })),
        )}
      />
      {(w.foreground && confirmed === scope ? records : []).map((item) => {
        const mine = responses.find(
          (r) =>
            r.recordId === item.id &&
            r.revision === item.revision &&
            r.userId === w.session?.user.id,
        );
        return (
          <View style={styles.message} key={item.id}>
            <Text>
              {item.title} · revision {item.revision} · {item.state}
            </Text>
            <Text>{item.body}</Text>
            {mine?.response && <Text>Your response: {mine.response}</Text>}
            {mine &&
              item.state === "open" &&
              w.work?.me.role !== "viewer" &&
              (item.kind === "ack"
                ? ["acknowledged"]
                : item.kind === "poll"
                  ? item.options
                  : item.kind === "event"
                    ? ["attending", "maybe", "declined"]
                    : ["confirmed", "rejected"]
              ).map((response) => (
                <Button
                  key={response}
                  title={response}
                  onPress={() => void respond(item, response)}
                />
              ))}
            {item.createdBy === w.session?.user.id && (
              <Button
                title="Publish a new material revision"
                onPress={() => {
                  setEditing(item);
                  setRevisionBody(item.body);
                  setReason("");
                }}
              />
            )}
          </View>
        );
      })}
      {editing && (
        <>
          <TextInput
            accessibilityLabel="New revision content"
            multiline
            style={styles.input}
            value={revisionBody}
            onChangeText={setRevisionBody}
          />
          <TextInput
            accessibilityLabel="Revision reason"
            placeholder="Reason for new revision"
            style={styles.input}
            value={reason}
            onChangeText={setReason}
          />
          <Button
            title="Publish new revision and request new responses"
            disabled={!reason}
            onPress={() => void revise()}
          />
        </>
      )}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
      <Button title="Close structured communication" onPress={onClose} />
    </View>
  );
}
