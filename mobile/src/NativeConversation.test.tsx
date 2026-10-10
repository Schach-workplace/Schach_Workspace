// @vitest-environment happy-dom
import {
  act,
  createElement,
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  readHistoryPosition,
  writeHistoryPosition,
  clearAllDrafts,
  readDraft,
  writeDraft,
} from "./conversationDrafts";
import NativeConversation from "./NativeConversation";
vi.mock("./KeyboardFrame", () => ({
  default: ({ children }: any) => createElement("div", {}, children),
}));
const state = vi.hoisted(() => ({
  events: [] as any[],
  target: "",
  thread: null as any,
  offline: false,
  rows: [] as any[],
  reads: [] as number[],
  list: null as any,
  scrolls: [] as number[],
  layouts: [] as ((e: any) => void)[],
  posts: [] as unknown[],
  loseFirstPost: true,
  metadataGate: null as Promise<void> | null,
  w: {} as any,
}));
vi.mock("./client", () => ({
  NativeApiError: class extends Error {},
  client: {
    endpoint: "https://fixture.test",
    requestThread: vi.fn((path: string) => state.thread(path)),
    request: vi.fn(async (_path: string, method = "GET", body?: unknown) => {
      if (method === "POST" && _path.endsWith("/messages")) {
        state.posts.push(body);
        if (state.loseFirstPost && state.posts.length === 1)
          throw Error("Response lost");
        return { message: { id: "accepted" } };
      }
      if (state.offline) throw Error("Network unavailable");
      if (_path.includes("/sync"))
        return { events: state.events, cursor: "events", hasMore: false };
      if (_path.endsWith("/messages"))
        return { messages: state.rows, cursor: "", hasMore: false };
      if (_path.endsWith("/read")) {
        state.reads.push((body as any).sequence);
        return {};
      }
      if (state.metadataGate) await state.metadataGate;
      return {
        conversation: {
          id: "chat",
          title: "Site",
          kind: "group",
          public: false,
          archived: false,
          version: 1,
          forwarding: "deny",
        },
        members: [{ userId: "person", role: "member", epoch: 1 }],
      };
    }),
  },
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ messageId: state.target }),
  router: { back: vi.fn(), push: vi.fn(), replace: vi.fn() },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("./Media", () => ({ default: () => null }));
vi.mock("./LinkedWork", () => ({ default: () => null }));
vi.mock("./Publication", () => ({ default: () => null }));
vi.mock("./Structured", () => ({ default: () => null }));
vi.mock("./ChatControls", () => ({ default: () => null }));
vi.mock("./Workspace", () => ({
  useWorkspace: () => state.w,
  Page: ({ children }: { children: ReactNode }) =>
    createElement("div", {}, children),
}));
vi.mock("./ConnectList", () => ({
  conversationName: () => "Site",
  SearchSheet: () => null,
}));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({
    title,
    onPress,
    disabled,
  }: {
    title: string;
    onPress: () => void;
    disabled?: boolean;
  }) => createElement("button", { onClick: onPress, disabled }, title),
  PersonAvatar: () => null,
  Sheet: ({ children, title }: { children: ReactNode; title: string }) =>
    createElement("section", { "aria-label": title }, children),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  FlatList: forwardRef(function List(props: any, ref) {
    const { data, renderItem, ListHeaderComponent } = props;
    useLayoutEffect(() => {
      state.list = props;
    });
    useImperativeHandle(ref, () => ({
      scrollToEnd() {},
      scrollToIndex() {},
      scrollToOffset(v: { offset: number }) {
        state.scrolls.push(v.offset);
      },
    }));
    return createElement(
      "div",
      {},
      ListHeaderComponent,
      ...data.map((item: any, index: number) =>
        props.CellRendererComponent
          ? createElement(
              props.CellRendererComponent,
              {
                key: item.id,
                cellKey: item.id,
                index,
                item,
                onLayout: () => {},
              },
              renderItem({ item, index }),
            )
          : renderItem({ item, index }),
      ),
    );
  }),
  View: ({
    children,
    onLayout,
  }: {
    children: ReactNode;
    onLayout?: (e: any) => void;
  }) => {
    useLayoutEffect(() => {
      if (onLayout) state.layouts.push(onLayout);
    }, [onLayout]);
    return createElement("div", {}, children);
  },
  Text: ({ children }: { children: ReactNode }) =>
    createElement("span", {}, children),
  Pressable: ({
    children,
    onPress,
  }: {
    children: ReactNode;
    onPress?: () => void;
  }) => createElement("button", { onClick: onPress }, children),
  KeyboardAvoidingView: ({ children }: { children: ReactNode }) =>
    createElement("div", {}, children),
  ScrollView: forwardRef(function NativeScroll(
    { children }: { children: ReactNode },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ scrollToEnd: () => {} }));
    return createElement("div", {}, children);
  }),
  TextInput: ({
    value,
    onChangeText,
    accessibilityLabel,
    editable,
  }: {
    value: string;
    onChangeText: (value: string) => void;
    accessibilityLabel: string;
    editable?: boolean;
  }) =>
    createElement("textarea", {
      "aria-label": accessibilityLabel,
      value,
      disabled: editable === false,
      onInput: (e: any) => onChangeText(e.currentTarget.value),
    }),
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.events = [];
  state.target = "";
  state.thread = vi.fn();
  state.offline = false;
  state.posts = [];
  state.loseFirstPost = true;
  state.metadataGate = null;
  state.rows = [];
  state.reads = [];
  state.list = null;
  state.scrolls = [];
  state.layouts = [];
  state.w = {
    company: "company",
    selected: "chat",
    foreground: true,
    session: { user: { id: "person" } },
    work: { me: { role: "member" }, people: [] },
    setError: vi.fn(),
    invalidatePrivateViews: vi.fn(),
  };
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  clearAllDrafts();
});
it("keeps the same pending message across a recoverable polling outage", async () => {
  await act(async () => root.render(createElement(NativeConversation)));
  const input = container.querySelector(
    'textarea[aria-label="Message"]',
  )! as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input, "Preserve this private draft");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "Send")!
      .click(),
  );
  expect(state.posts).toHaveLength(1);
  state.offline = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(
    container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Message"]',
    )?.value,
  ).toBe("Preserve this private draft");
  state.offline = false;
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "Retry same message")!
      .click(),
  );
  expect(state.posts).toHaveLength(2);
  expect(state.posts[0]).toEqual(state.posts[1]);
});

