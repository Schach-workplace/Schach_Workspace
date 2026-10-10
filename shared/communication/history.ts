/** Opaque cursor transport; stream event sequences are never message sequences. */
export interface HistoryMessage {
  id: string;
  sequence: number;
  revision: number;
  body: string;
  removed: boolean;
  replyToId?: string;
  mediaIds?: string[];
  mentionIds?: string[];
  mentionAll?: boolean;
}
interface Page<M> {
  messages: M[];
  cursor: string;
  hasMore: boolean;
}
interface Event {
  kind: string;
  messageId: string;
}
interface Events {
  events: Event[];
  cursor: string;
  hasMore: boolean;
}
export class MissingSourceError extends Error {
  readonly contextualSource = true;
}
/** A missing message is contextual only after a fresh conversation read succeeds. */
export async function authorizedSource<T>(
  get: (path: string) => Promise<T>,
  path: string,
  metadata = "",
): Promise<T> {
  try {
    return await get(path);
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e;
    await get(metadata);
    throw new MissingSourceError("Message is no longer available.");
  }
}
export function mergeMessages<M extends HistoryMessage>(
  old: M[],
  next: M[],
): M[] {
  const rows = new Map(old.map((m) => [m.id, m]));
  for (const m of next) {
    const prior = rows.get(m.id);
    if (
      !prior ||
      m.revision > prior.revision ||
      (m.revision === prior.revision && (!prior.removed || m.removed))
    )
      rows.set(m.id, m);
  }
  return [...rows.values()].sort((a, b) => a.sequence - b.sequence);
}
export class ConversationHistory<M extends HistoryMessage = HistoryMessage> {
  messages: M[] = [];
  olderCursor = "";
  eventsCursor = "";
  hasMore = false;
  private alive = true;
  private lane: Promise<unknown> = Promise.resolve();
  private syncing: Promise<void> | null = null;
  private loadingOlder: Promise<void> | null = null;
  constructor(
    private get: <T = any>(path: string) => Promise<T>,
    private changed: (ids: string[]) => void,
  ) {}
  private run(action: () => Promise<void>) {
    const p = this.lane
      .catch(() => {})
      .then(async () => {
        if (this.alive) await action();
      });
    this.lane = p;
    return p;
  }
  private publish(next: M[], ids: string[] = []) {
    if (!this.alive) return;
    this.messages = next;
    this.changed(ids);
  }
  dispose() {
    this.alive = false;
    this.messages = [];
    this.eventsCursor = "";
    this.olderCursor = "";
  }
  merge(next: M[]) {
    return this.run(async () =>
      this.publish(mergeMessages(this.messages, next)),
    );
  }
  bootstrap() {
    return this.run(async () => {
      let cursor = "";
      let page: Events;
      do {
        page = await this.get<Events>(
          "/sync" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
        );
        if (!this.alive) return;
        cursor = page.cursor;
      } while (page.hasMore);
      const head = await this.get<Page<M>>("/messages");
      if (!this.alive) return;
      this.olderCursor = head.cursor;
      this.hasMore = head.hasMore;
      this.eventsCursor = cursor;
      this.publish(head.messages);
      await this.drain();
    });
  }
  sync() {
    if (this.syncing) return this.syncing;
    const p = this.run(() => this.drain());
    this.syncing = p;
    void p
      .finally(() => {
        if (this.syncing === p) this.syncing = null;
      })
      .catch(() => {});
    return p;
  }
  private async drain() {
    if (!this.eventsCursor) return;
    let page: Events;
    do {
      page = await this.get<Events>(
        "/sync?cursor=" + encodeURIComponent(this.eventsCursor),
      );
      if (!this.alive) return;
      const changes = new Map<string, string>();
      let reconcile = false;
      for (const e of page.events) {
        if (
          e.messageId &&
          [
            "message_created",
            "message_edited",
            "message_removed",
            "content_expired",
          ].includes(e.kind)
        ) {
          const prior = changes.get(e.messageId);
          if (!["message_removed", "content_expired"].includes(prior ?? ""))
            changes.set(e.messageId, e.kind);
        } else if (
          ![
            "read",
            "message_read",
            "reaction_changed",
            "message_saved",
            "message_pinned",
            "work_linked",
            "acknowledgement_requested",
            "acknowledgement_recorded",
            "poll_created",
            "poll_voted",
            "event_created",
            "event_rsvp",
            "decision_created",
          ].includes(e.kind)
        )
          reconcile = true;
      }
      const ids = [...changes.keys()];
      if (ids.length) this.publish(this.messages, ids);
      const removed = new Set(
        [...changes]
          .filter(
            ([, kind]) =>
              kind === "message_removed" || kind === "content_expired",
          )
          .map(([id]) => id),
      );
      if (removed.size)
        this.publish(
          this.messages.map((m) =>
            removed.has(m.id)
              ? {
                  ...m,
                  revision:
                    m.revision +
                    (!m.removed && changes.get(m.id) === "message_removed"
                      ? 1
                      : 0),
                  removed: true,
                  body: "",
                  replyToId: "",
                  mediaIds: [],
                  mentionIds: [],
                  mentionAll: false,
                }
              : m,
          ),
          [...removed],
        );
      const roots: M[] = [];
      for (const id of changes.keys()) {
        if (removed.has(id)) continue;
        try {
          const path = "/messages/" + encodeURIComponent(id) + "/thread";
          const result = await authorizedSource<{ root: M; messages: M[] }>(
            this.get,
            path,
          );
          if (!this.alive) return;
          roots.push(result.root, ...result.messages);
        } catch (e) {
          if (!(e instanceof MissingSourceError)) throw e;
          if (!this.alive) return;
          this.publish(
            this.messages.map((m) =>
              m.id === id
                ? {
                    ...m,
                    removed: true,
                    body: "",
                    replyToId: "",
                    mediaIds: [],
                    mentionIds: [],
                    mentionAll: false,
                  }
                : m,
            ),
            [id],
          );
          reconcile = true;
        }
      }
      if (reconcile) await this.reconcileNow();
      if (!this.alive) return;
      this.publish(mergeMessages(this.messages, roots), ids);
      this.eventsCursor = page.cursor;
    } while (page.hasMore);
  }
  older() {
    if (this.loadingOlder) return this.loadingOlder;
    const p = this.run(async () => {
      if (!this.hasMore) return;
      const page = await this.get<Page<M>>(
        "/messages?cursor=" + encodeURIComponent(this.olderCursor),
      );
      if (!this.alive) return;
      this.olderCursor = page.cursor;
      this.hasMore = page.hasMore;
      this.publish(mergeMessages(this.messages, page.messages));
    });
    this.loadingOlder = p;
    void p
      .finally(() => {
        if (this.loadingOlder === p) this.loadingOlder = null;
      })
      .catch(() => {});
    return p;
  }
  reconcileLoadedRange(oldest?: number) {
    return this.run(() => this.reconcileNow(oldest));
  }
  private async reconcileNow(bound?: number) {
    const oldest = bound ?? this.messages[0]?.sequence ?? Infinity;
    let cursor = "";
    let rows: M[] = [];
    let page: Page<M>;
    do {
      page = await this.get<Page<M>>(
        "/messages" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
      );
      if (!this.alive) return;
      rows = rows.concat(page.messages);
      cursor = page.cursor;
    } while (page.hasMore && (page.messages[0]?.sequence ?? 0) > oldest);
    if (!this.alive) return;
    this.olderCursor = cursor;
    this.hasMore = page.hasMore;
    const ids = this.messages
      .filter((old) => {
        const fresh = rows.find((m) => m.id === old.id);
        return (
          !fresh ||
          fresh.revision !== old.revision ||
          fresh.removed !== old.removed
        );
      })
      .map((m) => m.id);
    this.publish(mergeMessages([], rows), ids);
  }
}
