import { useEffect, useRef, useState, useEffectEvent } from "react";
import { Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { client, NativeApiError } from "./client";
import { useWorkspace, styles } from "./Workspace";
import { Action, Sheet } from "./ConnectUI";
import PersonPicker from "./PersonPicker";
import DeadlinePicker from "./DeadlinePicker";
import { useRamInput } from "./ramInput";
import { workDeadline, DeadlineChoiceError } from "./workDates";
import {
  attentionIntent,
  type AttentionView,
  type AttentionTransitionInput,
} from "../../shared/attention/types";
type Draft = {
  reason: string;
  recipientId: string;
  date: string;
  time: string;
  instant: string;
  reviewed: boolean;
  reviewVersion: number;
  attempt: AttentionTransitionInput | null;
};
const empty = (): Draft => ({
  reason: "",
  recipientId: "",
  date: "",
  time: "",
  instant: "",
  reviewed: false,
  reviewVersion: 0,
  attempt: null,
});
export default function AttentionInbox({
  sourceTaskId,
}: { sourceTaskId?: string } = {}) {
  const w = useWorkspace();
  const [tab, setTab] = useState("actions");
  const [state, setState] = useState("open");
  const [decisions, setDecisions] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [selected, setSelected] = useState<{
    id: string;
    action: AttentionTransitionInput["action"];
  } | null>(null);
  const scope = [
    sourceTaskId,
    w.company,
    w.session?.user.id,
    w.work?.readBasis,
    w.attentionEpoch,
    w.recordEpoch,
    w.foreground,
    state,
    decisions,
    epoch,
  ].join(":");
  const [loaded, setLoaded] = useState<{
    scope: string;
    items: AttentionView[];
  } | null>(null);
  const [error, setError] = useState("");
  const [cached, , purgeSelected] = useRamInput(
    "$attention:" + (selected?.id ?? ""),
    selected?.action ?? "",
    empty,
  );
  const purgeGone = useEffectEvent(() => {
    purgeSelected(cached);
    setSelected(null);
  });
  useEffect(() => {
    let active = true;
    const generation = client.generation;
    if (!w.foreground || !w.company) return;
    (async () => {
      await Promise.resolve();
      if (!active) return;
      setError("");
      let cursor = "";
      const items: AttentionView[] = [];
      const seen = new Set<string>();
      do {
        const params = new URLSearchParams({
          state,
          decisionsOnly: String(decisions),
          limit: "100",
        });
        if (sourceTaskId) {
          params.set("sourceKind", "task");
          params.set("sourceId", sourceTaskId);
          params.set("kind", "blocker");
          params.set("state", "open");
          params.set("decisionsOnly", "false");
        }
        if (cursor) params.set("cursor", cursor);
        const v = await client.request<{
          items: AttentionView[];
          hasMore: boolean;
          cursor: string;
        }>(`/companies/${w.company}/attention?${params}`);
        if (!active || generation !== client.generation) return;
        items.push(...v.items);
        if (!v.hasMore) break;
        if (!v.cursor || seen.has(v.cursor))
          throw Error("Invalid attention cursor.");
        cursor = v.cursor;
        seen.add(cursor);
      } while (true);
      if (active) setLoaded({ scope, items });
    })().catch((e) => {
      if (active) {
        setError(e.message);
        setLoaded(null);
        if (e instanceof NativeApiError && [401, 403, 404].includes(e.status))
          purgeGone();
      }
    });
    return () => {
      active = false;
    };
  }, [scope, w.foreground, w.company, state, decisions, sourceTaskId]);
  const items = loaded?.scope === scope && w.foreground ? loaded.items : null;
  useEffect(() => {
    let active = true;
    if (items && selected && !items.some((i) => i.id === selected.id)) {
      void Promise.resolve().then(() => {
        if (active) purgeGone();
      });
    }
    return () => {
      active = false;
    };
  }, [items, selected]);
  const item = items?.find((i) => i.id === selected?.id);
  function open(i: AttentionView) {
    if (i.sourceKind === "task")
      router.push({
        pathname: "/task/[id]",
        params: { id: i.sourceId, company: w.company },
      });
    else if (i.sourceKind === "expense")
      router.push({
        pathname: "/expense/[id]",
        params: { id: i.sourceId, company: w.company },
      });
    else if (i.sourceKind === "intake")
      router.push({
        pathname: "/intake/[id]",
        params: { id: i.sourceId, company: w.company },
      });
    else if (i.sourceKind.startsWith("finance_")) {
      const p = new URLSearchParams(i.link.split("?")[1]);
      router.push({
        pathname: "/finance/assistance",
        params: {
          company: w.company,
          extraction: p.get("extraction") ?? "",
          tool: p.get("tool") ?? "",
          candidate: p.get("candidate") ?? "",
          row: p.get("row") ?? "",
          import: p.get("import") ?? "",
        },
      });
    } else if (i.sourceKind === "report_export")
      router.push({
        pathname: "/report/[id]",
        params: { id: i.sourceId, company: w.company, kind: "job" },
      });
    else {
      const p = new URLSearchParams(i.link.split("?")[1]);
      const conversation = p.get("conversation");
      if (conversation) {
        w.select(conversation);
        router.push({
          pathname: "/chat/[id]",
          params: {
            id: conversation,
            company: w.company,
            messageId: p.get("message") ?? "",
            recordId: i.sourceKind === "record" ? i.sourceId : "",
          },
        });
      }
    }
  }
  return (
    <View>
      <View>
        <Action
          title="Action required"
          selected={tab === "actions"}
          onPress={() => setTab("actions")}
        />
        <Action
          title="Updates"
          selected={tab === "updates"}
          onPress={() => {
            setTab("updates");
            setSelected(null);
          }}
        />
      </View>
      {tab === "updates" ? (
        <View>
          <Text>
            Reading conversation updates does not resolve attention or approve
            business work.
          </Text>
          {(w.inbox ?? []).map((i) => (
            <Action
              key={i.eventId}
              title={
                i.read
                  ? "Conversation update · read"
                  : "Read conversation update"
              }
              onPress={() =>
                void client
                  .request(
                    `/companies/${w.company}/communication/inbox/${i.eventId}/ack`,
                    "POST",
                    {},
                  )
                  .then(() => {
                    w.select(i.conversationId);
                    router.push({
                      pathname: "/chat/[id]",
                      params: { id: i.conversationId, company: w.company },
                    });
                  })
                  .catch((e) => w.setError(e.message))
              }
            />
          ))}
        </View>
      ) : (
        <View>
          <Text style={styles.heading}>Action required</Text>
          <Text>
            Resolving an Inbox item does not approve its business decision.
          </Text>
          <Action
            title={
              decisions ? "Show all attention" : "Pending business decisions"
            }
            onPress={() => {
              setSelected(null);
              setDecisions(!decisions);
            }}
          />
          {["open", "resolved", "all"].map((s) => (
            <Action
              key={s}
              title={
                s === "open"
                  ? "Open items"
                  : s === "resolved"
                    ? "Resolved items"
                    : "All items"
              }
              selected={state === s}
              onPress={() => {
                setState(s);
                setSelected(null);
              }}
            />
          ))}
          {!items && <Text>{error || "Checking current attention…"}</Text>}
          {!!error && (
            <Action
              title="Retry current attention"
              onPress={() => setEpoch((e) => e + 1)}
            />
          )}
          {items?.map((i) => (
            <View key={i.id} style={styles.message}>
              <Text>{i.title}</Text>
              <Text>{i.summary}</Text>
              <Text>
                {i.ownerName} · {i.state}
                {i.snoozedUntil
                  ? " · Snoozed until " +
                    new Date(i.snoozedUntil).toLocaleString("en", {
                      timeZone: w.work?.company.timezone,
                    })
                  : ""}
              </Text>
              <Action
                title={i.canDecide ? "Open business decision" : "Open source"}
                onPress={() => open(i)}
              />
              {i.actions.map((a) => (
                <Action
                  key={a}
                  title={
                    a === "route"
                      ? "Route Inbox item"
                      : a === "resolve"
                        ? "Resolve Inbox item"
                        : a === "snooze"
                          ? "Snooze Inbox item"
                          : "Unsnooze Inbox item"
                  }
                  onPress={() =>
                    setSelected({
                      id: i.id,
                      action: a as AttentionTransitionInput["action"],
                    })
                  }
                />
              ))}
            </View>
          ))}
          {items?.length === 0 && <Text>No current items in this view.</Text>}
          {item && selected && (
            <AttentionAction
              key={
                w.company +
                ":" +
                w.session?.user.id +
                ":" +
                item.id +
                ":" +
                selected.action
              }
              id={item.id}
              action={selected.action}
              authorization={scope + ":" + item.sourceVersion}
              onClose={() => setSelected(null)}
              onDone={() => {
                setSelected(null);
                setEpoch((e) => e + 1);
                void w.refresh("attention");
              }}
            />
          )}
        </View>
      )}
    </View>
  );
}
function AttentionAction({
  id,
  action,
  authorization,
  onClose,
  onDone,
}: {
  id: string;
  action: AttentionTransitionInput["action"];
  authorization: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const w = useWorkspace();
  const [draft, setDraft, retire] = useRamInput(
    "$attention:" + id,
    action,
    empty,
  );
  const [loaded, setLoaded] = useState<{
    authorization: string;
    item: AttentionView;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const denied = useEffectEvent(() => {
    retire();
    onClose();
  });
  useEffect(() => {
    let active = true;
    const generation = client.generation;
    void Promise.resolve().then(() => {
      if (active) setError("");
    });
    client
      .request<{ item: AttentionView }>(
        `/companies/${w.company}/attention/${id}`,
      )
      .then((v) => {
        if (active && generation === client.generation)
          setLoaded({ authorization, item: v.item });
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setLoaded(null);
          if (
            e instanceof NativeApiError &&
            [401, 403, 404].includes(e.status)
          ) {
            denied();
          }
        }
      });
    return () => {
      active = false;
    };
  }, [authorization, id, w.company]);
  const item = loaded?.authorization === authorization ? loaded.item : null;
  const unreview = useEffectEvent(() =>
    setDraft((d) => ({ ...d, reviewed: false })),
  );
  useEffect(() => {
    if (
      item &&
      draft.reviewed &&
      !draft.attempt &&
      draft.reviewVersion !== item.version
    )
      void Promise.resolve().then(() => unreview());
  }, [item, draft.reviewed, draft.attempt, draft.reviewVersion]);
  const locked = busy || !!draft.attempt || draft.reviewed;
  function change(v: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...v, reviewed: false }));
  }
  let instant = draft.instant;
  let dateError = "";
  let choices: string[] = [];
  if (action === "snooze") {
    try {
      instant = workDeadline(
        draft.date,
        draft.time,
        w.work?.company.timezone ?? "Asia/Kolkata",
        draft.instant,
      ).dueAt;
      if (!draft.time || !instant)
        dateError = "Choose a company-local date and time.";
    } catch (e) {
      dateError = (e as Error).message;
      if (e instanceof DeadlineChoiceError) choices = e.candidates;
    }
  }
  async function submit() {
    if (guard.current || !item) return;
    guard.current = true;
    setBusy(true);
    const snapshot = draft;
    const generation = client.generation;
    const payload =
      draft.attempt ??
      attentionIntent(
        item,
        action,
        {
          reason: draft.reason,
          recipientId: draft.recipientId,
          snoozedUntil: instant,
        },
        Crypto.randomUUID(),
      );
    setDraft({ ...draft, attempt: payload });
    try {
      await client.request(
        `/companies/${w.company}/attention/${id}/transition`,
        "POST",
        payload,
      );
      if (alive.current && generation === client.generation) {
        retire({ ...snapshot, attempt: payload });
        onDone();
      }
    } catch (e) {
      if (alive.current && generation === client.generation) {
        setError((e as Error).message);
        if (e instanceof NativeApiError && [401, 403, 404].includes(e.status)) {
          retire();
          onClose();
        }
      }
    } finally {
      guard.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const name =
    action === "route"
      ? "routing"
      : action === "resolve"
        ? "resolution"
        : action === "snooze"
          ? "snooze"
          : "unsnooze";
  return (
    <Sheet title={"Review Inbox " + name} onClose={onClose} busy={busy}>
      {!item ? (
        <Text>{error || "Checking current source access…"}</Text>
      ) : (
        <>
          <Text>{item.title}</Text>
          <Text>
            Inbox state only. Business approval uses the source workflow.
          </Text>
          {(action === "route" || action === "resolve") && (
            <TextInput
              accessibilityLabel={
                action === "route" ? "Routing reason" : "Resolution reason"
              }
              style={styles.input}
              value={draft.reason}
              editable={!locked}
              onChangeText={(reason) => change({ reason })}
            />
          )}
          {action === "route" && (
            <PersonPicker
              label="Route to"
              people={item.routePeople}
              value={draft.recipientId}
              onChange={(recipientId) => change({ recipientId })}
              disabled={locked}
            />
          )}
          {action === "snooze" && (
            <>
              <DeadlinePicker
                date={draft.date}
                time={draft.time}
                timezone={w.work?.company.timezone ?? "Asia/Kolkata"}
                disabled={locked}
                onChange={(v) => change({ ...v, instant: "" })}
              />
              {!!dateError && (
                <Text accessibilityRole="alert">{dateError}</Text>
              )}
              {choices.map((choice) => (
                <Action
                  key={choice}
                  title={choice}
                  disabled={locked}
                  onPress={() => change({ instant: choice })}
                />
              ))}
            </>
          )}
          {!draft.reviewed && !draft.attempt && (
            <Action
              title={"Review " + name}
              disabled={
                busy ||
                ((action === "route" || action === "resolve") &&
                  !draft.reason.trim()) ||
                (action === "route" && !draft.recipientId) ||
                (action === "snooze" && !!dateError)
              }
              onPress={() =>
                setDraft((d) => ({
                  ...d,
                  reviewed: true,
                  reviewVersion: item.version,
                }))
              }
            />
          )}
          {(draft.reviewed || draft.attempt) && (
            <>
              <Text>
                {draft.reason}
                {action === "route"
                  ? " · " +
                    item.routePeople.find((p) => p.id === draft.recipientId)
                      ?.name
                  : ""}
                {action === "snooze" ? " · " + instant : ""}
              </Text>
              <Action
                title={draft.attempt ? "Retry same action" : "Confirm " + name}
                disabled={busy}
                onPress={() => void submit()}
              />
              <Action
                title="Edit action"
                disabled={busy}
                onPress={() =>
                  setDraft((d) => ({ ...d, attempt: null, reviewed: false }))
                }
              />
            </>
          )}
          {!!error && <Text accessibilityRole="alert">{error}</Text>}
        </>
      )}
    </Sheet>
  );
}
