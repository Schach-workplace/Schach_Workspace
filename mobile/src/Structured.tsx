import IntelligenceLauncher from "./IntelligenceLauncher";
import {
  useEffect,
  useEffectEvent,
  useState,
  useRef,
  useLayoutEffect,
} from "react";
import { Button, Text, TextInput, View } from "react-native";
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
}: {
  source: Message | null;
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
  const [due, setDue] = useState("");
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [responses, setResponses] = useState<Response[]>([]);
  const [key] = useState(() => Crypto.randomUUID());
  const [pending, setPending] = useState<unknown>(null);
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
  async function create() {
    if (!source) return;
    setBusy(true);
    try {
      if (due && !/(Z|[+-]\d\d:\d\d)$/.test(due))
        throw new Error("Response deadline needs an explicit offset.");
      const input = pending ?? {
        retryKey: key,
        kind,
        anchorMessageId: source.id,
        sourceRevision: source.revision,
        title,
        body,
        options: kind === "poll" ? options.split("\n").filter(Boolean) : [],
        recipientIds: recipients,
        reviewerId: kind === "decision" ? reviewer : "",
        dueAt: due,
      };
      setPending(input);
      await client.request(root, "POST", input);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
          <TextInput
            style={styles.input}
            placeholder="Optional response deadline with offset"
            accessibilityLabel="Response deadline with offset"
            editable={!locked}
            value={due}
            onChangeText={setDue}
          />
          <Text>
            {kind === "decision"
              ? "Independent reviewer"
              : "Fixed recipients with source access"}
          </Text>
          {w.work?.people
            .filter(
              (p) =>
                p.active &&
                (kind !== "decision" ||
                  (p.id !== w.session?.user.id && p.role !== "viewer")),
            )
            .map((p) => (
              <Button
                key={p.id}
                disabled={locked}
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
            ))}
          <Button
            title={
              pending
                ? "Retry same structured record"
                : "Create structured record"
            }
            disabled={
              busy ||
              !title ||
              (kind === "decision" ? !reviewer : recipients.length === 0)
            }
            onPress={() => void create()}
          />
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