it("uses stable virtual list IDs and acknowledges the highest viewed sequence only at foreground bottom", async () => {
  state.rows = Array.from({ length: 100 }, (_, i) => ({
    id: "m" + (i + 1),
    sequence: i + 1,
    revision: 1,
    body: "Message " + (i + 1),
    senderId: "person",
    createdAt: "2026-10-10T12:00:00Z",
    removed: false,
    replyToId: "",
    mediaIds: [],
  }));
  await act(async () => root.render(<NativeConversation />));
  expect(state.list.data).toHaveLength(100);
  expect(state.list.keyExtractor(state.rows[39])).toBe("m40");
  expect(state.list.maintainVisibleContentPosition).toEqual({
    minIndexForVisible: 0,
  });
  expect(state.reads).toEqual([]);
  await act(async () => state.list.onContentSizeChange());
  await act(async () =>
    state.list.onViewableItemsChanged({
      viewableItems: [{ item: state.rows[39] }],
    }),
  );
  expect(state.reads).toEqual([]);
  await act(async () =>
    state.list.onScroll({
      nativeEvent: {
        contentSize: { height: 1000 },
        contentOffset: { y: 900 },
        layoutMeasurement: { height: 100 },
      },
    }),
  );
  expect(state.reads).toEqual([40]);
  await act(async () =>
    state.list.onViewableItemsChanged({
      viewableItems: [{ item: state.rows[99] }],
    }),
  );
  expect(state.reads).toEqual([40, 100]);
  state.w = { ...state.w, foreground: false };
  await act(async () => root.render(<NativeConversation />));
  await act(async () =>
    state.list.onViewableItemsChanged({
      viewableItems: [{ item: { ...state.rows[99], sequence: 101 } }],
    }),
  );
  expect(state.reads).toEqual([40, 100]);
});

it("restores a relative native anchor after fresh wrapped row heights change", async () => {
  const scope = {
    serverOrigin: "https://fixture.test",
    companyId: "company",
    userId: "person",
    conversationId: "chat",
  };
  state.rows = Array.from({ length: 100 }, (_, i) => ({
    id: "m" + (i + 1),
    sequence: i + 1,
    revision: 1,
    body: "Fresh " + (i + 1),
    senderId: "person",
    createdAt: "2026-10-10T12:00:00Z",
    removed: false,
    replyToId: "",
    mediaIds: [],
  }));
  writeHistoryPosition(scope, {
    oldestSequence: 1,
    anchorId: "m80",
    offset: -15,
    atBottom: false,
  });
  await act(async () => root.render(<NativeConversation />));
  await act(async () =>
    state.layouts[79]({ nativeEvent: { layout: { y: 1200, height: 100 } } }),
  );
  await act(async () => state.list.onContentSizeChange());
  expect(state.scrolls).toEqual([1215]);
  expect(readHistoryPosition(scope)?.oldestSequence).toBe(1);
});

