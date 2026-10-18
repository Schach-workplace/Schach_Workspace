import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { Action, Sheet, ui } from "./ConnectUI";
import { useWorkspace } from "./Workspace";
import { useExecutionRead, useExecutionGuard } from "./execution";
import { client } from "./client";
import { shareDocument } from "./shareDocument";
export default function ReviewedFileExport<T extends object>({
  title,
  path,
  input,
  fileName,
  description,
  signature,
  summarize,
  serialize,
  options,
  onClose,
}: {
  title: string;
  path: string;
  input?: unknown;
  fileName: string;
  description: string;
  signature: (data: T) => string;
  summarize: (data: T) => string[];
  serialize: (data: T) => string;
  options: { mimeType: string; UTI: string; dialogTitle: string };
  onClose: () => void;
}) {
  const w = useWorkspace(),
    q = useExecutionRead<T>(path, true, input),
    guard = useExecutionGuard(JSON.stringify([path, input]));
  const [reviewed, setReviewed] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  const basis = q.ready && q.data ? signature(q.data) : "";
  if ((q.denied || !w.foreground || !w.work) && reviewed) setReviewed("");
  async function share() {
    if (
      pending.current ||
      !basis ||
      reviewed !== basis ||
      !w.foreground ||
      !w.work
    )
      return;
    const current = guard();
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const fresh = await client.request<T>(
        `/companies/${w.company}${path}`,
        input === undefined ? "GET" : "POST",
        input,
      );
      if (!current()) return;
      if (signature(fresh) !== basis) {
        setReviewed("");
        q.retry();
        throw Error("Source changed. Review the current file before sharing.");
      }
      await shareDocument(fileName, serialize(fresh), current, options);
      if (current()) onClose();
    } catch (e) {
      if (current()) {
        setReviewed("");
        setError((e as Error).message);
      }
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  }
  return (
    <Sheet title={title} onClose={onClose} busy={busy}>
      <Text style={ui.body}>{description}</Text>
      <Text style={ui.subtitle}>
        The file is an independent copy. Recipients outside Workspace may retain
        it after your access is revoked.
      </Text>
      {!q.ready || !q.data ? (
        <Text>{q.error || "Checking current source access…"}</Text>
      ) : (
        <View>
          {summarize(q.data).map((s, i) => (
            <Text key={i} style={ui.subtitle}>
              {s}
            </Text>
          ))}
          <Action
            title={
              reviewed === basis
                ? "✓ File and audience reviewed"
                : "I reviewed these fields and the external audience"
            }
            selected={reviewed === basis}
            disabled={busy}
            onPress={() => setReviewed(reviewed === basis ? "" : basis)}
          />
          <Action
            title="Share reviewed file"
            primary
            disabled={!basis || reviewed !== basis || busy}
            onPress={() => void share()}
          />
        </View>
      )}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
    </Sheet>
  );
}
