import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { client } from "./client";
import {
  Page,
  useWorkspace,
  type Message,
  type Conversation,
} from "./Workspace";
import { Action, PersonAvatar, Sheet, ui } from "./ConnectUI";
import { conversationName, SearchSheet } from "./ConnectList";
import NativeComposer from "./NativeComposer";
import Media from "./Media";
import Publication from "./Publication";
import Structured from "./Structured";
import ChatControls, { type Member } from "./ChatControls";
export default function NativeConversation() {
  const w = useWorkspace();
  const root = `/companies/${w.company}/conversations/${w.selected}`;
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [cursor, setCursor] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [reply, setReply] = useState<Message | null>(null);
  const [actions, setActions] = useState<Message | null>(null);
  const [controls, setControls] = useState<Message | null>(null);
  const [settings, setSettings] = useState(false);
  const [search, setSearch] = useState(false);
  const [publication, setPublication] = useState<Message | null>(null);
  const [recordSource, setRecordSource] = useState<Message | null>(null);
  const [records, setRecords] = useState(false);
  const [media, setMedia] = useState(false);
  const [thread, setThread] = useState<{
    root: Message;
    messages: Message[];
  } | null>(null);
  const [error, setError] = useState("");
  const known = useRef<{
    epoch: number;
    role: string;
    version: number;
    revisions: Map<string, number>;
  } | null>(null);
  const historyView = useRef<ScrollView>(null);
  const atBottom = useRef(true);
  const first = useRef(true);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const mine = members.find((m) => m.userId === w.session?.user.id);
  const disabled =
    !conversation ||
    w.work?.me.role === "viewer" ||
    mine?.role === "viewer" ||
    !!conversation.archived;
  async function history() {
    if (!w.selected || !w.foreground) return;
    const [page, meta] = await Promise.all([
      client.request<{ messages: Message[]; cursor: string; hasMore: boolean }>(
        root + "/messages",
      ),
      client.request<{ conversation: Conversation; members: Member[] }>(root),
    ]);
    if (!alive.current) return;
    const me = meta.members.find((m) => m.userId === w.session?.user.id);
    const old = known.current;
    if (
      old &&
      (old.epoch !== (me?.epoch ?? 0) ||
        old.role !== (me?.role ?? "") ||
        old.version !== meta.conversation.version ||
        page.messages.some(
          (m) =>
            old.revisions.has(m.id) && old.revisions.get(m.id) !== m.revision,
        ))
    ) {
      w.invalidatePrivateViews();
      return;
    }
    known.current = {
      epoch: me?.epoch ?? 0,
      role: me?.role ?? "",
      version: meta.conversation.version,
      revisions: new Map(page.messages.map((m) => [m.id, m.revision])),
    };
    const source =
      publication ??
      recordSource ??
      controls ??
      actions ??
      thread?.root ??
      reply;
    if (source) {
      const checked = await client.request<{
        root: Message;
        messages: Message[];
      }>(root + "/messages/" + source.id + "/thread");
      if (!alive.current) return;
      if (checked.root.removed || checked.root.revision !== source.revision) {
        w.invalidatePrivateViews();
        return;
      }
      if (thread) setThread(checked);
    }
    setConversation(meta.conversation);
    setMessages(page.messages);
    setCursor(page.cursor);
    setHasMore(page.hasMore);
    setMembers(meta.members);
    setError("");
    const last = page.messages.at(-1);
    if (last)
      await client.request(root + "/read", "POST", { sequence: last.sequence });
  }
  // Authorization failures clear Workspace/client generation and unmount this route.
  // A transport failure must preserve the draft and its frozen retry payload.
  function clear(e: Error) {
    if (alive.current) setError(e.message);
  }
  const reload = useEffectEvent(() => void history().catch(clear));
  useEffect(() => {
    if (!w.foreground || !w.selected) return;
    void Promise.resolve().then(() => reload());
    const timer = setInterval(() => reload(), 15000);
    return () => clearInterval(timer);
  }, [root, w.foreground, w.selected]);
  async function older() {
    const page = await client.request<{
      messages: Message[];
      cursor: string;
      hasMore: boolean;
    }>(root + "/messages?cursor=" + encodeURIComponent(cursor));
    if (!alive.current) return;
    setMessages((rows) =>
      Array.from(
        new Map([...page.messages, ...rows].map((m) => [m.id, m])).values(),
      ).sort((a, b) => a.sequence - b.sequence),
    );
    setCursor(page.cursor);
    setHasMore(page.hasMore);
  }
  async function openThread(m: Message) {
    try {
      const result = await client.request<{
        root: Message;
        messages: Message[];
      }>(root + "/messages/" + m.id + "/thread");
      if (alive.current && !result.root.removed) setThread(result);
    } catch (e) {
      clear(e as Error);
    }
  }
  const names = Object.fromEntries(
    (w.work?.people ?? []).map((p) => [p.id, p.name]),
  );
  function openOther(id: string) {
    w.select(id);
    router.replace({
      pathname: "/chat/[id]",
      params: { id, company: w.company },
    });
  }
  return (
    <Page scroll={false}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={ui.header}>
          <Action title="‹ Back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={ui.title} numberOfLines={1}>
              {conversation
                ? conversationName(conversation, w.work?.people ?? [])
                : "Checking access…"}
            </Text>
            <Text style={ui.subtitle}>
              {conversation?.public ? "Company channel" : "Private"} ·{" "}
              {members.length} participants
            </Text>
          </View>
          {conversation && (
            <Action title="Details" onPress={() => setSettings(true)} />
          )}
        </View>
        {conversation && (
          <View style={[ui.row, { justifyContent: "space-between" }]}>
            <Action title="Search & pins" onPress={() => setSearch(true)} />
            <Action title="Records" onPress={() => setRecords(true)} />
            <Action
              title="Audio / video"
              disabled={disabled}
              onPress={() => router.push("/(tabs)/calls")}
            />
          </View>
        )}
        {error && (
          <Text accessibilityRole="alert" style={ui.error}>
            {error}
          </Text>
        )}
        <ScrollView
          ref={historyView}
          style={ui.history}
          contentContainerStyle={ui.historyBody}
          keyboardShouldPersistTaps="handled"
          onScroll={(e) => {
            const s = e.nativeEvent;
            atBottom.current =
              s.contentSize.height -
                s.contentOffset.y -
                s.layoutMeasurement.height <
              70;
          }}
          scrollEventThrottle={16}
          onContentSizeChange={() => {
            if (first.current || atBottom.current) {
              historyView.current?.scrollToEnd({ animated: false });
              first.current = false;
            }
          }}
        >
          {hasMore && (
            <Action
              title="Load older messages"
              onPress={() => void older().catch((e) => setError(e.message))}
            />
          )}{" "}
          {!messages.length && conversation && (
            <View style={ui.empty}>
              <Text style={ui.title}>Start the conversation</Text>
              <Text style={ui.subtitle}>
                {conversation.public
                  ? "Messages are visible to all active company members."
                  : "Messages and files stay with conversation participants."}
              </Text>
            </View>
          )}
          {messages.map((m, index) => {
            const name = names[m.senderId] ?? "Company member";
            const own = m.senderId === w.session?.user.id;
            const previous = messages[index - 1];
            return (
              <View key={m.id}>
                {(!previous ||
                  new Date(previous.createdAt).toDateString() !==
                    new Date(m.createdAt).toDateString()) && (
                  <Text style={ui.day}>
                    {new Date(m.createdAt).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                    })}
                  </Text>
                )}
                <View style={ui.message}>
                  <PersonAvatar name={name} />
                  <View style={{ flex: 1 }}>
                    <View style={ui.row}>
                      <Text style={ui.name}>{own ? "You" : name}</Text>
                      <Text style={ui.metadata}>
                        {new Date(m.createdAt).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {m.revision > 1 && !m.removed ? " · edited" : ""}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        m.removed
                          ? "Message removed"
                          : `Message from ${name}. Hold for actions.`
                      }
                      disabled={m.removed}
                      onLongPress={() => setActions(m)}
                      style={[ui.bubble, own && ui.ownBubble]}
                    >
                      {m.replyToId && (
                        <Text style={ui.subtitle}>↳ In a thread</Text>
                      )}
                      <Text style={ui.body}>
                        {m.removed ? "Message removed" : m.body}
                      </Text>
                    </Pressable>
                    {!m.removed && (
                      <View style={ui.row}>
                        <Action
                          title="Reply"
                          disabled={disabled}
                          onPress={() => setReply(m)}
                        />
                        <Action
                          title="Thread"
                          onPress={() => void openThread(m)}
                        />
                        <Action title="More" onPress={() => setActions(m)} />
                      </View>
                    )}
                    {!m.removed &&
                      m.mediaIds?.map((id) => (
                        <Action
                          key={id}
                          title="Download attachment"
                          onPress={() =>
                            void Media.download(
                              w.company,
                              w.selected,
                              id,
                            ).catch((e) => setError(e.message))
                          }
                        />
                      ))}
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>
        {conversation &&
          (disabled ? (
            <Text style={[ui.subtitle, ui.composer]}>
              {conversation.archived
                ? "This conversation is archived. Reopen it in details to send messages."
                : "You have read-only access."}
            </Text>
          ) : (
            <NativeComposer
              disabled={disabled}
              reply={reply}
              onClearReply={() => setReply(null)}
              members={members}
              names={names}
              canMentionAll={["owner", "moderator"].includes(mine?.role ?? "")}
              onMedia={() => setMedia(true)}
              onSend={async (input) => {
                await client.request(root + "/messages", "POST", input);
                await history();
              }}
            />
          ))}
      </KeyboardAvoidingView>
      {settings && conversation && (
        <Sheet title="Conversation details" onClose={() => setSettings(false)}>
          <ChatControls
            conversation={conversation}
            members={members}
            message={null}
            onRefresh={async () => {
              await w.refresh();
              await history();
            }}
            onClose={() => setSettings(false)}
          />
        </Sheet>
      )}
      {search && (
        <SearchSheet
          conversation={w.selected}
          onClose={() => setSearch(false)}
          onOpen={openOther}
        />
      )}
      {media && (
        <Sheet
          title="Attachments & voice notes"
          onClose={() => setMedia(false)}
        >
          <Media
            company={w.company}
            conversation={w.selected}
            disabled={disabled}
            onSent={history}
          />
        </Sheet>
      )}
      {(records || recordSource) && (
        <Sheet
          title="Conversation records"
          onClose={() => {
            setRecords(false);
            setRecordSource(null);
          }}
        >
          <Structured
            source={recordSource}
            onClose={() => {
              setRecords(false);
              setRecordSource(null);
            }}
          />
        </Sheet>
      )}
      {publication && conversation && (
        <Sheet
          title="Publish selected message"
          onClose={() => setPublication(null)}
        >
          <Publication
            conversation={conversation}
            source={publication}
            onClose={() => setPublication(null)}
          />
        </Sheet>
      )}
      {controls && conversation && (
        <Sheet
          title="Edit, reaction & reminder"
          onClose={() => setControls(null)}
        >
          <ChatControls
            conversation={conversation}
            members={members}
            message={controls}
            onRefresh={history}
            onClose={() => setControls(null)}
          />
        </Sheet>
      )}
      {thread && (
        <Sheet title="Thread" onClose={() => setThread(null)}>
          <Text style={ui.quote}>{thread.root.body}</Text>
          {thread.messages.map((m) => (
            <View style={ui.bubble} key={m.id}>
              <Text style={ui.name}>
                {names[m.senderId] ?? "Company member"}
              </Text>
              <Text style={ui.body}>
                {m.removed ? "Message removed" : m.body}
              </Text>
            </View>
          ))}
          {!thread.messages.length && (
            <Text style={ui.subtitle}>
              No replies yet. Keep this discussion together.
            </Text>
          )}
          <NativeComposer
            disabled={disabled}
            reply={thread.root}
            members={members}
            names={names}
            canMentionAll={["owner", "moderator"].includes(mine?.role ?? "")}
            onSend={async (input) => {
              await client.request(root + "/messages", "POST", input);
              await history();
            }}
          />
        </Sheet>
      )}
      {actions && (
        <Sheet title="Message actions" onClose={() => setActions(null)}>
          <Text style={ui.quote} numberOfLines={4}>
            {actions.body}
          </Text>
          <Action
            title="Reply"
            disabled={disabled}
            onPress={() => {
              setReply(actions);
              setActions(null);
            }}
          />
          <Action
            title="Open thread"
            onPress={() => {
              void openThread(actions);
              setActions(null);
            }}
          />
          <Action
            title="Save privately"
            onPress={() => {
              void client
                .request(root + "/messages/" + actions.id + "/save", "POST", {
                  saved: true,
                })
                .catch((e) => setError(e.message));
              setActions(null);
            }}
          />
          <Action
            title="Edit, reaction & reminder"
            onPress={() => {
              setControls(actions);
              setActions(null);
            }}
          />
          <Action
            title="Request acknowledgement / poll / decision"
            disabled={disabled}
            onPress={() => {
              setRecordSource(actions);
              setActions(null);
            }}
          />
          <Action
            title="Publish task / request / expense draft"
            disabled={disabled || conversation?.forwarding !== "selected"}
            onPress={() => {
              setPublication(actions);
              setActions(null);
            }}
          />
          {conversation?.forwarding === "deny" && (
            <Text style={ui.subtitle}>
              This conversation does not allow work publication.
            </Text>
          )}
        </Sheet>
      )}
    </Page>
  );
}