it("rejects an old target result after target replacement on a mounted native route", async () => {
  let release: (v: any) => void = () => {};
  state.thread = vi.fn(async (path: string) =>
    path.includes("/old/")
      ? new Promise((r) => (release = r))
      : {
          root: { id: "new", body: "Current target", removed: false },
          messages: [],
        },
  );
  state.target = "old";
  await act(async () => root.render(<NativeConversation />));
  expect(state.thread).toHaveBeenCalled();
  state.target = "new";
  await act(async () => root.render(<NativeConversation />));
  expect(container.textContent).toContain("Current target");
  await act(async () =>
    release({
      root: { id: "old", body: "Old private target", removed: false },
      messages: [],
    }),
  );
  expect(container.textContent).not.toContain("Old private target");
});

const dependencyRoot = {
  id: "root",
  sequence: 1,
  revision: 1,
  body: "Invalidated private root",
  removed: false,
  replyToId: "",
  senderId: "person",
  createdAt: "2026-10-10T12:00:00Z",
  mediaIds: [],
};
const dependencyReply = {
  ...dependencyRoot,
  id: "reply",
  sequence: 2,
  body: "Loaded reply",
  replyToId: "root",
};
const dependencyScope = {
  serverOrigin: "https://fixture.test",
  companyId: "company",
  userId: "person",
  conversationId: "chat",
};
const openReplyThread = () =>
  [...container.querySelectorAll("button")]
    .filter((b) => b.textContent === "Thread")
    .at(-1)!
    .click();
it.each([
  {
    name: "known reply root deletion",
    known: true,
    kind: "message_removed",
    id: "root",
  },
  {
    name: "root deletion learned only from target result",
    known: false,
    kind: "message_removed",
    id: "root",
  },
  {
    name: "reply dependency deletion learned only from target result",
    known: false,
    kind: "message_removed",
    id: "another",
  },
  {
    name: "delayed older root revision after edit",
    known: true,
    kind: "message_edited",
    id: "root",
  },
])(
  "rejects a pending thread after $name without discarding authored frozen input",
  async (c) => {
    let release: (v: any) => void = () => {};
    const currentRoot = {
      ...dependencyRoot,
      revision: 2,
      body: "Current authorized root",
    };
    state.thread = vi.fn((path: string) =>
      path.endsWith("/root/thread")
        ? Promise.resolve({ root: currentRoot, messages: [] })
        : new Promise((r) => (release = r)),
    );
    state.rows = c.known ? [dependencyReply] : [];
    if (!c.known) state.target = "reply";
    await act(async () => root.render(<NativeConversation />));
    if (c.known) await act(async () => openReplyThread());
    expect(state.thread).toHaveBeenCalledOnce();
    const frozen = Object.freeze({
      clientMessageId: "frozen",
      body: "Authored survives",
      replyToId: "root",
      mentionIds: ["person"],
      mentionAll: false,
    });
    const threadScope = { ...dependencyScope, threadRootId: "root" };
    await act(async () => {
      writeDraft(dependencyScope, {
        body: frozen.body,
        replyToId: "root",
        pendingPayload: frozen,
      });
      writeDraft(threadScope, {
        body: "Authored thread survives",
        replyToId: "root",
        pendingPayload: frozen,
      });
    });
    state.events = [{ kind: c.kind, messageId: c.id }];
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(readDraft(dependencyScope).body).toBe(frozen.body);
    expect(readDraft(dependencyScope).pendingPayload).toBe(frozen);
    expect(readDraft(dependencyScope).replyToId).toBe(
      c.id === "root" ? "" : "root",
    );
    await act(async () =>
      release({
        root: dependencyRoot,
        messages: [
          dependencyReply,
          {
            ...dependencyReply,
            id: "another",
            body: "Invalidated reply dependency",
          },
        ],
      }),
    );
    expect(container.textContent).not.toContain("Invalidated private root");
    expect(container.textContent).not.toContain("Invalidated reply dependency");
    expect(readDraft(dependencyScope).pendingPayload).toBe(frozen);
    expect(readDraft(threadScope).body).toBe("Authored thread survives");
    expect(readDraft(threadScope).pendingPayload).toBe(frozen);
    if (c.kind === "message_edited") {
      state.events = [];
      state.thread = vi.fn(async () => ({
        root: currentRoot,
        messages: [dependencyReply],
      }));
      await act(async () => openReplyThread());
      expect(container.textContent).toContain(
        "Reply to Current authorized root",
      );
      expect(readDraft(dependencyScope).body).toBe(frozen.body);
      expect(readDraft(dependencyScope).pendingPayload).toBe(frozen);
    }
  },
);
it("allows a current pending thread through unrelated source invalidation", async () => {
  let release: (v: any) => void = () => {};
  state.rows = [dependencyReply];
  state.thread = vi.fn(() => new Promise((r) => (release = r)));
  await act(async () => root.render(<NativeConversation />));
  await act(async () => openReplyThread());
  await act(async () =>
    writeDraft(dependencyScope, { body: "Unrelated authored draft" }),
  );
  state.events = [{ kind: "message_removed", messageId: "unrelated" }];
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  await act(async () =>
    release({
      root: { ...dependencyRoot, body: "Current unrelated thread" },
      messages: [dependencyReply],
    }),
  );
  expect(container.textContent).toContain("Reply to Current unrelated thread");
  expect(readDraft(dependencyScope).body).toBe("Unrelated authored draft");
});

