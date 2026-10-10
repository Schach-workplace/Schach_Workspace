export function registerDraftCases(
  it: any,
  expect: any,
  implementation: typeof import("./drafts"),
) {
  const {
    readDraft,
    writeDraft,
    clearAllDrafts,
    clearCompanyDrafts,
    clearConversationDrafts,
    readHistoryPosition,
    writeHistoryPosition,
    clearDraftSources,
  } = implementation;
  const scope = {
    serverOrigin: "https://one.test",
    companyId: "c",
    userId: "u",
    conversationId: "a",
    threadRootId: "",
  };
  it("isolates authored RAM by conversation and thread and erases company scope", () => {
    clearAllDrafts();
    writeDraft(scope, { body: "private" });
    expect(readDraft({ ...scope, conversationId: "b" }).body).toBe("");
    expect(readDraft({ ...scope, threadRootId: "m" }).body).toBe("");
    expect(readDraft(scope).body).toBe("private");
    clearCompanyDrafts("c", "u");
    expect(readDraft(scope).body).toBe("");
  });
  it("clears all affected thread drafts on a conversation history boundary", () => {
    writeDraft(scope, { body: "main" });
    writeDraft({ ...scope, threadRootId: "m" }, { body: "thread" });
    clearConversationDrafts("c", "u", "a");
    expect(readDraft(scope).body).toBe("");
    expect(readDraft({ ...scope, threadRootId: "m" }).body).toBe("");
  });
  it("erases publication inputs and content-free viewport metadata with conversation revocation", () => {
    const publication = {
      ...scope,
      conversationId: "a:publication:m",
      threadRootId: "input:title",
    };
    writeDraft(publication, { body: "authored title" });
    writeHistoryPosition(scope, {
      oldestSequence: 1,
      anchorId: "m20",
      atBottom: false,
    });
    clearConversationDrafts("c", "u", "a");
    expect(readDraft(publication).body).toBe("");
    expect(readHistoryPosition(scope)).toBeUndefined();
  });
  it("clears quote presentation while retaining the canonical frozen retry", () => {
    clearAllDrafts();
    const frozen = {
      clientMessageId: "fixed",
      body: "authored",
      replyToId: "m",
    };
    writeDraft(scope, {
      body: "authored",
      replyToId: "m",
      pendingPayload: frozen,
    });
    clearDraftSources("c", "u", "a", ["m"]);
    expect(readDraft(scope).replyToId).toBe("");
    expect(readDraft(scope).pendingPayload).toBe(frozen);
  });
}
