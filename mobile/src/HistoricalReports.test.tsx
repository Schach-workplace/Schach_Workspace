// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import HistoricalReports from "./HistoricalReports";
import { clearAllDrafts } from "./conversationDrafts";
import { NativeApiError } from "./client";
import { clearAllBusinessAttempts } from "../../shared/business/attempts";
const s = vi.hoisted(() => ({ w: {} as any, request: vi.fn() }));
vi.mock("./client", () => ({
  client: { endpoint: "https://owned.test", generation: 1, request: s.request },
  NativeApiError: class extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("./Workspace", () => ({
  useWorkspace: () => s.w,
  Page: ({ children }: { children: ReactNode }) =>
    createElement("div", {}, children),
}));
vi.mock("./reportClient", () => ({
  ReportTransfer: class {
    cancel = vi.fn().mockResolvedValue(undefined);
    share = vi.fn();
  },
}));
vi.mock("./AttentionInbox", () => ({ default: () => null }));
vi.mock("@react-native-community/datetimepicker", () => ({
  default: () => null,
}));

vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  Sheet: ({ children, title }: any) =>
    createElement("section", { "aria-label": title }, children),
}));
vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Platform: { OS: "android" },
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
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  TextInput: ({ value, onChangeText, accessibilityLabel }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      onInput: (e: any) => onChangeText(e.target.value),
    }),
}));
let root: Root, c: HTMLDivElement;
const render = async (node: ReactNode) =>
  act(async () => {
    root.render(node);
    await new Promise((r) => setTimeout(r, 5));
  });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  clearAllBusinessAttempts();
  clearAllDrafts();
  c = document.createElement("div");
  document.body.append(c);
  root = createRoot(c);
  s.w = {
    company: "co",
    session: { user: { id: "actor" } },
    foreground: true,
    policyEpoch: 0,
    recordEpoch: 0,
    attentionEpoch: 0,
    work: {
      readBasis: "basis",
      me: { role: "founder" },
      people: [
        { id: "actor", name: "Human owner", role: "founder", active: true },
        {
          id: "reviewer",
          name: "Independent reviewer",
          role: "head",
          active: true,
        },
      ],
      departments: [],
      company: { timezone: "Asia/Kolkata" },
      tasks: [],
    },
    refresh: vi.fn().mockResolvedValue(undefined),
    setError: vi.fn(),
    error: "",
  };
  s.request.mockReset();
});
afterEach(async () => {
  await act(() => root.unmount());
  c.remove();
});
it("hides summary, rows and download together during a same-key all-source recheck and after denied source outside the page", async () => {
  let held = false;
  let finish: (value: any) => void = () => {};
  const snapshot = {
    id: "snap",
    request: { reportZone: "Asia/Kolkata" },
    rowCount: 150,
    summary: {
      metrics: {
        "state.cohort": {
          code: "state.cohort",
          value: 150,
          unit: "count",
          rate: null,
          coverage: [],
        },
      },
      coverage: [],
    },
  };
  s.request.mockImplementation(async (path: string) => {
    if (path.includes("/rows")) {
      if (held)
        return new Promise((resolve) => {
          finish = resolve;
        });
      return {
        rows: [
          {
            rowId: "one",
            taskId: "one",
            state: { code: "ABC", title: "Private historical task" },
            kind: "state",
            taskVersion: 1,
          },
        ],
        cursor: "next",
      };
    }
    if (path.includes("/snapshots/")) return { snapshot };
    return { projects: [] };
  });
  await render(<HistoricalReports initialId="snap" />);
  expect(c.textContent).toContain("Private historical task");
  expect(c.textContent).toContain("Tasks due as of period end: 150");
  held = true;
  s.w = { ...s.w, executionEpoch: 1 };
  await render(<HistoricalReports initialId="snap" />);
  expect(c.textContent).not.toContain("Private historical task");
  expect(c.textContent).not.toContain("Tasks due as of period end: 150");
  s.request.mockImplementationOnce(async () => {
    throw new NativeApiError(409, "access_changed", "Unloaded source denied");
  });
  await act(async () => {
    finish(
      Promise.reject(
        new NativeApiError(409, "access_changed", "Unloaded source denied"),
      ),
    );
    await new Promise((r) => setTimeout(r, 5));
  });
  expect(c.textContent).toContain("Report access changed");
  expect(c.textContent).not.toContain("Private historical task");
});
it("discards a delayed company A snapshot after switching to B", async () => {
  const held = new Map<string, (value: any) => void>();
  s.request.mockImplementation(async (path: string) => {
    if (path.includes("/snapshots/"))
      return new Promise((resolve) => held.set(path, resolve));
    return { projects: [] };
  });
  await render(<HistoricalReports initialId="snap" />);
  const old = held.get("/companies/co/reports/history/snapshots/snap")!;
  expect(old).toBeTypeOf("function");
  s.w = { ...s.w, company: "B" };
  await render(<HistoricalReports initialId="snap" />);
  await act(async () => {
    old({
      snapshot: {
        id: "snap",
        request: { reportZone: "UTC" },
        rowCount: 999,
        summary: {
          metrics: {
            "state.cohort": {
              code: "state.cohort",
              value: 999,
              unit: "count",
              rate: null,
              coverage: [],
            },
          },
          coverage: [],
        },
      },
    });
    await new Promise((r) => setTimeout(r, 5));
  });
  expect(c.textContent).not.toContain("Tasks due as of period end: 999");
  expect(held.has("/companies/B/reports/history/snapshots/snap")).toBe(true);
});
it("retires a source-bound unresolved export attempt on confirmed historical access denial", async () => {
  const { beginAttempt, readAttempt } =
    await import("../../shared/business/attempts");
  const scope = {
    serverOrigin: "https://owned.test",
    companyId: "co",
    userId: "actor",
    formId: "$report-export",
  };
  beginAttempt(
    scope,
    { snapshotId: "snap", csvSchemaVersion: 1 },
    "fixed-export",
    {
      path: "/reports/exports",
      method: "POST",
      sources: ["/reports/history/snapshots/snap"],
    },
  );
  s.request.mockImplementation(async (path: string) => {
    if (path.includes("/snapshots/"))
      throw new NativeApiError(409, "access_changed", "Source revoked");
    return { projects: [] };
  });
  await render(<HistoricalReports initialId="snap" />);
  expect(readAttempt(scope)).toBeUndefined();
});