it("hydrates a confirmed thread reply and retires send despite a later thread GET outage", async () => {
  state.rows = [dependencyRoot];
  state.loseFirstPost = false;
  let releaseHistory: () => void = () => {};
  state.thread = vi
    .fn()
    .mockResolvedValueOnce({ root: dependencyRoot, messages: [] })
    .mockImplementationOnce(async () => {
      state.events = [
        { kind: "message_created", messageId: dependencyReply.id },
      ];
      state.metadataGate = new Promise((r) => (releaseHistory = r));
      return {
        root: dependencyRoot,
        messages: [{ ...dependencyReply, body: "Confirmed thread text" }],
      };
    })
    .mockImplementationOnce(async () => {
      state.events = [];
      return {
        root: dependencyRoot,
        messages: [{ ...dependencyReply, body: "Confirmed thread text" }],
      };
    })
    .mockRejectedValueOnce(Error("Thread GET unavailable"));
  await act(async () => root.render(<NativeConversation />));
  await act(async () => openReplyThread());
  async function send(body: string) {
    const input = [
      ...container.querySelectorAll<HTMLTextAreaElement>(
        'textarea[aria-label="Message"]',
      ),
    ].at(-1)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, body);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      [...container.querySelectorAll("button")]
        .filter((b) => b.textContent === "Send")
        .at(-1)!
        .click(),
    );
  }
  await send("Confirmed thread text");
  await act(async () => {
    state.metadataGate = null;
    releaseHistory();
  });
  expect(
    container.querySelector('[aria-label="Thread"]')?.textContent,
  ).toContain("Confirmed thread text");
  expect(state.thread).toHaveBeenCalledTimes(3);
  expect(state.posts).toHaveLength(1);
  await send("Second confirmed thread text");
  expect(state.posts).toHaveLength(2);
  expect(
    [
      ...container.querySelectorAll<HTMLTextAreaElement>(
        'textarea[aria-label="Message"]',
      ),
    ].at(-1)?.value,
  ).toBe("");
  expect(container.textContent).not.toContain("Retry same message");
});

it.each(["message_edited", "message_removed", "message_created"])(
  "retains an ordinary incoming reply but invalidates a loaded thread on %s with changed source",
  async (kind) => {
    state.rows = [dependencyRoot];
    state.thread = vi
      .fn()
      .mockResolvedValue({ root: dependencyRoot, messages: [dependencyReply] });
    await act(async () => root.render(<NativeConversation />));
    await act(async () => openReplyThread());
    expect(container.querySelector('[aria-label="Thread"]')).toBeTruthy();
    const incoming = {
      ...dependencyReply,
      id: "incoming",
      sequence: 3,
      body: "New authorized incoming reply",
    };
    state.thread = vi
      .fn()
      .mockResolvedValue({
        root: dependencyRoot,
        messages: [dependencyReply, incoming],
      });
    state.events = [{ kind: "message_created", messageId: "incoming" }];
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(
      container.querySelector('[aria-label="Thread"]')?.textContent,
    ).toContain(incoming.body);
    state.events = [{ kind, messageId: "incoming" }];
    state.thread = vi
      .fn()
      .mockResolvedValue({
        root: dependencyRoot,
        messages: [
          dependencyReply,
          { ...incoming, revision: 2, body: "Changed source" },
        ],
      });
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(container.querySelector('[aria-label="Thread"]')).toBeNull();
  },
);
