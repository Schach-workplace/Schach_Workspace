import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  FlatList,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { client, NativeApiError } from "./client";
import {
  Page,
  useWorkspace,
  type Message,
  type Conversation,
} from "./Workspace";
import { Action, PersonAvatar, Sheet, ui } from "./ConnectUI";
import { conversationName, SearchSheet } from "./ConnectList";
import NativeComposer from "./NativeComposer";
import { ConversationHistory } from "./conversationSync";
import {
  clearConversationDrafts,
  clearDraftSources,
  readDraft,
  writeDraft,
  readHistoryPosition,
  writeHistoryPosition,
} from "./conversationDrafts";
import Media from "./Media";
import Publication from "./Publication";
import LinkedWork from "./LinkedWork";
import Structured from "./Structured";
import ChatControls, { type Member } from "./ChatControls";
export default function NativeConversation() {
  const w = useWorkspace();
  const root = `/companies/${w.company}/conversations/${w.selected}`;
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [reply, setReply] = useState<Message | null>(null);
  const [actions, setActions] = useState<Message | null>(null);
  const [controls, setControls] = useState<Message | null>(null);
  const [settings, setSettings] = useState(false);
  const [search, setSearch] = useState(false);
  const [publication, setPublication] = useState<Message | null>(null);
  const [recordSource, setRecordSource] = useState<Message | null>(null);
  const [records, setRecords] = useState(false);
  const [sourceEpoch, setSourceEpoch] = useState(0);
  const [showMentions, setShowMentions] = useState(false);
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
    historyFromSequence: number;
    revisions: Map<string, number>;
  } | null>(null);
  const historyView = useRef<FlatList<Message>>(null);
  const [newCount, setNewCount] = useState(0);
  const lastSequence = useRef(0);
  const viewed = useRef(0);
  const readSent = useRef(0);
  const { messageId: target } = useLocalSearchParams<{ messageId?: string }>();
  const draftScope = useMemo(
    () => ({
      serverOrigin: client.endpoint,
      companyId: w.company,
      userId: w.session?.user.id ?? "",
      conversationId: w.selected,
    }),
    [w.company, w.session?.user.id, w.selected],
  );
  function chooseReply(message: Message | null) {
    writeDraft(draftScope, { replyToId: message?.id ?? "" });
    setReply(message);
  }
  const engine = useRef<ConversationHistory<Message> | null>(null);
  const historyLane = useRef<Promise<void> | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);
  const atBottom = useRef(false);
  const first = useRef(true);
  const restorePosition = useRef(true);
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
  function resetSources(ids: string[]) {
    clearDraftSources(w.company, w.session?.user.id ?? "", w.selected, ids);
    if (ids.length) setSourceEpoch((n) => n + 1);
    const affected = (m: Message | null) => m && ids.includes(m.id);
    if (affected(reply)) setReply(null);
    if (affected(actions)) setActions(null);
    if (affected(controls)) setControls(null);
    if (affected(publication)) setPublication(null);
    if (affected(recordSource)) setRecordSource(null);
    if (
      affected(thread?.root ?? null) ||
      thread?.messages.some((m) => ids.includes(m.id))
    )
      setThread(null);
  }
  const callbacks = useRef({ resetSources, acknowledge });
  useLayoutEffect(() => {
    callbacks.current = { resetSources, acknowledge };
  });
  async function updateHistory() {
    if (!w.selected || !w.foreground) return;
    const meta = await client.request<{
      conversation: Conversation;
      members: Member[];
    }>(root);
    if (!alive.current) return;
    const me = meta.members.find((m) => m.userId === w.session?.user.id),
      old = known.current;
    if (
      old &&
      (old.epoch !== (me?.epoch ?? 0) ||
        old.role !== (me?.role ?? "") ||
        old.version !== meta.conversation.version ||
        old.historyFromSequence !== (me?.historyFromSequence ?? 0))
    ) {
      clearConversationDrafts(w.company, w.session?.user.id ?? "", w.selected);
      engine.current?.dispose();
      engine.current = null;
      setMessages([]);
      setConversation(null);
      w.invalidatePrivateViews();
      return;
    }
    const policyKey = JSON.stringify([
      meta.conversation.version,
      me?.epoch,
      me?.role,
      me?.historyFromSequence,
    ]);
    const saved = readHistoryPosition(draftScope);
    if (saved?.policyKey && saved.policyKey !== policyKey)
      clearConversationDrafts(w.company, w.session?.user.id ?? "", w.selected);
    writeHistoryPosition(draftScope, { policyKey });
    known.current = {
      epoch: me?.epoch ?? 0,
      role: me?.role ?? "",
      version: meta.conversation.version,
      historyFromSequence: me?.historyFromSequence ?? 0,
      revisions: new Map(),
    };
    let h = engine.current;
    if (!h) {
      h = new ConversationHistory<Message>(
        (path) => client.request(root + path),
        (ids) => {
          if (!alive.current) return;
          callbacks.current.resetSources(ids);
          const latest = h!.messages.at(-1)?.sequence ?? 0;
          if (
            lastSequence.current > 0 &&
            !atBottom.current &&
            latest > lastSequence.current
          )
            setNewCount((n) => n + latest - lastSequence.current);
          lastSequence.current = latest;
          setMessages([...h!.messages]);
          setHasMore(h!.hasMore);
          writeHistoryPosition(draftScope, {
            oldestSequence: h!.messages[0]?.sequence ?? Infinity,
          });
          const replyId = readDraft(draftScope).replyToId;
          const restored = h!.messages.find(
            (m) => m.id === replyId && !m.removed,
          );
          if (restored) setReply(restored);
        },
      );
      const restoreOldest = readHistoryPosition(draftScope)?.oldestSequence;
      engine.current = h;
      await h.bootstrap();
      if (restoreOldest && restoreOldest < (h.messages[0]?.sequence ?? 0))
        await h.reconcileLoadedRange(restoreOldest);
    } else await h.sync();
    if (!alive.current) return;
    setConversation(meta.conversation);
    setMembers(meta.members);
    setError("");
  }
  function history() {
    if (historyLane.current) return historyLane.current;
    const p = updateHistory();
    historyLane.current = p;
    void p
      .finally(() => {
        if (historyLane.current === p) historyLane.current = null;
      })
      .catch(() => {});
    return p;
  }
  function clear(e: Error) {
    if (!alive.current) return;
    if (
      e instanceof NativeApiError &&
      e.status === 409 &&
      e.code === "refetch_required"
    ) {
      clearConversationDrafts(w.company, w.session?.user.id ?? "", w.selected);
      engine.current?.dispose();
      engine.current = null;
      setConversation(null);
      setMessages([]);
      w.invalidatePrivateViews();
    }
    setError(e.message);
  }
  const reload = useEffectEvent(() => void history().catch(clear));
  const clearEvent = useEffectEvent(clear);
  useEffect(() => {
    if (!w.foreground || !w.selected) return;
    let disposed = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    void Promise.resolve().then(() => reload());
    const timer = setInterval(() => reload(), 15000);
    const connect = () => {
      if (disposed || !client.endpoint || !client.token) return;
      const url = new URL(client.endpoint);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "/api" + root + "/stream";
      const NativeSocket = WebSocket as unknown as {
        new (
          url: string,
          protocols?: string[],
          options?: { headers: Record<string, string> },
        ): WebSocket;
      };
      socket =
        Platform.OS === "web"
          ? new WebSocket(url.href)
          : new NativeSocket(url.href, undefined, {
              headers: { Authorization: "Bearer " + client.token },
            });
      let lastHint = 0;
      socket.onmessage = (e) => {
        if (disposed) return;
        try {
          const hint = JSON.parse(String(e.data));
          if (
            hint.conversationId !== w.selected ||
            !["ready", "changed", "refetch_required"].includes(hint.kind)
          )
            return;
          if (hint.kind === "changed") {
            if (
              !Number.isSafeInteger(hint.eventSequence) ||
              hint.eventSequence <= lastHint
            )
              return;
            lastHint = hint.eventSequence;
          }
          if (hint.kind === "refetch_required") {
            setMessages([]);
            setConversation(null);
            void engine.current
              ?.reconcileLoadedRange()
              .then(() => reload())
              .catch(clearEvent);
          } else reload();
        } catch {}
      };
      socket.onclose = (e) => {
        if (disposed) return;
        if (e.code === 1008) {
          setMessages([]);
          setConversation(null);
          void engine.current
            ?.reconcileLoadedRange()
            .then(() => reload())
            .catch(clearEvent);
        }
        retry = setTimeout(connect, 2000);
      };
      socket.onerror = () => socket?.close();
    };
    if (typeof WebSocket !== "undefined") connect();
    return () => {
      disposed = true;
      clearInterval(timer);
      if (retry) clearTimeout(retry);
      socket?.close();
      if (engine.current?.messages.length)
        writeHistoryPosition(draftScope, {
          oldestSequence: engine.current.messages[0].sequence,
        });
      engine.current?.dispose();
      engine.current = null;
    };
  }, [root, w.foreground, w.selected, draftScope]);
  async function older() {
    if (olderBusy) return;
    setOlderBusy(true);
    try {
      await engine.current?.older();
    } finally {
      if (alive.current) setOlderBusy(false);
    }
  }
  async function acknowledge() {
    if (
      !alive.current ||
      !w.foreground ||
      !atBottom.current ||
      viewed.current <= Math.max(readSent.current, mine?.readSequence ?? 0)
    )
      return;
    const sequence = viewed.current;
    readSent.current = sequence;
    try {
      await client.request(root + "/read", "POST", { sequence });
    } catch (e) {
      readSent.current = mine?.readSequence ?? 0;
      clear(e as Error);
    }
  }
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { item: Message }[] }) => {
      viewed.current = Math.max(
        0,
        ...viewableItems.map((v) => v.item.sequence),
      );
      const first = viewableItems[0]?.item;
      if (first && !restorePosition.current)
        writeHistoryPosition(draftScope, { anchorId: first.id });
      void callbacks.current.acknowledge();
    },
    [draftScope],
  );
  const openTarget = useEffectEvent(() => {
    if (!target || !conversation) return;
    const index = messages.findIndex((m) => m.id === target);
    if (index >= 0) {
      historyView.current?.scrollToIndex({ index, viewPosition: 0.5 });
      atBottom.current = false;
    } else
      void client
        .request<{ root: Message; messages: Message[] }>(
          root + "/messages/" + encodeURIComponent(target) + "/thread",
        )
        .then((v) => {
          if (alive.current) setThread(v);
        })
        .catch(clear);
  });
  useEffect(() => {
    openTarget();
  }, [target, conversation?.id]);
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
  function openOther(id: string, messageId?: string) {
    w.select(id);
    router.replace({
      pathname: "/chat/[id]",
      params: { id, company: w.company, messageId },
    });
  }
  return (
    <Page scroll={false} safeBottom>
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
        <FlatList<Message>
          ref={historyView}
          data={messages}
          keyExtractor={(m) => m.id}
          style={ui.history}
          contentContainerStyle={ui.historyBody}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          keyboardShouldPersistTaps="handled"
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          onViewableItemsChanged={onViewableItemsChanged}
          onScroll={(e) => {
            const s = e.nativeEvent;
            atBottom.current =
              s.contentSize.height -
                s.contentOffset.y -
                s.layoutMeasurement.height <
              70;
            if (!restorePosition.current)
              writeHistoryPosition(draftScope, {
                atBottom: atBottom.current,
                offset: s.contentOffset.y,
              });
            if (atBottom.current) {
              setNewCount(0);
              void acknowledge();
            }
          }}
          scrollEventThrottle={16}
          onContentSizeChange={() => {
            const p = readHistoryPosition(draftScope);
            if (
              restorePosition.current &&
              p?.anchorId &&
              p.atBottom === false
            ) {
              const index = messages.findIndex((m) => m.id === p.anchorId);
              if (index < 0) return;
              restorePosition.current = false;
              first.current = false;
              atBottom.current = false;
              historyView.current?.scrollToOffset({
                offset: p.offset ?? 0,
                animated: false,
              });
              return;
            }
            restorePosition.current = false;
            if (first.current || atBottom.current) {
              historyView.current?.scrollToEnd({ animated: false });
              first.current = false;
            }
          }}
          onScrollToIndexFailed={(info) => {
            historyView.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: false,
            });
            setTimeout(() => {
              if (alive.current)
                historyView.current?.scrollToIndex({
                  index: info.index,
                  viewPosition: 0.5,
                });
            }, 200);
          }}
          ListHeaderComponent={
            <View>
              {" "}
              {hasMore && (
                <Action
                  title={
                    olderBusy
                      ? "Loading older messages…"
                      : "Load older messages"
                  }
                  disabled={olderBusy}
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
            </View>
          }
          renderItem={({ item: m, index }) => {
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
                          onPress={() => chooseReply(m)}
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
          }}
        />
        {!!newCount && (
          <Action
            title={newCount + " new messages"}
            onPress={() => {
              atBottom.current = true;
              setNewCount(0);
              historyView.current?.scrollToEnd({ animated: true });
            }}
          />
        )}
        <Action
          title="Mentions in loaded history"
          onPress={() => setShowMentions(true)}
        />

        {conversation &&
          (disabled ? (
            <Text style={[ui.subtitle, ui.composer]}>
              {conversation.archived
                ? "This conversation is archived. Reopen it in details to send messages."
                : "You have read-only access."}
            </Text>
          ) : (
            <NativeComposer
              scope={draftScope}
              disabled={disabled}
              reply={reply}
              onClearReply={() => chooseReply(null)}
              members={members}
              names={names}
              canMentionAll={["owner", "moderator"].includes(mine?.role ?? "")}
              onMedia={() => setMedia(true)}
              onSend={async (input) => {
                const result = await client.request<{ message: Message }>(
                  root + "/messages",
                  "POST",
                  input,
                );
                await engine.current?.merge([result.message]);
                await history();
              }}
            />
          ))}
      </KeyboardAvoidingView>
      {showMentions && (
        <Sheet
          title="Mentions in loaded history"
          scroll={false}
          onClose={() => setShowMentions(false)}
        >
          <Text>Only currently loaded history is included.</Text>
          <FlatList
            data={messages.filter(
              (m) =>
                !m.removed &&
                (m.mentionAll ||
                  m.mentionIds?.includes(w.session?.user.id ?? "")),
            )}
            keyExtractor={(m) => m.id}
            ListEmptyComponent={<Text>No mentions in loaded history.</Text>}
            renderItem={({ item: m }) => (
              <Action
                title={(m.mentionAll ? "@all · " : "") + m.body.slice(0, 100)}
                onPress={() => {
                  setShowMentions(false);
                  openOther(w.selected, m.id);
                }}
              />
            )}
          />
          {hasMore && (
            <Action
              title="Load older mentions"
              disabled={olderBusy}
              onPress={() => void older().catch(clear)}
            />
          )}
        </Sheet>
      )}
      {settings && conversation && (
        <Sheet title="Conversation details" onClose={() => setSettings(false)}>
          <LinkedWork
            key={sourceEpoch}
            conversation={w.selected}
            onSource={(id) => {
              setSettings(false);
              openOther(w.selected, id);
            }}
          />
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
          keyboard
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
        <Sheet
          keyboard
          scroll={false}
          title="Thread"
          onClose={() => setThread(null)}
        >
          <Text style={ui.quote}>{thread.root.body}</Text>
          <FlatList
            data={thread.messages}
            keyExtractor={(m) => m.id}
            ListEmptyComponent={
              <Text>No replies yet. Keep this discussion together.</Text>
            }
            renderItem={({ item: m }) => (
              <View style={ui.bubble}>
                <Text style={ui.name}>
                  {names[m.senderId] ?? "Company member"}
                </Text>
                <Text style={ui.body}>
                  {m.removed ? "Message removed" : m.body}
                </Text>
              </View>
            )}
          />
          <NativeComposer
            scope={{ ...draftScope, threadRootId: thread.root.id }}
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
              chooseReply(actions);
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
