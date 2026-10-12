interface Session {
  user: { id: string };
  companies: { id: string }[];
}
/**
 * Native push hints are body-free. The backend (backend/platform
 * push_providers.go, PushHint) sends only opaque ids: `eventId`, `companyId`
 * and exactly one of `conversationId` (chat) or `attentionId` (Inbox item).
 * An attention hint is resolved through the authenticated single-item
 * attention API; task and expense items open their detail screens, anything
 * else (or a denied/missing item) opens the company Inbox.
 */
export type NotificationDestination =
  | { companyId: string; conversationId: string }
  | { companyId: string; taskId: string }
  | { companyId: string; expenseId: string }
  | { companyId?: string; inbox: true };
/** The fields of GET /companies/{c}/attention/{id} `item` used for routing. */
export interface AttentionTarget {
  id?: string;
  companyId?: string;
  sourceKind?: string;
  sourceId?: string;
}
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
    private attention?: (
      company: string,
      id: string,
    ) => Promise<AttentionTarget>,
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
      if (valid(hint.attentionId) && this.attention) {
        const destination = await this.attentionDestination(
          companyId,
          hint.attentionId,
        );
        if (fresh()) this.navigate(destination);
        return;
      }
      if (fresh()) this.navigate({ companyId, inbox: true });
      return;
    }
    const conversationId = hint.conversationId;
    await this.authorize(companyId, conversationId);
    if (!fresh()) return;
    this.navigate({ companyId, conversationId });
  }
  /** Never throws: any lookup failure or unroutable item becomes Inbox. */
  private async attentionDestination(
    companyId: string,
    attentionId: string,
  ): Promise<NotificationDestination> {
    const inbox = { companyId, inbox: true as const };
    let item: AttentionTarget;
    try {
      item = (await this.attention!(companyId, attentionId)) ?? {};
    } catch {
      return inbox;
    }
    if (item.companyId !== companyId || !valid(item.sourceId)) return inbox;
    if (item.sourceKind === "task") return { companyId, taskId: item.sourceId };
    if (item.sourceKind === "expense")
      return { companyId, expenseId: item.sourceId };
    return inbox;
  }
}
