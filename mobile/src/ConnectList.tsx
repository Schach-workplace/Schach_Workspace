import { connectStyle } from "./ConnectPresentation";
import { useEffect, useEffectEvent, useState, useRef } from "react";
import {
  FlatList,
  RefreshControl,
  Text,
  TextInput,
  View,
  Pressable,
} from "react-native";
import { router } from "expo-router";
import { client } from "./client";
import { Page, useWorkspace, type Conversation } from "./Workspace";
import { Action, PersonAvatar, Sheet, ui } from "./ConnectUI";
export function conversationName(
  c: Conversation,
  people: { id: string; name: string }[],
) {
  return c.kind === "dm"
    ? (people.find((p) => p.id === c.peerId)?.name ?? "Direct message")
    : c.title;
}
export default function ConnectList() {
  const w = useWorkspace();
  return (
    <List
      key={
        w.company +
        ":" +
        w.session?.user.id +
        ":" +
        w.foreground +
        ":" +
        w.policyEpoch
      }
    />
  );
}
function List() {
  const w = useWorkspace();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState(false);
  const [attention, setAttention] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const checkAttention = useEffectEvent(
    () =>
      void client
        .request<{
          conversations: { conversationId: string; unread: number }[];
        }>(`/companies/${w.company}/communication/attention`)
        .then((v) =>
          setAttention(
            Object.fromEntries(
              v.conversations.map((c) => [c.conversationId, c.unread]),
            ),
          ),
        )
        .catch((e) => w.setError(e.message)),
  );
  useEffect(() => {
    if (!w.company || !w.foreground) return;
    void Promise.resolve().then(() => checkAttention());
    const timer = setInterval(() => checkAttention(), 15000);
    return () => clearInterval(timer);
  }, [w.company, w.foreground]);
  // Pull-to-refresh reuses the workspace reload, which re-reads the current
  // company's conversation pages and drops results after a company/session
  // change. This list is keyed by company, so a stale completion never lands.
  async function pullToRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await w.refresh();
    } catch (e) {
      if (alive.current) w.setError((e as Error).message);
    } finally {
      if (alive.current) setRefreshing(false);
    }
  }
  function open(id: string, messageId?: string) {
    w.select(id);
    router.push({
      pathname: "/chat/[id]",
      params: { id, company: w.company, messageId },
    });
  }
  const rows = w.conversations.filter(
    (c) =>
      conversationName(c, w.work?.people ?? [])
        .toLowerCase()
        .includes(q.toLowerCase()) &&
      (filter === "all" ||
        (filter === "unread" && (attention[c.id] ?? 0) > 0) ||
        (filter === "channels" && c.kind === "channel") ||
        (filter === "chats" && c.kind !== "channel")),
  );
  return (
    <Page scroll={false}>
      <FlatList
        ListHeaderComponent={
          <View>
            <View style={ui.header}>
              <View style={connectStyle.heading}>
                <Text style={connectStyle.title}>Connect</Text>
                <Text style={ui.subtitle}>
                  People, teams and company channels
                </Text>
              </View>
              {w.work?.me.role !== "viewer" && (
                <Action title="＋ New" onPress={() => setCreating(true)} />
              )}
            </View>
            <TextInput
              style={[ui.input, connectStyle.search]}
              accessibilityLabel="Filter conversations"
              placeholder="Find a conversation…"
              value={q}
              onChangeText={setQ}
            />
            <View style={connectStyle.filters}>
              {[
                ["all", "All"],
                ["unread", "Unread"],
                ["chats", "Chats"],
                ["channels", "Channels"],
              ].map(([key, title]) => (
                <Action
                  key={key}
                  title={title}
                  selected={filter === key}
                  onPress={() => setFilter(key)}
                />
              ))}
            </View>
            <View style={connectStyle.summary}>
              <Text style={connectStyle.sectionTitle}>
                {filter === "unread"
                  ? "Unread conversations"
                  : q
                    ? "Search results"
                    : "Conversations"}{" "}
                · {rows.length}
              </Text>
              <Text style={connectStyle.support}>
                {Object.values(attention).filter((n) => n > 0).length} with
                unread messages
              </Text>
            </View>
          </View>
        }
        data={rows}
        keyExtractor={(c) => c.id}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} />
        }
        renderItem={({ item: c }) => (
          <Pressable
            key={c.id}
            accessibilityRole="button"
            accessibilityLabel={
              conversationName(c, w.work?.people ?? []) +
              ((attention[c.id] ?? 0) > 0
                ? `, ${attention[c.id]} unread messages`
                : "")
            }
            onPress={() => open(c.id)}
            style={[
              ui.conversation,
              connectStyle.conversation,
              (attention[c.id] ?? 0) > 0 && connectStyle.unread,
            ]}
          >
            <PersonAvatar
              name={
                c.kind === "channel"
                  ? "#"
                  : conversationName(c, w.work?.people ?? [])
              }
            />
            <View style={connectStyle.conversationText}>
              <Text style={ui.name}>
                {conversationName(c, w.work?.people ?? [])}
              </Text>
              <Text style={ui.subtitle}>
                {c.archived
                  ? "Archived"
                  : c.kind === "dm"
                    ? "Direct message"
                    : c.public
                      ? "Company channel"
                      : c.kind === "channel"
                        ? "Private channel"
                        : "Private group"}
              </Text>
            </View>
            {(attention[c.id] ?? 0) > 0 && (
              <Text style={ui.badge}>{attention[c.id]}</Text>
            )}
          </Pressable>
        )}
        ListFooterComponent={
          <View>
            {!rows.length && (
              <View style={ui.empty}>
                <Text style={ui.title}>
                  {q || filter !== "all"
                    ? "No matching conversations"
                    : "Start a conversation"}
                </Text>
                <Text style={ui.subtitle}>
                  {q || filter !== "all"
                    ? "Try another name or show all conversations."
                    : "Message a person or bring your team together."}
                </Text>
                {(q || filter !== "all") && (
                  <Action
                    title="Clear filters"
                    onPress={() => {
                      setQ("");
                      setFilter("all");
                    }}
                  />
                )}
                {w.work?.me.role !== "viewer" && (
                  <Action
                    primary
                    title="Message a person"
                    onPress={() => setCreating(true)}
                  />
                )}
              </View>
            )}
            {w.listMore && (
              <Action
                title="Load more conversations"
                onPress={w.loadMoreConversations}
              />
            )}
            <View style={connectStyle.navigation}>
              <Action
                title="Search & saved messages"
                onPress={() => setSearch(true)}
              />
              {w.work && w.work.me.role !== "member" && (
                <Action
                  title="Overview"
                  onPress={() =>
                    router.push({
                      pathname: "/overview",
                      params: { company: w.company },
                    })
                  }
                />
              )}
              {w.work && (
                <Action
                  title="Workload"
                  onPress={() =>
                    router.push({
                      pathname: "/workload",
                      params: { company: w.company },
                    })
                  }
                />
              )}
            </View>
          </View>
        }
      />
      {creating && (
        <NewChat
          onClose={() => setCreating(false)}
          onOpen={(id) => {
            setCreating(false);
            open(id);
          }}
        />
      )}
      {search && (
        <SearchSheet
          onClose={() => setSearch(false)}
          onOpen={(id, messageId) => {
            setSearch(false);
            open(id, messageId);
          }}
        />
      )}
    </Page>
  );
}
function NewChat({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const w = useWorkspace();
  const [kind, setKind] = useState("dm");
  const [title, setTitle] = useState("");
  const [q, setQ] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [publicChannel, setPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function create(participantIds = ids) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await client.request<{ id: string }>(
        `/companies/${w.company}/conversations`,
        "POST",
        {
          kind,
          ...(kind !== "dm" ? { title: title.trim() } : {}),
          public: kind === "channel" && publicChannel,
          participantIds,
        },
      );
      if (!alive.current) return;
      await w.refresh();
      if (alive.current) onOpen(result.id);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Sheet keyboard busy={busy} title="New conversation" onClose={onClose}>
      <View style={ui.row}>
        {[
          ["dm", "Direct message"],
          ["group", "Group"],
          ["channel", "Channel"],
        ].map(([value, label]) => (
          <Action
            key={value}
            title={label}
            disabled={busy}
            selected={kind === value}
            onPress={() => {
              setKind(value);
              setIds([]);
            }}
          />
        ))}
      </View>
      {kind === "dm" ? (
        <Text style={ui.subtitle}>
          Choose a person. Your existing private chat will open, or a new one
          will start.
        </Text>
      ) : (
        <TextInput
          accessibilityLabel="Conversation name"
          placeholder="Conversation name"
          maxLength={120}
          style={ui.input}
          editable={!busy}
          value={title}
          onChangeText={setTitle}
        />
      )}
      {kind === "channel" && (
        <Action
          title={publicChannel ? "Company channel ✓" : "Private channel"}
          disabled={busy}
          onPress={() => setPublic((v) => !v)}
        />
      )}
      {kind === "channel" && publicChannel && (
        <Text style={ui.subtitle}>
          Every active company member can read retained history.
        </Text>
      )}
      <TextInput
        accessibilityLabel="Find a person"
        placeholder="Find a person…"
        style={ui.input}
        value={q}
        editable={!busy}
        onChangeText={setQ}
      />
      {w.work?.people
        .filter(
          (p) =>
            p.active &&
            p.id !== w.session?.user.id &&
            p.name.toLowerCase().includes(q.toLowerCase()),
        )
        .map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={p.name}
            disabled={busy}
            style={[ui.conversation, ids.includes(p.id) && ui.selected]}
            onPress={() =>
              kind === "dm"
                ? void create([p.id])
                : setIds((old) =>
                    old.includes(p.id)
                      ? old.filter((id) => id !== p.id)
                      : [...old, p.id],
                  )
            }
          >
            <PersonAvatar name={p.name} />
            <View style={{ flex: 1 }}>
              <Text style={ui.name}>{p.name}</Text>
              <Text style={ui.subtitle}>
                {kind === "dm"
                  ? "Open direct message"
                  : ids.includes(p.id)
                    ? "Selected"
                    : "Add to conversation"}
              </Text>
            </View>
          </Pressable>
        ))}
      {error && (
        <Text accessibilityRole="alert" style={ui.error}>
          {error}
        </Text>
      )}
      {busy && <Text style={ui.subtitle}>Opening conversation…</Text>}
      {kind !== "dm" && (
        <Action
          primary
          title="Create conversation"
          disabled={
            busy ||
            !title.trim() ||
            (!(kind === "channel" && publicChannel) && !ids.length)
          }
          onPress={() => void create()}
        />
      )}
    </Sheet>
  );
}
export function SearchSheet({
  onClose,
  onOpen,
  conversation = "",
}: {
  onClose: () => void;
  onOpen: (id: string, messageId?: string) => void;
  conversation?: string;
}) {
  const w = useWorkspace();
  const [q, setQ] = useState("");
  const [path, setPath] = useState("");
  const [rows, setRows] = useState<
    { id: string; body: string; conversationId: string }[]
  >([]);
  const [error, setError] = useState("");
  async function find(value: string) {
    try {
      setPath(value);
      const v = await client.request<{ messages: typeof rows }>(value);
      setRows(v.messages);
      setError("");
    } catch (e) {
      setRows([]);
      setError((e as Error).message);
    }
  }
  const recheck = useEffectEvent(() => {
    if (path) void find(path);
  });
  useEffect(() => {
    if (!path) return;
    const timer = setInterval(() => recheck(), 15000);
    return () => clearInterval(timer);
  }, [path]);
  return (
    <Sheet title="Find messages" onClose={onClose}>
      <Text style={ui.subtitle}>
        Only messages you can currently access are shown.
      </Text>
      <TextInput
        style={ui.input}
        placeholder="Search messages…"
        accessibilityLabel="Search authorized messages"
        value={q}
        onChangeText={setQ}
      />
      <View style={ui.row}>
        <Action
          title="Search"
          disabled={!q.trim()}
          onPress={() =>
            void find(
              `/companies/${w.company}/communication/search?q=${encodeURIComponent(q)}`,
            )
          }
        />
        <Action
          title="Saved & reminders"
          onPress={() =>
            void find(`/companies/${w.company}/communication/saved`)
          }
        />
        {conversation && (
          <Action
            title="Pins"
            onPress={() =>
              void find(
                `/companies/${w.company}/conversations/${conversation}/pins`,
              )
            }
          />
        )}
      </View>
      {rows.map((m) => (
        <Pressable
          key={m.id}
          style={ui.conversation}
          onPress={() => onOpen(m.conversationId, m.id)}
          accessibilityRole="button"
        >
          <Text style={ui.body}>{m.body}</Text>
        </Pressable>
      ))}
      {path && !rows.length && !error && (
        <Text style={ui.subtitle}>No accessible messages.</Text>
      )}
      {error && (
        <Text accessibilityRole="alert" style={ui.error}>
          {error}
        </Text>
      )}
    </Sheet>
  );
}
