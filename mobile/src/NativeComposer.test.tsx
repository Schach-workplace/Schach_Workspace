// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import NativeComposer from "./NativeComposer";
import { WorkspaceProvider, useWorkspace } from "./Workspace";
import { client } from "./client";
import { clearAllDrafts, readDraft } from "./conversationDrafts";
const env = vi.hoisted(() => ({
  appState: (_s: string) => {},
  inputs: new Map<string, (v: string) => void>(),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
vi.mock("./capture", () => ({
  clearCaptures: () => {},
  setCaptureContext: () => {},
  recoverCamera: async () => null,
}));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("expo-notifications", () => ({
  getLastNotificationResponseAsync: async () => null,
  addNotificationReceivedListener: () => ({ remove() {} }),
  addNotificationResponseReceivedListener: () => ({ remove() {} }),
  addPushTokenListener: () => ({ remove() {} }),
  setNotificationHandler: () => {},
  getPermissionsAsync: async () => ({ granted: false }),
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: any) => createElement("div", {}, children),
}));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  Sheet: ({ children }: any) => createElement("section", {}, children),
}));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_e: any, fn: any) => {
      env.appState = fn;
      return { remove() {} };
    },
  },
  Platform: { OS: "android" },
  StyleSheet: { create: (s: any) => s },
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  ScrollView: ({ children }: any) => createElement("div", {}, children),
  Button: ({ title, onPress }: any) =>
    createElement("button", { onClick: onPress }, title),
  TextInput: ({ accessibilityLabel, value, onChangeText, editable }: any) => {
    env.inputs.set(accessibilityLabel, onChangeText);
    return createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      disabled: editable === false,
      readOnly: true,
    });
  },
  FlatList: ({ data, renderItem }: any) =>
    createElement("div", {}, ...data.map((item: any) => renderItem({ item }))),
}));
function ConversationInput() {
  const w = useWorkspace();
  const [reply, setReply] = useState<any>(null);
  const scope = {
    serverOrigin: client.endpoint,
    companyId: w.company,
    userId: w.session!.user.id,
    conversationId: w.selected,
  };
  return (
    <>
      <button
        onClick={() =>
          setReply({ id: "selected-source", body: "Selected source" })
        }
      >
        Select reply
      </button>
      <NativeComposer
        scope={scope}
        reply={reply}
        disabled={false}
        members={[{ userId: "person", active: true } as any]}
        names={{ person: "Selected person" }}
        canMentionAll={false}
        onSend={(input) =>
          client.request(
            `/companies/${w.company}/conversations/${w.selected}/messages`,
            "POST",
            input,
          )
        }
      />
    </>
  );
}
function Navigation() {
  const w = useWorkspace();
  return (
    <>
      <button onClick={() => w.select("a")}>Open A</button>
      <button onClick={() => w.select("b")}>Open B</button>
      {w.foreground && w.selected && <ConversationInput key={w.selected} />}
    </>
  );
}
afterEach(() => {
  clearAllDrafts();
  env.inputs.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  client.token = "";
  client.clearGeneration();
});
it("keeps selected reply and mentions frozen across provider A B A and a recoverable poll, then retires confirmed send", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  client.endpoint = "https://fixture.test";
  client.token = "token";
  vi.spyOn(client, "restore").mockResolvedValue();
  const canonical = new Map<string, any>();
  const posts: any[] = [];
  let offline = false;
  const session = {
    user: { id: "u", name: "User" },
    companies: [{ id: "c", name: "Company" }],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: any) => {
      if (offline) throw Error("Offline poll");
      const path = url.split("/api")[1];
      let body: any;
      if (path === "/auth/session") body = session;
      else if (path === "/devices") body = { id: "device" };
      else if (path.endsWith("/bootstrap"))
        body = {
          readBasis: "same",
          me: { id: "u", role: "member" },
          people: [],
          tasks: [],
          expenses: [],
          company: { id: "c", timezone: "Asia/Kolkata" },
        };
      else if (path.endsWith("/messages")) {
        const input = JSON.parse(options.body);
        posts.push(input);
        canonical.set(input.clientMessageId, input);
        if (posts.length === 1) throw Error("Committed ACK lost");
        body = { message: { id: "canonical", ...input } };
      } else if (path.includes("/conversations"))
        body = { conversations: [], cursor: "", hasMore: false };
      else if (path.endsWith("/inbox")) body = { events: [] };
      else body = { tasks: [], expenses: [], cursor: "", hasMore: false };
      return { ok: true, json: async () => body };
    }),
  );
  const container = document.createElement("div");
  const root = createRoot(container);
  const click = async (title: string) =>
    act(async () => {
      const b = [...container.querySelectorAll("button")].find(
        (b) => b.textContent === title,
      )!;
      expect(b.disabled).toBe(false);
      b.click();
    });
  try {
    await act(async () =>
      root.render(
        <WorkspaceProvider>
          <Navigation />
        </WorkspaceProvider>,
      ),
    );
    await click("Open A");
    await click("Select reply");
    await click("@ Mention");
    await click("Selected person");
    await click("Done");
    await act(async () => env.inputs.get("Message")!("Authored A"));
    await act(async () => {
      const send = [...container.querySelectorAll("button")].find(
        (b) => b.textContent === "Send",
      )!;
      send.click();
      send.click();
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      replyToId: "selected-source",
      mentionIds: ["person"],
    });
    expect(container.textContent).toContain("Retry same");
    expect(container.textContent).not.toContain("Mention everyone");
    offline = true;
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    offline = false;
    await click("Open B");
    await act(async () => env.inputs.get("Message")!("Authored B"));
    await click("Open A");
    expect(
      (
        container.querySelector(
          'input[aria-label="Message"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("Authored A");
    await click("Retry same message");
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
    expect(canonical.size).toBe(1);
    expect(
      readDraft({
        serverOrigin: client.endpoint,
        companyId: "c",
        userId: "u",
        conversationId: "a",
      }).pendingPayload,
    ).toBeNull();
    await click("Open B");
    expect(
      (
        container.querySelector(
          'input[aria-label="Message"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("Authored B");
  } finally {
    await act(async () => root.unmount());
  }
});

it("searches only active authorized mention participants and keeps selected chips while controlling manager all", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const c = document.createElement("div");
  const root = createRoot(c);
  const scope = {
    serverOrigin: "https://fixture",
    companyId: "c",
    userId: "u",
    conversationId: "mentions",
  };
  const props = {
    scope,
    disabled: false,
    reply: null,
    onSend: vi.fn(),
    members: [
      { userId: "a", active: true },
      { userId: "b", active: true },
      { userId: "inactive", active: false },
    ] as any,
    names: { a: "Anita", b: "Bala", inactive: "Inactive" },
  };
  const click = async (title: string) =>
    act(async () =>
      [...c.querySelectorAll("button")]
        .find((b) => b.textContent === title)!
        .click(),
    );
  try {
    await act(async () =>
      root.render(<NativeComposer {...props} canMentionAll={false} />),
    );
    await click("@ Mention");
    expect(c.textContent).not.toContain("Inactive");
    expect(c.textContent).not.toContain("Mention everyone");
    await act(async () => env.inputs.get("Find participant")!("ani"));
    expect(c.textContent).not.toContain("Bala");
    await click("Anita");
    await click("Done");
    expect(readDraft(scope).mentionIds).toEqual(["a"]);
    await act(async () =>
      root.render(<NativeComposer {...props} canMentionAll />),
    );
    await click("@ Mentions ✓");
    expect(c.textContent).toContain("Selected: Anita");
    await click("Mention everyone");
    expect(readDraft(scope).mentionAll).toBe(true);
    expect(c.textContent).toContain("once per five minutes");
  } finally {
    await act(async () => root.unmount());
  }
});
