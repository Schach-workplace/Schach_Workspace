// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import IntelligenceScreen from "./IntelligenceScreen";
import IntelligenceDraftReview from "./IntelligenceDraftReview";
import {
  beginAttempt,
  readAttempt,
  clearAllBusinessAttempts,
} from "../../shared/business/attempts";
import { clearAllDrafts } from "./conversationDrafts";
import { NativeApiError } from "./client";
const s = vi.hoisted(() => ({
  w: {} as any,
  request: vi.fn(),
  size: (_width: number, _height: number) => {},
}));
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
    onContentSizeChange,
    contentContainerStyle,
  }: any) => {
    s.size = onContentSizeChange ?? (() => {});
    return createElement(
      "div",
      { style: contentContainerStyle, "data-report-list": true },
      ListHeaderComponent,
      ...data.map((item: any) => renderItem({ item })),
      ListFooterComponent,
    );
  },
  View: ({ children, style }: any) =>
    createElement(
      "div",
      {
        style:
          typeof style === "object" && !Array.isArray(style)
            ? style
            : undefined,
      },
      children,
    ),
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
      me: {
        role: "founder",
        memberAccessEpoch: 1,
        departmentId: "",
        managerId: "",
      },
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

const job = {
  jobId: "job",
  state: "ready",
  resultHash: "result",
  sourceSetHash: "set",
  sources: [
    {
      sourceKey: "source",
      kind: "task_fields",
      id: "task",
      label: "Authorized source",
    },
  ],
  publication: { allowed: true, sources: [] },
  result: {
    operation: "action_draft",
    limitations: ["Review selected sources"],
    candidates: [
      {
        kind: "task",
        title: "Generated seed",
        description: "Selected source suggestion",
        sourceKeys: ["source"],
        unresolved: ["owner", "dueDate", "reviewer"],
      },
    ],
  },
};
const click = async (title: string) =>
  act(async () => {
    const b = [...c.querySelectorAll("button")].find(
      (b) => b.textContent === title,
    );
    if (!b) throw Error("missing " + title);
    b.click();
    await new Promise((r) => setTimeout(r, 5));
  });
it("keeps native authored editor mounted while withholding current result and clears confirmed source denial", async () => {
  let hold = false;
  let reject: (e: unknown) => void = () => {};
  s.request.mockImplementation(async (path: string) => {
    if (path.endsWith("/jobs/job")) {
      if (hold) return new Promise((_r, j) => (reject = j));
      return job;
    }
    if (path.endsWith("/capabilities"))
      return { operations: { summary: true } };
    return { jobs: [] };
  });
  await render(<IntelligenceScreen initialJob="job" />);
  await render(<IntelligenceScreen initialJob="job" />);
  expect(c.textContent).toContain("Generated seed");
  await click("Review task draft");
  const editor = c.querySelector<HTMLInputElement>(
    '[aria-label="Reviewed intelligence title"]',
  )!;
  await act(async () => {
    editor.value = "Human authored title";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  editor.focus();
  hold = true;
  await click("Recheck current result");
  if (process.env.TEST_INTELLIGENCE_HELD === "1") {
    const start = Date.now();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 32500));
    });
    expect(Date.now() - start).toBeGreaterThanOrEqual(32000);
  }
  expect(c.textContent).not.toContain("Selected source suggestion");
  expect(c.textContent).not.toContain("Authorized source");
  expect(c.querySelector('[aria-label="Reviewed intelligence title"]')).toBe(
    editor,
  );
  expect(editor.value).toBe("Human authored title");
  expect(document.activeElement).toBe(editor);
  expect(
    [...c.querySelectorAll("button")].find(
      (b) => b.textContent === "Confirm reviewed creation",
    )!.disabled,
  ).toBe(true);
  await act(async () =>
    reject(new NativeApiError(404, "not_found", "Source unavailable")),
  );
  expect(editor.value).toBe("");
  expect(c.textContent).not.toContain("Generated seed");
}, 40000);
it("withholds background results and discards delayed old-company response", async () => {
  let finish: (v: unknown) => void = () => {};
  s.request.mockImplementation(async (path: string) => {
    if (path.endsWith("/jobs/job")) return new Promise((r) => (finish = r));
    return { jobs: [], operations: { summary: true } };
  });
  await render(<IntelligenceScreen initialJob="job" />);
  s.w.company = "B";
  s.w.foreground = false;
  await render(<IntelligenceScreen initialJob="job" />);
  await act(async () => finish(job));
  expect(c.textContent).not.toContain("Generated seed");
  expect(c.textContent).not.toContain("Authorized source");
});

