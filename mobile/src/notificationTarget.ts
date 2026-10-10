interface Session {
  user: { id: string };
  companies: { id: string }[];
}
export class AuthorizedNotificationTarget {
  private seen = new Set<string>();
  private sequence = 0;
  constructor(
    private session: () => Promise<Session>,
    private authorize: (company: string, id: string) => Promise<unknown>,
    private navigate: (target: {
      companyId: string;
      conversationId: string;
    }) => void,
    private generation: () => number,
  ) {}
  async open(input: unknown) {
    const hint = input as Record<string, unknown>;
    if (
      !hint ||
      ["eventId", "companyId", "conversationId"].some(
        (key) =>
          typeof hint[key] !== "string" ||
          !(hint[key] as string).length ||
          (hint[key] as string).length > 100,
      )
    )
      return;
    const eventId = hint.eventId as string,
      companyId = hint.companyId as string,
      conversationId = hint.conversationId as string;
    if (this.seen.has(eventId)) return;
    this.seen.add(eventId);
    const sequence = ++this.sequence,
      current = this.generation();
    const session = await this.session();
    if (!session.companies.some((c) => c.id === companyId))
      throw Error("Notification company unavailable.");
    await this.authorize(companyId, conversationId);
    if (sequence !== this.sequence || current !== this.generation()) return;
    this.navigate({ companyId, conversationId });
  }
}
