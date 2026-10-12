// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceProvider, useWorkspace } from "./Workspace";
import ReportScreen from "./ReportScreen";
import IntelligenceScreen from "./IntelligenceScreen";
import { client, NativeApiError } from "./client";
import { clearAllDrafts } from "./conversationDrafts";
import { clearAllBusinessAttempts } from "../../shared/business/attempts";

// Only native adapters and HTTP are replaced. Workspace, the report read,
// launcher, Sheet, Source anchor/ReportChoice, and job polling are real owners.
const native = vi.hoisted(() => ({ state: (_s: string) => {} }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-router", () => ({ router: { push: vi.fn(), back: vi.fn() } }));
vi.mock("expo-image-picker", () => ({
  getPendingResultAsync: async () => null,
}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-file-system", () => ({ File: class {}, Paths: {} }));
vi.mock("expo-file-system/legacy", () => ({}));
vi.mock("expo-sharing", () => ({}));
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
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_e: string, fn: (s: string) => void) => {
      native.state = fn;
      return { remove() {} };
    },
  },
  Platform: { OS: "android" },
  StyleSheet: { create: (s: any) => s },
  Alert: { alert: vi.fn() },
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  ScrollView: ({ children }: any) => createElement("div", {}, children),
  KeyboardAvoidingView: ({ children }: any) =>
    createElement("div", {}, children),
  Modal: ({ children, visible }: any) =>
    visible ? createElement("section", { role: "dialog" }, children) : null,
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
    accessibilityState,
  }: any) =>
    createElement(
      "button",
      {
        onClick: onPress,
        disabled,
        "aria-label": accessibilityLabel,
        "aria-pressed": accessibilityState?.selected,
      },
      children,
    ),
  Button: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  FlatList: ({
    data,
    renderItem,
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent,
    keyExtractor,
  }: any) =>
    createElement(
      "div",
      {},
      ListHeaderComponent,
      data.length
        ? data.map((item: any, index: number) =>
            createElement(
              "div",
              { key: keyExtractor?.(item, index) ?? index },
              renderItem({ item, index }),
            ),
          )
        : ListEmptyComponent,
      ListFooterComponent,
    ),
  TextInput: ({ value, onChangeText, accessibilityLabel, editable }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      disabled: editable === false,
      onInput: (e: any) => onChangeText(e.target.value),
    }),
}));

const person = {
  id: "actor",
  name: "Human owner",
  role: "founder",
  active: true,
  memberAccessEpoch: 1,
  companyPermissionEpoch: 1,
  departmentId: "",
  managerId: "",
  membershipId: "member",
  email: "actor@example.test",
  title: "",
  capacityHours: 40,
  membershipVersion: 1,
};
const privateJob = {
  jobId: "job",
  state: "ready",
  resultHash: "result",
  sourceSetHash: "source-set",
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
    sourceSetHash: "source-set",
    limitations: [],
    candidates: [
      {
        kind: "expense",
        title: "Generated expense",
        description: "Private generated suggestion",
        sourceKeys: ["source"],
        unresolved: [],
      },
      {
        kind: "expense",
        title: "Second expense",
        description: "Other suggestion",
        sourceKeys: ["source"],
        unresolved: [],
      },
    ],
  },
};
const reportJob = {
  jobId: "job",
  state: "running",
  operation: "report_explanation",
  sourceSetHash: "report-set",
  sources: [
    {
      sourceKey: "report",
      kind: "report_current",
      id: "snapshot-one",
      label: "Original report citation",
    },
  ],
};
const reportReady = {
  ...reportJob,
  state: "ready",
  resultHash: "report-result",
  result: {
    operation: "report_explanation",
    limitations: [],
    items: [{ text: "Original period facts: 2 of 3", sourceKeys: ["report"] }],
  },
};
const reportPreview = {
  selectionHash: "selection-one",
  policyVersion: 1,
  expiresAt: "2026-10-12T06:05:00Z",
  sources: [
    {
      kind: "report_current",
      id: "snapshot-one",
      label: "Inspected original report facts",
    },
  ],
};
type Waiter = { resolve: (value: any) => void; reject: (reason: any) => void };
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
let root: Root,
  container: HTMLDivElement,
  workspace: ReturnType<typeof useWorkspace>;