it("checks published frozen retry roots while editing is locked, blocks held proof and hard-clears denied source", async () => {
  const scope = {
    serverOrigin: "https://owned.test",
    companyId: "co",
    userId: "actor",
    formId: "$intelligence-review:job:0",
  };
  const payload = {
    title: "Original reviewed intent",
    intelligenceBasis: {
      jobId: "job",
      resultHash: "hash",
      sourceSetHash: "set",
    },
  };
  beginAttempt(
    scope,
    payload,
    "original-key",
    {
      canonical: true,
      path: "/tasks",
      method: "POST",
      sources: ["/intelligence/jobs/job"],
    },
    s.w.work.me,
  );
  let finish: (v: unknown) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  s.request.mockImplementation(async (path: string) => {
    if (path.endsWith("/publication-access"))
      return new Promise((r, j) => {
        finish = r;
        reject = j;
      });
    return {};
  });
  await render(
    <IntelligenceDraftReview
      jobId="job"
      index={0}
      current={false}
      denied={true}
    />,
  );
  let retry = [...c.querySelectorAll("button")].find(
    (b) => b.textContent === "Retry original submitted draft",
  )!;
  expect(retry.disabled).toBe(true);
  expect(readAttempt(scope)?.payload).toEqual(payload);
  await act(async () => finish({ current: true, committed: true }));
  expect(retry.disabled).toBe(false);
  expect(readAttempt(scope)?.retryKey).toBe("original-key");
  s.w.recordEpoch++;
  await render(
    <IntelligenceDraftReview
      jobId="job"
      index={0}
      current={false}
      denied={true}
    />,
  );
  expect(retry.disabled).toBe(true);
  await act(async () =>
    reject(new NativeApiError(403, "source_unavailable", "Source unavailable")),
  );
  expect(readAttempt(scope)).toBeUndefined();
  expect(c.textContent).not.toContain("Retry original submitted draft");
});

it("keeps the selected expense amount editor mounted through a current fetch", async () => {
  const expenseJob = {
    ...job,
    publication: {
      allowed: true,
      conversationId: "conversation",
      sources: [{ messageId: "message", revision: 1 }],
      policyVersion: 1,
    },
    result: {
      ...job.result,
      candidates: [{ ...job.result.candidates[0], kind: "expense" }],
    },
  };
  let hold = false;
  s.request.mockImplementation(async (path: string) => {
    if (path.endsWith("/jobs/job"))
      return hold ? new Promise(() => {}) : expenseJob;
    if (path.endsWith("/capabilities"))
      return { operations: { summary: true } };
    return { jobs: [] };
  });
  s.w.work.expenseCategories = [];
  await render(<IntelligenceScreen initialJob="job" />);
  await render(<IntelligenceScreen initialJob="job" />);
  await click("Review expense draft");
  const amount = c.querySelector<HTMLInputElement>('[aria-label="amount"]')!;
  expect(amount).not.toBeNull();
  await act(async () => {
    amount.value = "1300.50";
    amount.dispatchEvent(new Event("input", { bubbles: true }));
  });
  amount.focus();
  hold = true;
  await click("Recheck current result");
  expect(c.textContent).not.toContain("Selected source suggestion");
  expect(c.querySelector('[aria-label="amount"]')).toBe(amount);
  expect(amount.value).toBe("1300.50");
  expect(document.activeElement).toBe(amount);
});
