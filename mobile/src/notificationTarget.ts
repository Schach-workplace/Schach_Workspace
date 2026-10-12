interface Session {
  user: { id: string };
  companies: { id: string }[];
}
/**
 * Native push hints are body-free. The backend (backend/platform
 * push_providers.go, PushHint) sends only `eventId`, `companyId` and
 * `conversationId`; tasks and expenses reach the device through the attention
 * inbox, not through dedicated push fields. A hint that cannot be routed to an
 * authorized conversation therefore opens the Inbox instead of doing nothing.
 */
export type NotificationDestination =
  | { companyId: string; conversationId: string }
  | { companyId?: string; inbox: true };
const valid = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 100;
export class AuthorizedNotificationTarget {
  private seen = new Set<string>();
  private sequence = 0;
  constructor(
    private session: () => Promise<Session>,
    private authorize: (company: string, id: string) => Promise<unknown>,
    private navigate: (target: NotificationDestination) => void,
    private generation: () => number,
  ) {}
  /**
   * @param input notification `data` payload (untrusted).
   * @param fallbackId notification request identifier used to deduplicate
   * hints that carry no event id.
   */
  async open(input: unknown, fallbackId?: string) {
    const hint =
      input && typeof input === "object"
        ? (input as Record<string, unknown>)
        : {};
    const dedupe = valid(hint.eventId)
      ? "event:" + hint.eventId
      : valid(fallbackId)
        ? "request:" + fallbackId
        : "";
    if (dedupe) {
      if (this.seen.has(dedupe)) return;
      this.seen.add(dedupe);
    }
    const sequence = ++this.sequence,
      current = this.generation();
    const fresh = () =>
      sequence === this.sequence && current === this.generation();
    if (!valid(hint.eventId) || !valid(hint.companyId)) {
      // Unknown or malformed payload: stay in the current company, show Inbox.
      this.navigate({ inbox: true });
      return;
    }
    const companyId = hint.companyId;
    const session = await this.session();
    if (!session.companies.some((c) => c.id === companyId))
      throw Error("Notification company unavailable.");
    if (!valid(hint.conversationId)) {
      if (fresh()) this.navigate({ companyId, inbox: true });
      return;
    }
    const conversationId = hint.conversationId;
    await this.authorize(companyId, conversationId);
    if (!fresh()) return;
    this.navigate({ companyId, conversationId });
  }
}
