import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { Action, Sheet, ui } from "./ConnectUI";
import { useWorkspace } from "./Workspace";
import { useExecutionGuard, useExecutionRead } from "./execution";
import { agendaPath, type AgendaView } from "./deadlineAgenda";
import { client } from "./client";
import { calendarExport } from "../../shared/integrations/calendar";
import { shareDocument } from "./shareDocument";
export default function CalendarExport({
  from,
  to,
  onClose,
}: {
  from: string;
  to: string;
  onClose: () => void;
}) {
  const w = useWorkspace(),
    path = agendaPath(from, to);
  const q = useExecutionRead<AgendaView>(path),
    guard = useExecutionGuard(path);
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  const ready = q.ready && q.data?.complete === true;
  const basis = ready ? JSON.stringify(q.data!.tasks) : "";
  const [reviewed, setReviewed] = useState("");
  const consent = confirmed && reviewed === basis && !!basis;
  async function share() {
    if (pending.current || !consent || !ready || !w.foreground || !w.work)
      return;
    const current = guard();
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const fresh = await client.request<AgendaView>(
        `/companies/${w.company}${path}`,
      );
      if (!current()) return;
      if (!fresh.complete || JSON.stringify(fresh.tasks) !== basis) {
        setConfirmed(false);
        setReviewed("");
        q.retry();
        throw Error(
          "Calendar changed. Review the refreshed export before sharing.",
        );
      }
      const text = calendarExport(w.company, fresh.tasks);
      await shareDocument(`workspace-deadlines-${from}.ics`, text, current);
      if (current()) onClose();
    } catch (e) {
      if (current()) setError((e as Error).message);
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  }
  return (
    <Sheet title="Calendar export" onClose={onClose} busy={busy}>
      <Text style={ui.title}>
        {from} – {to}
      </Text>
      <Text style={ui.body}>
        Export titles and deadlines for currently authorized open work. Calendar
        copies can be shared outside Workspace and cannot be revoked after
        export. No messages, evidence, attendees or financial details are
        included.
      </Text>
      {!ready ? (
        <Text>{q.error || "Checking complete current calendar…"}</Text>
      ) : (
        <View>
          <Text style={ui.name}>
            {q.data!.tasks.length} deadlines · {q.data!.timezone}
          </Text>
          {q.data!.tasks.slice(0, 20).map((t) => (
            <Text key={t.id} style={ui.subtitle}>
              {t.title}
            </Text>
          ))}
          {q.data!.tasks.length > 20 && (
            <Text style={ui.subtitle}>
              Plus {q.data!.tasks.length - 20} more deadlines in this range.
            </Text>
          )}
          <Action
            title={
              consent
                ? "✓ Export audience reviewed"
                : "I reviewed the export fields and external audience"
            }
            selected={consent}
            disabled={busy}
            onPress={() => {
              setReviewed(basis);
              setConfirmed(!consent);
            }}
          />
          <Action
            title="Share calendar file"
            primary
            disabled={!consent || busy}
            onPress={() => void share()}
          />
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={ui.error}>
          {error}
        </Text>
      )}
    </Sheet>
  );
}
