// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceProvider, useWorkspace } from "./Workspace";
import IntelligenceScreen from "./IntelligenceScreen";
import { client, NativeApiError } from "./client";
import { clearAllDrafts } from "./conversationDrafts";
import { clearAllBusinessAttempts } from "../../shared/business/attempts";
const env = vi.hoisted(() => ({ state: (_s: string) => {} }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("./capture", () => ({
  setCaptureContext: () => {},
  clearCaptures: () => {},
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
vi.mock("@react-native-community/datetimepicker", () => ({
  default: () => null,
}));
vi.mock("./reportClient", () => ({
  ReportTransfer: class {
    cancel = vi.fn().mockResolvedValue(undefined);
    share = vi.fn();
  },
}));
vi.mock("./AttentionInbox", () => ({ default: () => null }));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  Sheet: ({ children }: any) => createElement("section", {}, children),
}));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_e: string, fn: (s: string) => void) => {
      env.state = fn;
      return { remove() {} };
    },
  },
  Platform: { OS: "android" },
  StyleSheet: { create: (s: any) => s },
  Alert: { alert: vi.fn() },
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  Button: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  ScrollView: ({ children }: any) => createElement("div", {}, children),
  FlatList: ({
    data,
    renderItem,
    ListHeaderComponent,
    ListFooterComponent,
  }: any) =>
    createElement(
      "div",
      {},
      ListHeaderComponent,
      ...data.map((item: any) => renderItem({ item })),
      ListFooterComponent,
    ),
  TextInput: ({ value, onChangeText, accessibilityLabel }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      onInput: (e: any) => onChangeText(e.target.value),
    }),
}));
let root: Root, c: HTMLDivElement, w: ReturnType<typeof useWorkspace>;
let basis: string,
  actor: string,
  events: any[],
  activeJob: any,
  holdRaw: boolean,
  holdBootstrap: boolean,
  holdPreview: boolean;
let rawWaiters: ((v: unknown) => void)[],
  bootstrapWaiters: ((v: unknown) => void)[],
  previewFinish: (v: unknown) => void;
let request: ReturnType<typeof vi.spyOn>;
let holdActions = false;
let actionRows: { id: string; title: string; sourceRevision: number }[] = [];
let actionWaiters: ((v: unknown) => void)[] = [];
let rawFailure: boolean,
  publishLoss: boolean,
  holdProof: boolean,
  submissions: unknown[],
  proofWaiters: ((v: unknown) => void)[],
  previewReject: (e: unknown) => void;
const owner = {
  id: "actor",
  name: "Human owner",
  role: "founder",
  active: true,
  memberAccessEpoch: 1,
  companyPermissionEpoch: 1,
  departmentId: "",
  managerId: "",
};
const reviewer = {
  ...owner,
  id: "reviewer",
  name: "Independent reviewer",
  role: "head",
};
const fixtureJob = {
  jobId: "job",
  state: "ready",
  resultHash: "result",
  sourceSetHash: "set",
  sources: [
    {
      sourceKey: "source",
      kind: "record",
      id: "record",
      revision: 1,
      label: "Private source label",
    },
  ],
  publication: {
    allowed: true,
    conversationId: "conversation",
    policyVersion: 2,
    sources: [{ messageId: "message", revision: 1 }],
  },
  result: {
    operation: "action_draft",
    sourceSetHash: "set",
    limitations: [],
    candidates: [
      {
        kind: "task",
        title: "Generated seed",
        description: "Private generated suggestion",
        sourceKeys: ["source"],
        unresolved: [],
      },
      {
        kind: "task",
        title: "Second candidate",
        description: "Other suggestion",
        sourceKeys: ["source"],
        unresolved: [],
      },
    ],
  },
};
const preview = {
  audienceUserIds: ["actor", "reviewer"],
  notice: "Inspected private audience",
  intelligenceReviewHash: "review",
};
const bootstrap = () => ({
  readBasis: basis,
  me: { ...owner, id: actor },
  people: [owner, reviewer],
  tasks: [],
  expenses: [],
  departments: [],
  expenseCategories: [],
  company: { id: "co", timezone: "Asia/Kolkata", currency: "INR" },
});
function Probe() {
  const current = useWorkspace();
  useLayoutEffect(() => {
    w = current;
  });
  return <IntelligenceScreen initialJob="job" />;
}
async function mount() {
  await act(async () =>
    root.render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    ),
  );
}
const button = (text: string) =>
  [...c.querySelectorAll("button")].find((b) => b.textContent === text);
