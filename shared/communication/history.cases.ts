export function registerHistoryCases(
  it: any,
  expect: any,
  implementation: typeof import("./history"),
) {
  const { ConversationHistory, mergeMessages } = implementation;
  const row = (sequence: number, revision = 1) => ({
    id: "m" + sequence,
    sequence,
    revision,
    body: "body" + sequence,
    removed: false,
    replyToId: "",
    mediaIds: [],
    mentionIds: [],
    mentionAll: false,
  });
  it("does not resurrect a removed loaded row from a late older page", () => {
    const removed = { ...row(5, 2), removed: true, body: "" };
    expect(mergeMessages([removed], [row(5)])[0]).toEqual(removed);
  });
  it("keeps 250 loaded rows and oldest cursor after 127 events over two pages", async () => {
    const all = Array.from({ length: 375 }, (_, i) => row(i + 1));
    let changed = false;
    const requests: string[] = [];
    const get = async (path: string): Promise<any> => {
      requests.push(path);
      if (path === "/sync") return { events: [], cursor: "e0", hasMore: false };
      if (path === "/sync?cursor=e0")
        return changed
          ? {
              events: all
                .slice(250, 350)
                .map((m) => ({ kind: "message_created", messageId: m.id })),
              cursor: "e100",
              hasMore: true,
            }
          : { events: [], cursor: "e0", hasMore: false };
      if (path === "/sync?cursor=e100")
        return {
          events: [
            ...all
              .slice(350)
              .map((m) => ({ kind: "message_created", messageId: m.id })),
            { kind: "message_edited", messageId: "m5" },
            { kind: "message_removed", messageId: "m6" },
          ],
          cursor: "e127",
          hasMore: false,
        };
      if (path.endsWith("/thread")) {
        const id = path.split("/")[2];
        return {
          root:
            id === "m5"
              ? { ...row(5, 2), body: "edited" }
              : all.find((m) => m.id === id),
          messages: [],
        };
      }
      const page = path.includes("o2")
        ? all.slice(0, 50)
        : path.includes("o1")
          ? all.slice(50, 150)
          : all.slice(150, 250);
      return {
        messages: page,
        cursor: path.includes("o1") ? "o2" : path.includes("o2") ? "o3" : "o1",
        hasMore: page.length === 100,
      };
    };
    const h = new ConversationHistory(get, () => {});
    await h.bootstrap();
    await h.older();
    await h.older();
    changed = true;
    await Promise.all([h.sync(), h.sync(), h.sync()]);
    expect(h.messages).toHaveLength(375);
    expect(h.messages.map((m) => m.sequence)).toEqual(
      Array.from({ length: 375 }, (_, i) => i + 1),
    );
    expect(h.olderCursor).toBe("o3");
    expect(h.eventsCursor).toBe("e127");
    expect(h.messages[4].body).toBe("edited");
    expect(h.messages[5]).toMatchObject({
      removed: true,
      body: "",
      replyToId: "",
      mediaIds: [],
      mentionIds: [],
    });
    expect(requests.filter((p) => p === "/sync?cursor=e100")).toHaveLength(1);
  });
  it("does not apply a page after disposal", async () => {
    let resolve: (x: any) => void = () => {};
    const h = new ConversationHistory(
      async (p): Promise<any> =>
        p.startsWith("/sync")
          ? { events: [], cursor: "e", hasMore: false }
          : new Promise((r) => (resolve = r)),
      () => {},
    );
    const loading = h.bootstrap();
    await Promise.resolve();
    await Promise.resolve();
    h.dispose();
    resolve({ messages: [row(1)], cursor: "o", hasMore: false });
    await loading;
    expect(h.messages).toEqual([]);
  });

  it("restores a prior loaded range with fresh authorized pages rather than caching fetched bodies", async () => {
    const pages = [
      Array.from({ length: 100 }, (_, i) => row(i + 151)),
      Array.from({ length: 100 }, (_, i) => row(i + 51)),
      Array.from({ length: 50 }, (_, i) => row(i + 1)),
    ];
    const h = new ConversationHistory(
      async (path): Promise<any> => {
        if (path.startsWith("/sync"))
          return { events: [], cursor: "e", hasMore: false };
        const n = path.includes("o2") ? 2 : path.includes("o1") ? 1 : 0;
        return { messages: pages[n], cursor: "o" + (n + 1), hasMore: n < 2 };
      },
      () => {},
    );
    await h.bootstrap();
    await h.reconcileLoadedRange(1);
    expect(h.messages.map((m) => m.sequence)).toEqual(
      Array.from({ length: 250 }, (_, i) => i + 1),
    );
    expect(h.olderCursor).toBe("o3");
    expect(h.hasMore).toBe(false);
  });

  it("drains deletion on a later event page after missing-root metadata reauthorization", async () => {
    let replay = false;
    const changes: string[][] = [];
    const h = new ConversationHistory(
      async (path): Promise<any> => {
        if (path === "") return { conversation: { id: "a" }, members: [] };
        if (path.endsWith("/thread"))
          throw Object.assign(Error("Message not found"), { status: 404 });
        if (path === "/sync")
          return { events: [], cursor: "base", hasMore: false };
        if (path.includes("base"))
          return {
            events: replay
              ? [{ kind: "message_created", messageId: "m1" }]
              : [],
            cursor: replay ? "next" : "base",
            hasMore: replay,
          };
        if (path.includes("next"))
          return {
            events: [{ kind: "message_removed", messageId: "m1" }],
            cursor: "done",
            hasMore: false,
          };
        return {
          messages: [
            { ...row(1), removed: replay, body: replay ? "" : "private" },
          ],
          cursor: "older",
          hasMore: false,
        };
      },
      (ids) => changes.push(ids),
    );
    await h.bootstrap();
    replay = true;
    await h.sync();
    expect(h.eventsCursor).toBe("done");
    expect(h.messages[0]).toMatchObject({ removed: true, body: "" });
    expect(changes.flat()).toContain("m1");
  });
  it("invalidates source presentation before hydration and includes an incoming reply", async () => {
    let replay = false,
      release: (v: any) => void = () => {};
    const changes: string[][] = [];
    const h = new ConversationHistory(
      async (path): Promise<any> => {
        if (path.endsWith("/thread")) return new Promise((r) => (release = r));
        if (path.startsWith("/sync"))
          return {
            events: replay
              ? [{ kind: "message_created", messageId: "reply" }]
              : [],
            cursor: replay ? "done" : "base",
            hasMore: false,
          };
        return { messages: [row(1)], cursor: "older", hasMore: false };
      },
      (ids) => changes.push(ids),
    );
    await h.bootstrap();
    replay = true;
    const pending = h.sync();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(changes.flat()).toContain("reply");
    release({
      root: row(1),
      messages: [{ ...row(2), id: "reply", replyToId: "m1" }],
    });
    await pending;
    expect(h.messages.map((m) => m.id)).toEqual(["m1", "reply"]);
  });

  it("preserves the older cursor and loaded range through read, reaction, poll and work metadata events", async () => {
    let replay = false;
    const requests: string[] = [];
    const h = new ConversationHistory(
      async (path): Promise<any> => {
        requests.push(path);
        if (path.startsWith("/sync"))
          return {
            events: replay
              ? [
                  "message_read",
                  "reaction_changed",
                  "poll_voted",
                  "work_linked",
                ].map((kind) => ({ kind, messageId: "m1" }))
              : [],
            cursor: replay ? "next" : "base",
            hasMore: false,
          };
        return { messages: [row(1), row(2)], cursor: "oldest", hasMore: true };
      },
      () => {},
    );
    await h.bootstrap();
    replay = true;
    await Promise.all([h.sync(), h.sync()]);
    expect(h.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(h.olderCursor).toBe("oldest");
    expect(h.eventsCursor).toBe("next");
    expect(requests.filter((p) => p === "/messages")).toHaveLength(1);
  });
}