it("native capture retries its frozen key and period after lost ACK, remount and authored date edits", async () => {
  let posts = 0;
  const sent: any[] = [];
  s.request.mockImplementation(
    async (path: string, method?: string, body?: any) => {
      if (method === "POST" && path.endsWith("/history/snapshots")) {
        sent.push(body);
        if (++posts === 1) throw Error("Lost ACK");
        return { snapshotId: "captured" };
      }
      if (path.includes("/rows")) return { rows: [], cursor: "" };
      if (path.includes("/snapshots/"))
        return {
          snapshot: {
            id: "captured",
            request: { reportZone: "UTC" },
            summary: { metrics: {}, coverage: [] },
            rowCount: 0,
          },
        };
      return { projects: [] };
    },
  );
  await render(<HistoricalReports />);
  const button = (name: string) =>
    Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === name,
    )!;
  await act(async () => {
    button("Generate historical report").click();
    await new Promise((r) => setTimeout(r, 5));
  });
  expect(sent).toHaveLength(1);
  expect(sent[0].retryKey).toBeTruthy();
  await render(null);
  await render(<HistoricalReports />);
  const input = c.querySelector<HTMLInputElement>(
    'input[aria-label="Historical end date YYYY-MM-DD"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "2026-09-20");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    button("Retry same report generation").click();
    await new Promise((r) => setTimeout(r, 5));
  });
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
  expect(input.value).toBe("2026-09-20");
});