let actor: string, basis: string, snapshot: string, activeJob: any;
let reportHold: boolean,
  rawHold: boolean,
  reportDenied: boolean,
  rawDenied: boolean,
  previewHold: boolean,
  enqueueLoss: boolean;
let reportWaiters: Waiter[], rawWaiters: Waiter[], previewWaiters: Waiter[];
let enqueues: any[], inspections: any[];
let reportSequence: number, latestSnapshot: string;
let originalExpiry: string;
let originalProof:
  "current" | "hash" | "policy" | "source" | "expired" | "removed" | "acl";
// Like report_reads.go, every completed summary GET issues a fresh nonce while
// the deliberately selected original snapshot remains independently readable.
const reportSummary = () => ({
  snapshot: (latestSnapshot =
    ++reportSequence === 1 ? snapshot : `${snapshot}-nonce-${reportSequence}`),
});
function selectedPreview(body: any) {
  if (body.sources[0]?.id !== "snapshot-one")
    return {
      ...copy(reportPreview),
      selectionHash: body.sources[0]?.id,
      sources: [{ label: "Inspected latest report facts" }],
    };
  if (["source", "expired", "removed", "acl"].includes(originalProof))
    throw new NativeApiError(
      originalProof === "removed" ? 404 : originalProof === "acl" ? 403 : 409,
      "source_unavailable",
      "Selected report unavailable",
    );
  return {
    ...copy(reportPreview),
    expiresAt: originalExpiry,
    selectionHash:
      originalProof === "hash"
        ? "changed-selection"
        : reportPreview.selectionHash,
    policyVersion: originalProof === "policy" ? 2 : reportPreview.policyVersion,
  };
}
const bootstrap = () => ({
  readBasis: basis,
  me: { ...person, id: actor },
  people: [person],
  tasks: [],
  expenses: [],
  departments: [],
  expenseCategories: [],
  company: {
    id: workspace?.company || "co",
    timezone: "Asia/Kolkata",
    currency: "INR",
  },
});
function Owner({ report }: { report: boolean }) {
  const current = useWorkspace();
  useLayoutEffect(() => {
    workspace = current;
  });
  return report ? <ReportScreen /> : <IntelligenceScreen initialJob="job" />;
}
async function mount(report = true) {
  await act(async () =>
    root.render(
      <WorkspaceProvider>
        <Owner report={report} />
      </WorkspaceProvider>,
    ),
  );
}
const button = (text: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === text);
async function click(text: string) {
  await act(async () => {
    const control = button(text);
    expect(control, text).toBeDefined();
    expect(control!.disabled, text).toBe(false);
    control!.click();
  });
}
async function input(label: string, value: string) {
  await act(async () => {
    const field = container.querySelector<HTMLInputElement>(
      `[aria-label="${label}"]`,
    )!;
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function openReport() {
  await mount();
  await click("Local assistance");
  await click("Current month report facts");
  await click("Review selected sources");
  expect(button("Generate local result")!.disabled).toBe(true);
  await click("I agree to local processing of these selected sources");
}
async function releaseReport() {
  reportHold = false;
  await act(async () =>
    reportWaiters.splice(0).forEach((w) => w.resolve(reportSummary())),
  );
}
async function releaseRaw() {
  rawHold = false;
  await act(async () =>
    rawWaiters.splice(0).forEach((w) => w.resolve(copy(activeJob))),
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T06:00:00Z"));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  clearAllDrafts();
  clearAllBusinessAttempts();
  client.clearGeneration();
  client.token = "synthetic-test-token";
  client.endpoint = "https://owned.test";
  actor = "actor";
  basis = "basis";
  snapshot = "snapshot-one";
  reportSequence = 0;
  originalProof = "current";
  originalExpiry = reportPreview.expiresAt;
  activeJob = copy(reportJob);
  reportHold =
    rawHold =
    previewHold =
    reportDenied =
    rawDenied =
    enqueueLoss =
      false;
  reportWaiters = [];
  rawWaiters = [];
  previewWaiters = [];
  enqueues = [];
  inspections = [];
  vi.spyOn(client, "restore").mockResolvedValue();
  vi.spyOn(client, "request").mockImplementation(
    async (path: string, method?: string, body?: unknown) => {
      if (path === "/auth/session")
        return {
          user: { id: actor, name: "Test user" },
          companies: [
            { id: "co", name: "Test company" },
            { id: "other", name: "Other company" },
          ],
        } as any;
      if (path === "/devices") return { id: "device" } as any;
      if (path.endsWith("/bootstrap")) return bootstrap() as any;
      if (path.includes("/reports/tasks/summary?")) {
        if (reportDenied)
          throw new NativeApiError(
            403,
            "access_changed",
            "Report access changed",
          );
        return reportHold
          ? new Promise((resolve, reject) =>
              reportWaiters.push({ resolve, reject }),
            )
          : (reportSummary() as any);
      }
      if (path.endsWith("/jobs/job")) {
        if (rawDenied)
          throw new NativeApiError(404, "not_found", "Source unavailable");
        return rawHold
          ? new Promise((resolve, reject) =>
              rawWaiters.push({ resolve, reject }),
            )
          : copy(activeJob);
      }
      if (path.endsWith("/selection-preview")) {
        inspections.push(copy(body));
        return previewHold
          ? new Promise((resolve, reject) =>
              previewWaiters.push({ resolve, reject }),
            )
          : (selectedPreview(body) as any);
      }
      if (path.endsWith("/intelligence/jobs") && method === "POST") {
        enqueues.push(copy(body));
        if (enqueueLoss) {
          enqueueLoss = false;
          throw Error("Synthetic lost enqueue acknowledgement");
        }
        return { jobId: "job" } as any;
      }
      if (path.endsWith("/capabilities"))
        return {
          operations: { report_explanation: true, action_draft: true },
        } as any;
      if (path.endsWith("/intelligence/jobs")) return { jobs: [] } as any;
      if (path.endsWith("/communication/inbox")) return { events: [] } as any;
      if (path.endsWith("/conversations"))
        return { conversations: [], cursor: "", hasMore: false } as any;
      return { tasks: [], expenses: [], cursor: "", hasMore: false } as any;
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  client.token = "";
  client.clearGeneration();
  clearAllDrafts();
  clearAllBusinessAttempts();
});

it("N2: real report Sheet and original running job survive ordinary Workspace refresh", async () => {
  await openReport();
  await click("Generate local result");
  const sheet = container.querySelector('[role="dialog"]');
  const recheck = button("Recheck current result");
  expect(container.textContent).toContain("running");
  expect(enqueues).toHaveLength(1);
  const submitted = copy(enqueues[0]);
  reportHold = true;
  rawHold = true;
  const epoch = workspace.executionEpoch;
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(workspace.executionEpoch).toBeGreaterThan(epoch);
  expect(reportWaiters.length).toBeGreaterThan(0);
  expect(rawWaiters.length).toBeGreaterThan(0);
  expect(container.querySelector('[role="dialog"]')).toBe(sheet);
  expect(button("Recheck current result")).toBe(recheck);
  expect(button("Close")).toBeDefined();
  expect(button("Cancel and clear this result")).toBeDefined();
  expect(button("Current month report facts")).toBeUndefined();
  expect(button("Review selected sources")!.disabled).toBe(true);
  activeJob = copy(reportReady);
  await releaseRaw();
  // Current raw proof can expose the original job even while the live report is pending.
  expect(container.textContent).toContain("Original period facts: 2 of 3");
  expect(button("Open Original report citation")).toBeDefined();
  await releaseReport();
  expect(container.querySelector('[role="dialog"]')).toBe(sheet);
  expect(button("Recheck current result")).toBe(recheck);
  expect(enqueues).toEqual([submitted]);
  expect(submitted.sources).toEqual([
    { kind: "report_current", id: "snapshot-one", selectedFieldSet: "metrics" },
  ]);
});

it("N2: inspected report consent is withheld during pending and restored only for the same current selection", async () => {
  await openReport();
  const sheet = container.querySelector('[role="dialog"]');
  reportHold = true;
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(container.querySelector('[role="dialog"]')).toBe(sheet);
  expect(container.textContent).not.toContain(
    "Inspected original report facts",
  );
  expect(button("Generate local result")?.disabled ?? true).toBe(true);
  expect(button("Review selected sources")!.disabled).toBe(true);
  expect(container.textContent).toContain("Explicit selected sources (1/50)");
  await releaseReport();
  expect(container.querySelector('[role="dialog"]')).toBe(sheet);
  expect(
    button(
      "I agree to local processing of these selected sources",
    )!.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(button("Generate local result")!.disabled).toBe(false);
  expect(enqueues).toHaveLength(0);
});

it("N2: ordinary rotating report handles preserve the exact selected snapshot only after independent current proof", async () => {
  await openReport();
  const sheet = container.querySelector('[role="dialog"]');
  for (let cycle = 0; cycle < 3; cycle++) {
    reportHold = true;
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(button("Generate local result")).toBeUndefined();
    previewHold = true;
    const before = inspections.length;
    await releaseReport();
    expect(container.querySelector('[role="dialog"]')).toBe(sheet);
    expect(latestSnapshot).not.toBe("snapshot-one");
    expect(inspections.length).toBeGreaterThan(before);
    expect(button("Generate local result")).toBeUndefined();
    expect(button("Selected report facts")).toBeUndefined();
    previewHold = false;
    await act(async () =>
      previewWaiters.splice(0).forEach((w) => w.resolve(copy(reportPreview))),
    );
    expect(button("Generate local result")?.disabled).toBe(false);
    expect(
      button(
        "I agree to local processing of these selected sources",
      )!.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(inspections.at(-1).sources).toEqual([
      {
        kind: "report_current",
        id: "snapshot-one",
        selectedFieldSet: "metrics",
      },
    ]);
  }
  await click("Generate local result");
  expect(enqueues).toHaveLength(1);
  expect(enqueues[0].sources).toEqual([
    { kind: "report_current", id: "snapshot-one", selectedFieldSet: "metrics" },
  ]);
});

it("N2b: first private Source anchor Sheet survives real polling with options withheld", async () => {
  activeJob = copy(privateJob);
  await mount(false);
  await click("Review expense draft");
  await input("Amount", "31.50");
  const amount = container.querySelector<HTMLInputElement>(
    '[aria-label="Amount"]',
  )!;
  amount.focus();
  await click("Source anchor: Choose");
  const picker = container.querySelector('[role="dialog"]');
  expect(picker?.textContent).toContain("Selected message 1 (revision 1)");
  rawHold = true;
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(rawWaiters.length).toBeGreaterThan(0);
  expect(container.querySelector('[role="dialog"]')).toBe(picker);
  expect(picker?.textContent).toContain("Checking current choices");
  expect(button("Selected message 1 (revision 1)")).toBeUndefined();
  expect(container.textContent).not.toContain("Private source label");
  expect(container.textContent).not.toContain("Private generated suggestion");
  expect(button("Preview content and audience")!.disabled).toBe(true);
  expect(container.querySelector('[aria-label="Amount"]')).toBe(amount);
  expect(amount.value).toBe("31.50");
  expect(document.activeElement).toBe(amount);
  await releaseRaw();
  expect(container.querySelector('[role="dialog"]')).toBe(picker);
  await click("Selected message 1 (revision 1)");
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(
    button("Source anchor: Selected message 1 (revision 1)"),
  ).toBeDefined();
  expect(enqueues).toHaveLength(0);
});

it.each(["hash", "policy", "expired", "removed", "acl"] as const)(
  "N2: exact original report %s change retires consent; latest choice requires human review",
  async (change) => {
    await openReport();
    const sheet = container.querySelector('[role="dialog"]');
    reportHold = true;
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    originalProof = change;
    await releaseReport();
    expect(container.querySelector('[role="dialog"]')).toBe(sheet);
    expect(button("Generate local result")).toBeUndefined();
    expect(container.textContent).not.toContain(
      "Inspected original report facts",
    );
    expect(inspections.at(-1).sources[0].id).toBe("snapshot-one");
    if (change !== "hash" && change !== "policy") {
      expect(button("Review selected sources")!.disabled).toBe(true);
      expect(button("Selected report facts")).toBeUndefined();
    }
    await click("Choose latest report facts");
    expect(button("Generate local result")).toBeUndefined();
    await click("Review selected sources");
    expect(inspections.at(-1).sources[0].id).toBe(latestSnapshot);
    expect(container.textContent).toContain("Inspected latest report facts");
    expect(button("Generate local result")!.disabled).toBe(true);
    expect(enqueues).toHaveLength(0);
    const chosenSnapshot = latestSnapshot;
    await click("I agree to local processing of these selected sources");
    await click("Generate local result");
    expect(enqueues).toHaveLength(1);
    expect(enqueues[0].sources[0].id).toBe(chosenSnapshot);
  },
);

it("N2: an expired selected proof cannot enqueue even before the next refresh renders", async () => {
  await openReport();
  vi.setSystemTime(new Date("2026-10-12T06:05:01Z"));
  await click("Generate local result");
  expect(enqueues).toHaveLength(0);
});

it("N2: selected proof expiry withholds the inspected preview and Generate without waiting for polling", async () => {
  originalExpiry = "2026-10-12T06:00:01Z";
  await openReport();
  const sheet = container.querySelector('[role="dialog"]');
  await act(async () => vi.advanceTimersByTimeAsync(1001));
  expect(container.querySelector('[role="dialog"]')).toBe(sheet);
  expect(button("Generate local result")).toBeUndefined();
  expect(button("Selected report facts")).toBeUndefined();
  expect(container.textContent).not.toContain(
    "Inspected original report facts",
  );
  expect(container.textContent).toContain(
    "Selected report facts are unavailable",
  );
  expect(enqueues).toHaveLength(0);
});

it("N2: a replaced report requires new selection, inspection and consent without replacing the owned job", async () => {
  await openReport();
  await click("Generate local result");
  const submitted = copy(enqueues[0]);
  const sheet = container.querySelector('[role="dialog"]');
  // A fresh inspection is independent of the already running attempt.
  await click("Review selected sources");
  await click("I agree to local processing of these selected sources");
  reportHold = true;
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  snapshot = "snapshot-two-with-new-facts";
  originalProof = "source";
  await releaseReport();
  expect(container.querySelector('[role="dialog"]')).toBe(sheet);
  expect(container.textContent).not.toContain(
    "Inspected original report facts",
  );
  expect(button("Generate local result")).toBeUndefined();
  expect(button("Review selected sources")!.disabled).toBe(true);
  expect(button("Selected report facts")).toBeUndefined();
  activeJob = copy(reportReady);
  await click("Recheck current result");
  expect(container.textContent).toContain("Original period facts: 2 of 3");
  expect(enqueues).toEqual([submitted]);
  await click("Choose latest report facts");
  await click("Review selected sources");
  expect(inspections.at(-1).sources).toEqual([
    {
      kind: "report_current",
      id: latestSnapshot,
      selectedFieldSet: "metrics",
    },
  ]);
  expect(button("Generate local result")!.disabled).toBe(true);
  expect(enqueues).toEqual([submitted]);
});

async function changeAuthority(change: string) {
  if (change === "company")
    await act(async () => workspace.switchCompany("other"));
  if (change === "policy")
    await act(async () => workspace.invalidatePrivateViews());
  if (change === "basis") {
    basis = "new-authorization-basis";
    await act(async () => workspace.refresh());
  }
  if (change === "client") {
    client.clearGeneration();
    await act(async () => workspace.refresh());
  }
  if (change === "session") await act(async () => client.onPolicyChange?.(401));
  if (change === "actor") {
    await act(async () => native.state("background"));
    actor = "another-actor";
    await act(async () => native.state("active"));
  }
  if (change === "foreground")
    await act(async () => native.state("background"));
  if (change === "unmount") {
    await act(async () => root.render(<div />));
    await mount();
  }
  if (change === "hard") await act(async () => clearAllBusinessAttempts());
}

it.each(
  [
    "source",
    "hash",
    "proofPolicy",
    "expired",
    "removed",
    "acl",
    "company",
    "actor",
    "policy",
    "basis",
    "client",
    "session",
    "foreground",
    "unmount",
    "denial",
    "selection",
    "hard",
  ].flatMap((change) => [false, true].map((error) => ({ change, error }))),
)(
  "N2: real report $change retires late inspection (error=$error)",
  async ({ change, error }) => {
    await openReport();
    previewHold = true;
    await click("Review selected sources");
    expect(previewWaiters).toHaveLength(1);
    if (
      ["source", "hash", "proofPolicy", "expired", "removed", "acl"].includes(
        change,
      )
    ) {
      snapshot = "changed-report";
      originalProof = (
        change === "proofPolicy" ? "policy" : change
      ) as typeof originalProof;
      previewHold = false;
      await act(async () => workspace.refresh());
    } else if (change === "denial") {
      reportDenied = true;
      await act(async () => workspace.refresh());
    } else if (change === "selection") {
      // Change operation through its actual picker while inspection is pending.
      await click("Operation: Explain selected facts");
      await click("Summarize selected sources");
    } else await changeAuthority(change);
    await act(async () =>
      previewWaiters
        .splice(0)
        .forEach((w) =>
          error
            ? w.reject(Error("Obsolete inspection failure"))
            : w.resolve(copy(reportPreview)),
        ),
    );
    expect(container.textContent).not.toContain(
      "Inspected original report facts",
    );
    expect(container.textContent).not.toContain("Obsolete inspection failure");
    expect(button("Generate local result")?.disabled ?? true).toBe(true);
    expect(enqueues).toHaveLength(0);
  },
);

it("N2: overlapping inspection settles hidden until equivalent current report proof", async () => {
  await mount();
  await click("Local assistance");
  await click("Current month report facts");
  previewHold = true;
  await click("Review selected sources");
  reportHold = true;
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  await act(async () =>
    previewWaiters.splice(0).forEach((w) => w.resolve(copy(reportPreview))),
  );
  expect(container.textContent).not.toContain(
    "Inspected original report facts",
  );
  expect(button("Generate local result")).toBeUndefined();
  previewHold = false;
  await releaseReport();
  expect(container.textContent).toContain("Inspected original report facts");
  expect(button("Generate local result")!.disabled).toBe(true);
  expect(
    button(
      "I agree to local processing of these selected sources",
    )!.getAttribute("aria-pressed"),
  ).toBe("false");
  expect(enqueues).toHaveLength(0);
});

it("N2: unknown enqueue keeps the original period, body and key through pending and new report facts", async () => {
  await openReport();
  enqueueLoss = true;
  await click("Generate local result");
  expect(enqueues).toHaveLength(1);
  expect(button("Retry original local request")).toBeDefined();
  const submitted = copy(enqueues[0]);
  reportHold = true;
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(button("Generate local result")?.disabled ?? true).toBe(true);
  snapshot = "new-period-snapshot";
  await releaseReport();
  await click("Choose latest report facts");
  await click("Retry original local request");
  expect(enqueues).toEqual([submitted, submitted]);
  expect(container.textContent).toContain("running");
});

it.each([
  "source",
  "result",
  "candidate",
  "company",
  "actor",
  "policy",
  "basis",
  "client",
  "session",
  "foreground",
  "denial",
  "hard",
])("N2b: actual %s change retires the first-anchor picker", async (change) => {
  activeJob = copy(privateJob);
  await mount(false);
  await click("Review expense draft");
  await click("Source anchor: Choose");
  const picker = container.querySelector('[role="dialog"]');
  expect(picker).not.toBeNull();
  if (["source", "result", "denial"].includes(change)) {
    rawHold = true;
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    if (change === "source") activeJob.publication.sources[0].revision = 2;
    if (change === "result") activeJob.resultHash = "changed-result";
    if (change === "denial") {
      await act(async () =>
        rawWaiters
          .splice(0)
          .forEach((w) =>
            w.reject(
              new NativeApiError(404, "not_found", "Source unavailable"),
            ),
          ),
      );
    } else await releaseRaw();
  } else if (change === "candidate") {
    await act(async () =>
      [...container.querySelectorAll("button")]
        .filter((b) => b.textContent === "Review expense draft")[1]
        .click(),
    );
  } else await changeAuthority(change);
  expect(picker!.isConnected).toBe(false);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(button("Selected message 1 (revision 1)")).toBeUndefined();
  expect(enqueues).toHaveLength(0);
});