async function click(text: string) {
  await act(async () => {
    const b = button(text);
    expect(b).toBeDefined();
    expect(b!.disabled).toBe(false);
    b!.click();
  });
}
async function input(label: string, value: string) {
  await act(async () => {
    const e = c.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    e.value = value;
    e.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function inspect() {
  await click("Review task draft");
  await input("Reviewed intelligence title", "Human inspected title");
  await input(
    "Reviewed intelligence description",
    "Human inspected description",
  );
  await click("Source anchor: Choose");
  await click("Selected message 1 (revision 1)");
  await click("Instruction action: Choose");
  await click("Primary instruction");
  await click("Intelligence owner: Choose person");
  await click("Human owner · founder");
  await click("Intelligence reviewer: Choose person");
  await click("Independent reviewer · head");
  await input("Intelligence deadline", "2026-11-15");
  await click("Preview content and audience");
}
async function releaseRaw() {
  holdRaw = false;
  await act(async () =>
    rawWaiters
      .splice(0)
      .forEach((r) => r(JSON.parse(JSON.stringify(activeJob)))),
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  clearAllDrafts();
  clearAllBusinessAttempts();
  client.clearGeneration();
  client.token = "synthetic-test-token";
  client.endpoint = "https://owned.test";
  basis = "basis";
  actor = "actor";
  events = [];
  activeJob = JSON.parse(JSON.stringify(fixtureJob));
  holdRaw = false;
  holdBootstrap = false;
  holdPreview = false;
  rawWaiters = [];
  bootstrapWaiters = [];
  previewFinish = () => {};
  previewReject = () => {};
  rawFailure = false;
  holdActions = false;
  actionRows = [];
  actionWaiters = [];
  publishLoss = false;
  holdProof = false;
  submissions = [];
  proofWaiters = [];
  vi.spyOn(client, "restore").mockResolvedValue();
  request = vi
    .spyOn(client, "request")
    .mockImplementation(
      async (path: string, method?: string, body?: unknown) => {
        if (path === "/auth/session")
          return {
            user: { id: actor, name: "Test user" },
            companies: [{ id: "co", name: "Test company" }],
          } as any;
        if (path === "/devices") return { id: "device" } as any;
        if (path.endsWith("/bootstrap"))
          return holdBootstrap
            ? new Promise((r) => bootstrapWaiters.push(r))
            : (bootstrap() as any);
        if (path.endsWith("/jobs/job")) {
          if (rawFailure)
            throw new NativeApiError(
              404,
              "not_found",
              "Current source unavailable",
            );
          return holdRaw
            ? new Promise((r) => rawWaiters.push(r))
            : JSON.parse(JSON.stringify(activeJob));
        }
        if (path.includes("/work-actions?"))
          return holdActions
            ? new Promise((r) => actionWaiters.push(r))
            : ({ actions: JSON.parse(JSON.stringify(actionRows)) } as any);
        if (path.endsWith("/task-conversions/preview"))
          return holdPreview
            ? new Promise((r, j) => {
                previewFinish = r;
                previewReject = j;
              })
            : ({ ...preview } as any);
        if (path.endsWith("/task-conversions") && method === "POST") {
          submissions.push(body);
          if (publishLoss) {
            publishLoss = false;
            throw Error("Synthetic lost ACK");
          }
          return { id: "created" } as any;
        }
        if (path.endsWith("/publication-access"))
          return holdProof
            ? new Promise((r) => proofWaiters.push(r))
            : ({ current: true, committed: true } as any);
        if (path.endsWith("/capabilities"))
          return { operations: { action_draft: true } } as any;
        if (path.endsWith("/intelligence/jobs")) return { jobs: [] } as any;
        if (path.endsWith("/communication/inbox"))
          return { events: JSON.parse(JSON.stringify(events)) } as any;
        if (path.endsWith("/conversations"))
          return { conversations: [], cursor: "", hasMore: false } as any;
        return { tasks: [], expenses: [], cursor: "", hasMore: false } as any;
      },
    );
  c = document.createElement("div");
  document.body.append(c);
  root = createRoot(c);
});
afterEach(async () => {
  await act(async () => root.unmount());
  c.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  client.token = "";
  client.clearGeneration();
  clearAllDrafts();
  clearAllBusinessAttempts();
});
it.each([false, true])(
  "actual Workspace ordinary15s refresh and5s polling preserve inspected native review (overlap=%s)",
  async (overlap) => {
    await mount();
    expect(w.foreground).toBe(true);
    holdPreview = overlap;
    await inspect();
    if (!overlap) await click("I reviewed these fields and this audience");
    const editor = c.querySelector<HTMLInputElement>(
      '[aria-label="Reviewed intelligence title"]',
    )!;
    editor.focus();
    const oldAttention = w.attentionEpoch,
      oldExecution = w.executionEpoch;
    const initialCalls = request.mock.calls.filter(([p]: unknown[]) =>
      String(p).endsWith("/bootstrap"),
    ).length;
    holdRaw = true;
    holdBootstrap = true;
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(
      request.mock.calls.filter(([p]: unknown[]) =>
        String(p).endsWith("/bootstrap"),
      ).length,
    ).toBeGreaterThan(initialCalls);
    expect(rawWaiters.length).toBeGreaterThan(0);
    expect(bootstrapWaiters.length).toBeGreaterThan(0);
    if (overlap) await act(async () => previewFinish({ ...preview }));
    expect(c.textContent).not.toContain("Inspected private audience");
    expect(c.textContent).not.toContain("Private source label");
    expect(c.textContent).not.toContain("Private generated suggestion");
    expect(button("Confirm reviewed creation")!.disabled).toBe(true);
    expect(button("Preview content and audience")!.disabled).toBe(true);
    expect(c.querySelector('[aria-label="Reviewed intelligence title"]')).toBe(
      editor,
    );
    expect(editor.value).toBe("Human inspected title");
    expect(document.activeElement).toBe(editor);
    holdBootstrap = false;
    await act(async () =>
      bootstrapWaiters.splice(0).forEach((r) => r(bootstrap())),
    );
    expect(w.attentionEpoch).toBeGreaterThan(oldAttention);
    expect(w.executionEpoch).toBeGreaterThan(oldExecution);
    await releaseRaw();
    expect(c.textContent).toContain("Inspected private audience");
    if (overlap) await click("I reviewed these fields and this audience");
    // A second complete ordinary cycle must also keep the already inspected ACK.
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(c.textContent).toContain("Inspected private audience");
    expect(button("Confirm reviewed creation")!.disabled).toBe(false);
    await click("Confirm reviewed creation");
    expect(c.textContent).toContain("Created work successfully.");
    expect(
      request.mock.calls.filter(
        ([p, m]: unknown[]) =>
          String(p).endsWith("/task-conversions") && m === "POST",
      ),
    ).toHaveLength(1);
  },
);
it("actual business notification only triggers current source reauthorization", async () => {
  await mount();
  await inspect();
  await click("I reviewed these fields and this audience");
  const before = w.recordEpoch;
  events = [
    {
      eventId: "new-event",
      conversationId: "conversation",
      kind: "record_response",
      read: false,
    },
  ];
  holdRaw = true;
  await act(async () => w.refresh());
  expect(w.recordEpoch).toBeGreaterThan(before);
  expect(c.textContent).not.toContain("Inspected private audience");
  expect(button("Confirm reviewed creation")!.disabled).toBe(true);
  await releaseRaw();
  expect(c.textContent).toContain("Inspected private audience");
  expect(button("Confirm reviewed creation")!.disabled).toBe(false);
});
it.each(
  [
    "source",
    "result",
    "basis",
    "policy",
    "actor",
    "client",
    "hard",
    "candidate",
    "edit",
    "foreground",
    "unmount",
    "denial",
  ].flatMap((change) => [false, true].map((error) => ({ change, error }))),
)(
  "actual producer opposite $change rejects late preview (error=$error)",
  async ({ change, error }) => {
    await mount();
    holdPreview = true;
    await inspect();
    if (
      change === "source" ||
      change === "result" ||
      change === "basis" ||
      change === "denial"
    ) {
      if (change === "source") activeJob.publication.sources[0].revision++;
      if (change === "result") activeJob.resultHash = "changed-result";
      if (change === "basis") basis = "changed-authorization-basis";
      if (change === "denial") rawFailure = true;
      events = [
        {
          eventId: "changed-event",
          conversationId: "conversation",
          kind: "record_revised",
          read: false,
        },
      ];
      await act(async () => w.refresh());
    }
    if (change === "policy") await act(async () => w.invalidatePrivateViews());
    if (change === "actor") {
      await act(async () => env.state("background"));
      actor = "other-actor";
      await act(async () => env.state("active"));
    }
    if (change === "client") {
      client.clearGeneration();
      await act(async () => w.refresh());
    }
    if (change === "hard") await act(async () => clearAllBusinessAttempts());
    if (change === "candidate")
      await act(async () =>
        [...c.querySelectorAll("button")]
          .filter((b) => b.textContent === "Review task draft")[1]
          .click(),
      );
    if (change === "edit")
      await input("Reviewed intelligence title", "New human intent");
    if (change === "foreground") await act(async () => env.state("background"));
    if (change === "unmount") {
      await act(async () => root.render(<div />));
      await mount();
    }
    await act(async () => {
      if (error) previewReject(Error("Obsolete preview failure"));
      else previewFinish({ ...preview });
    });
    expect(c.textContent).not.toContain("Inspected private audience");
    expect(c.textContent).not.toContain("Obsolete preview failure");
    expect(button("I reviewed these fields and this audience")).toBeUndefined();
    expect(button("Confirm reviewed creation")?.disabled ?? true).toBe(true);
    expect(submissions).toHaveLength(0);
  },
);
it("actual Workspace refresh keeps unknown original canonical body gated by independent proof", async () => {
  await mount();
  await inspect();
  await click("I reviewed these fields and this audience");
  publishLoss = true;
  holdProof = true;
  await click("Confirm reviewed creation");
  expect(submissions).toHaveLength(1);
  await input("Reviewed intelligence title", "Later visible edit");
  holdActions = true; // Unknown retry is governed by independent proof, not this fresh-review read.
  holdRaw = true;
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(button("Retry original submitted draft")!.disabled).toBe(true);
  expect(c.textContent).not.toContain("Inspected private audience");
  await releaseRaw();
  expect(button("Retry original submitted draft")!.disabled).toBe(true);
  holdProof = false;
  await act(async () =>
    proofWaiters
      .splice(0)
      .forEach((r) => r({ current: true, committed: true })),
  );
  await click("Retry original submitted draft");
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toEqual(submissions[0]);
  expect(c.textContent).toContain("Created work successfully.");
});

it("actual refresh gates inspected private audience until current supported actions return", async () => {
  await mount();
  await inspect();
  await click("I reviewed these fields and this audience");
  holdActions = true;
  await act(async () => w.refresh());
  expect(actionWaiters.length).toBeGreaterThan(0);
  expect(c.textContent).not.toContain("Inspected private audience");
  expect(button("Preview content and audience")!.disabled).toBe(true);
  expect(button("Confirm reviewed creation")!.disabled).toBe(true);
  holdActions = false;
  await act(async () =>
    actionWaiters.splice(0).forEach((r) => r({ actions: [] })),
  );
  expect(c.textContent).toContain("Inspected private audience");
  expect(button("Confirm reviewed creation")!.disabled).toBe(false);
});

it("current action removal keeps prior inspected audience and fresh confirmation withheld", async () => {
  actionRows = [
    { id: "alternate", title: "Supported alternate", sourceRevision: 1 },
  ];
  await mount();
  await inspect();
  await click("Instruction action: Primary instruction");
  await click("Supported alternate");
  await click("Preview content and audience");
  await click("I reviewed these fields and this audience");
  actionRows = [];
  await act(async () => w.refresh());
  expect(c.textContent).not.toContain("Inspected private audience");
  expect(button("Confirm reviewed creation")!.disabled).toBe(true);
  expect(submissions).toHaveLength(0);
});
