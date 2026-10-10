import {
  useState,
  useId,
  useSyncExternalStore,
  useRef,
  useEffect,
} from "react";
import {
  readDraft,
  writeDraft,
  subscribeDraft,
  type DraftScope,
} from "./conversationDrafts";
import { FlatList, Text, TextInput, View } from "react-native";
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
  scope: providedScope,
  disabled,
  reply,
  onClearReply,
  onSend,
  members,
  names,
  canMentionAll,
  onMedia,
}: {
  scope?: DraftScope;
  disabled: boolean;
  reply: Message | null;
  onClearReply?: () => void;
  onSend: (input: Input) => Promise<unknown>;
  members: Member[];
  names: Record<string, string>;
  canMentionAll: boolean;
  onMedia?: () => void;
}) {
  const id = useId();
  const scope = providedScope ?? {
    serverOrigin: "local",
    companyId: "",
    userId: "",
    conversationId: id,
  };
  const state = useSyncExternalStore(subscribeDraft, () => readDraft(scope));
  const {
    body: draft,
    mentionIds: mentions,
    mentionAll: all,
    pendingPayload: pending,
    busy,
    error,
  } = state;
  const setDraft = (body: string) => writeDraft(scope, { body });
  const setMentions = (fn: (ids: string[]) => string[]) =>
    writeDraft(scope, { mentionIds: fn(readDraft(scope).mentionIds) });
  const setAll = (fn: (v: boolean) => boolean) =>
    writeDraft(scope, { mentionAll: fn(readDraft(scope).mentionAll) });
  const [showMentions, setShowMentions] = useState(false);
  const [query, setQuery] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function send() {
    if (disabled || readDraft(scope).busy || !draft.trim()) return;
    const input = Object.freeze({
      ...(pending ?? {
        body: draft,
        clientMessageId: Crypto.randomUUID(),
        replyToId: reply?.id ?? scope.threadRootId ?? "",
        mentionIds: mentions,
        mentionAll: all,
      }),
      mentionIds: [...mentions],
    });
    // A retry uses its original selection even if directory input changed.
    const frozen = pending ?? input;
    writeDraft(scope, {
      pendingPayload: frozen,
      replyToId: frozen.replyToId,
      busy: true,
      error: "",
    });
    try {
      await onSend(frozen as Input);
      if (readDraft(scope).pendingPayload !== frozen) return;
      writeDraft(scope, {
        body: "",
        pendingPayload: null,
        mentionIds: [],
        mentionAll: false,
        replyToId: "",
        error: "",
        busy: false,
      });
      if (alive.current) onClearReply?.();
    } catch (e) {
      if (readDraft(scope).pendingPayload === frozen)
        writeDraft(scope, { error: (e as Error).message, busy: false });
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
          {error}
          {pending && " Your message is waiting for confirmation."}
        </Text>
      )}
      {pending && !busy && (
        <Action
          title="Return to draft"
          onPress={() => {
            writeDraft(scope, { pendingPayload: null, error: "" });
          }}
        />
      )}
      {showMentions && (
        <Sheet
          scroll={false}
          keyboard
          title="Mention participants"
          onClose={() => setShowMentions(false)}
        >
          <TextInput
            accessibilityLabel="Find participant"
            value={query}
            onChangeText={setQuery}
            style={ui.input}
          />
          <Text>
            Selected:{" "}
            {mentions.map((id) => names[id] ?? "Company member").join(", ") ||
              "None"}
          </Text>
          <FlatList
            data={members.filter(
              (m) =>
                m.active &&
                (names[m.userId] ?? "Company member")
                  .toLowerCase()
                  .includes(query.toLowerCase()),
            )}
            keyExtractor={(m) => m.userId}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: m }) => (
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
            )}
          />
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
