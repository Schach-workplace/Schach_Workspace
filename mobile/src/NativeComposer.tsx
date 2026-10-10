import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { Action, Sheet, ui } from "./ConnectUI";
import type { Member } from "./ChatControls";
import type { Message } from "./Workspace";
interface Input {
  body: string;
  clientMessageId: string;
  replyToId: string;
  mentionIds: string[];
  mentionAll: boolean;
}
export default function NativeComposer({
  disabled,
  reply,
  onClearReply,
  onSend,
  members,
  names,
  canMentionAll,
  onMedia,
}: {
  disabled: boolean;
  reply: Message | null;
  onClearReply?: () => void;
  onSend: (input: Input) => Promise<unknown>;
  members: Member[];
  names: Record<string, string>;
  canMentionAll: boolean;
  onMedia?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Input | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  async function send() {
    if (disabled || busy || !draft.trim()) return;
    const input = pending ?? {
      body: draft,
      clientMessageId: Crypto.randomUUID(),
      replyToId: reply?.id ?? "",
      mentionIds: mentions,
      mentionAll: all,
    };
    setPending(input);
    setBusy(true);
    setError("");
    try {
      await onSend(input);
      setPending(null);
      setDraft("");
      onClearReply?.();
      setMentions([]);
      setAll(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={ui.composer}>
      {reply && (
        <View style={ui.quote}>
          <Text numberOfLines={2} style={ui.subtitle}>
            Reply to {reply.body}
          </Text>
          {onClearReply && (
            <Action
              title="Cancel reply"
              disabled={!!pending || busy}
              onPress={onClearReply}
            />
          )}
        </View>
      )}
      <TextInput
        accessibilityLabel="Message"
        placeholder={disabled ? "Read-only conversation" : "Write a message…"}
        multiline
        maxLength={20000}
        style={[ui.input, { minHeight: 48, maxHeight: 120 }]}
        editable={!disabled && !pending && !busy}
        value={draft}
        onChangeText={setDraft}
      />
      <View style={[ui.row, { justifyContent: "space-between" }]}>
        <View style={ui.row}>
          {onMedia && (
            <Action
              title="＋ Media"
              disabled={disabled || busy}
              onPress={onMedia}
            />
          )}
          <Action
            title={mentions.length || all ? "@ Mentions ✓" : "@ Mention"}
            disabled={disabled || !!pending || busy}
            onPress={() => setShowMentions(true)}
          />
        </View>
        <Action
          primary
          title={busy ? "Sending…" : pending ? "Retry same message" : "Send"}
          disabled={disabled || busy || !draft.trim()}
          onPress={() => void send()}
        />
      </View>
      {error && (
        <Text accessibilityRole="alert" style={ui.error}>
          {error} Your message is waiting for confirmation.
        </Text>
      )}
      {pending && !busy && (
        <Action
          title="Return to draft"
          onPress={() => {
            setPending(null);
            setError("");
          }}
        />
      )}
      {showMentions && (
        <Sheet
          title="Mention participants"
          onClose={() => setShowMentions(false)}
        >
          {members.map((m) => (
            <Action
              key={m.userId}
              title={names[m.userId] ?? "Company member"}
              selected={mentions.includes(m.userId)}
              onPress={() =>
                setMentions((ids) =>
                  ids.includes(m.userId)
                    ? ids.filter((id) => id !== m.userId)
                    : [...ids, m.userId],
                )
              }
            />
          ))}
          {canMentionAll && (
            <>
              <Action
                title="Mention everyone"
                selected={all}
                onPress={() => setAll((v) => !v)}
              />
              <Text style={ui.subtitle}>Limited to once per five minutes.</Text>
            </>
          )}
          <Action primary title="Done" onPress={() => setShowMentions(false)} />
        </Sheet>
      )}
    </View>
  );
}
