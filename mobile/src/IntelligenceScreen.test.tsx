// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import IntelligenceScreen from "./IntelligenceScreen";
import IntelligenceResult from "./IntelligenceResult";
import { router } from "expo-router";
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

it("preserves the actual submitted frozen attempt through first raw403 then terminal200 and independent proof", async () => {
  let rawState = 0;
  let finish: (v: unknown) => void = () => {};
  const submissions: any[] = [];
  s.request.mockImplementation(
    async (path: string, method: string, body: any) => {
      if (path.endsWith("/publication-access"))
        return new Promise((r) => {
          finish = r;
        });
      if (path.endsWith("/jobs/job")) {
        if (rawState === 1) throw new NativeApiError(403, "expired", "Expired");
        return rawState === 2 ? { jobId: "job", state: "expired" } : job;
      }
      if (path.endsWith("/task-preview"))
        return {
          audienceUserIds: ["actor", "reviewer"],
          notice: "Reviewed audience",
          intelligenceReviewHash: "review",
        };
      if (path.endsWith("/tasks") && method === "POST") {
        submissions.push(body);
        if (submissions.length === 1) throw Error("Lost response");
        return { id: "created" };
      }
      return { jobs: [], operations: { summary: true } };
    },
  );
  await render(<IntelligenceScreen initialJob="job" />);
  await render(<IntelligenceScreen initialJob="job" />);
  await click("Review task draft");
  await click("Intelligence owner: Choose person");
  await click("Human owner · founder");
  await click("Intelligence reviewer: Choose person");
  await click("Independent reviewer · head");
  const date = c.querySelector<HTMLInputElement>(
    '[aria-label="Intelligence deadline"]',
  )!;
  await act(async () => {
    date.value = "2026-11-15";
    date.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Preview content and audience");
  await click("I reviewed these fields and this audience");
  await click("Confirm reviewed creation");
  expect(submissions).toHaveLength(1);
  rawState = 1;
  await click("Recheck current result");
  expect(c.textContent).not.toContain("Generated seed");
  let retry = [...c.querySelectorAll("button")].find(
    (b) => b.textContent === "Retry original submitted draft",
  )!;
  expect(retry).toBeDefined();
  expect(retry.disabled).toBe(true);
  rawState = 2;
  await click("Recheck current result");
  await act(async () => finish({ current: true, committed: true }));
  expect(retry.disabled).toBe(false);
  await click("Retry original submitted draft");
  expect(submissions[1]).toEqual(submissions[0]);
});
it("merges21plus owner jobs through the actual history consumer", async () => {
  const jobs = Array.from({ length: 23 }, (_, i) => ({
    jobId: "history-" + i,
    operation: "summary",
    state: "ready",
  }));
  s.request.mockImplementation(async (path: string) =>
    path.endsWith("/intelligence/jobs")
      ? { jobs: jobs.slice(0, 20), cursor: "next" }
      : path.includes("/intelligence/jobs?cursor=next")
        ? { jobs: jobs.slice(19), cursor: "" }
        : path.endsWith("/jobs/job")
          ? job
          : { operations: { summary: true } },
  );
  await render(<IntelligenceScreen initialJob="job" />);
  await render(<IntelligenceScreen initialJob="job" />);
  expect(
    [...c.querySelectorAll("button")].filter((b) =>
      /summary request \d+ · ready/.test(b.textContent ?? ""),
    ),
  ).toHaveLength(23);
});

it("binds exact record citation success and current denial to actual native navigation", async () => {
  const recordJob: any = {
    ...job,
    sources: [
      {
        sourceKey: "source",
        kind: "record",
        id: "record",
        parentId: "message",
        conversationId: "conversation",
        label: "Exact poll",
      },
    ],
  };
  vi.mocked(router.push).mockClear();
  s.request
    .mockResolvedValueOnce({ record: { id: "record" }, responses: [] })
    .mockRejectedValueOnce(new NativeApiError(404, "not_found", "Unavailable"));
  await render(
    <IntelligenceResult
      job={recordJob}
      onReview={() => {}}
      onTranscript={() => {}}
    />,
  );
  await click("Open Exact poll");
  expect(s.request.mock.calls[0][0]).toContain(
    "/conversations/conversation/records/record",
  );
  expect(router.push).toHaveBeenCalledWith({
    pathname: "/chat/[id]",
    params: {
      company: "co",
      id: "conversation",
      messageId: "message",
      recordId: "record",
    },
  });
  await click("Open Exact poll");
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(c.textContent).toContain(
    "This source is unavailable. Reselect current sources.",
  );
});
it("requires human supported anchor/action for second candidate and opens canonical existing work after lostACK", async () => {
  const privateJob = {
    ...job,
    publication: {
      allowed: true,
      conversationId: "conversation",
      policyVersion: 2,
      sources: [
        { messageId: "first", revision: 1 },
        { messageId: "second", revision: 2 },
      ],
    },
    result: {
      ...job.result,
      candidates: [
        job.result.candidates[0],
        { ...job.result.candidates[0], title: "Second candidate" },
      ],
    },
  };
  const submitted: any[] = [];
  const previews: any[] = [];
  s.request.mockImplementation(
    async (path: string, method: string, body: any) => {
      if (path.endsWith("/jobs/job")) return privateJob;
      if (path.includes("/work-actions?"))
        return {
          actions: [
            {
              id: "alternate",
              title: "Human alternate action",
              sourceRevision: 2,
            },
          ],
        };
      if (path.endsWith("/publication-access"))
        return { current: true, committed: true };
      if (path.endsWith("/task-conversions/preview")) {
        previews.push(body);
        return {
          audienceUserIds: ["actor"],
          notice: "Existing reviewed audience",
          intelligenceReviewHash: "existing-review",
          outcome: "existing",
          existingTaskId: "actual-existing",
          existingTaskTitle: "Actual existing title",
        };
      }
      if (path.endsWith("/task-conversions") && method === "POST") {
        submitted.push(body);
        if (submitted.length === 1) throw Error("Lost response");
        return { id: "actual-existing", outcome: "existing" };
      }
      return { jobs: [], operations: { summary: true } };
    },
  );
  await render(<IntelligenceScreen initialJob="job" />);
  await render(<IntelligenceScreen initialJob="job" />);
  await act(async () => {
    [...c.querySelectorAll("button")]
      .filter((b) => b.textContent === "Review task draft")[1]
      .click();
  });
  await click("Source anchor: Choose");
  await click("Selected message 2 (revision 2)");
  await click("Instruction action: Choose");
  await click("Primary instruction");
  await click("Intelligence owner: Choose person");
  await click("Human owner · founder");
  await click("Intelligence reviewer: Choose person");
  await click("Independent reviewer · head");
  const date = c.querySelector<HTMLInputElement>(
    '[aria-label="Intelligence deadline"]',
  )!;
  await act(async () => {
    date.value = "2026-11-15";
    date.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Preview content and audience");
  expect(previews[0]).toMatchObject({
    anchorMessageId: "second",
    actionId: "primary",
    task: { title: "Second candidate" },
  });
  expect(c.textContent).toContain("Existing work: Actual existing title");
  await click("I reviewed these fields and this audience");
  await click("Confirm existing work");
  await act(async () => {
    [...c.querySelectorAll("button")]
      .filter((b) => b.textContent === "Review task draft")[0]
      .click();
  });
  expect(c.textContent).toContain("Source anchor: Choose");
  expect(c.textContent).not.toContain("Retry original submitted draft");
  await act(async () => {
    [...c.querySelectorAll("button")]
      .filter((b) => b.textContent === "Review task draft")[1]
      .click();
  });
  expect(c.textContent).toContain("Retry original submitted draft");
  await click("Instruction action: Primary instruction");
  await click("Human alternate action");
  await click("Retry original submitted draft");
  expect(submitted[1]).toEqual(submitted[0]);
  expect(c.textContent).toContain(
    "This action already has work. Reviewed fields were not applied.",
  );
  vi.mocked(router.push).mockClear();
  await click("Open existing work");
  expect(router.push).toHaveBeenCalledWith({
    pathname: "/task/[id]",
    params: { company: "co", id: "actual-existing" },
  });
  await act(async () => {
    [...c.querySelectorAll("button")]
      .filter((b) => b.textContent === "Review task draft")[0]
      .click();
  });
  expect(c.textContent).not.toContain(
    "This action already has work. Reviewed fields were not applied.",
  );
  expect(c.textContent).toContain("Source anchor: Choose");
});

async function nativeSubmitCurrent(candidateIndex = 0) {
  await act(async () => {
    [...c.querySelectorAll("button")]
      .filter((b) => b.textContent === "Review task draft")
      [candidateIndex].click();
  });
  await click("Intelligence owner: Choose person");
  await click("Human owner · founder");
  await click("Intelligence reviewer: Choose person");
  await click("Independent reviewer · head");
  const date = c.querySelector<HTMLInputElement>(
    '[aria-label="Intelligence deadline"]',
  )!;
  await act(async () => {
    date.value = "2026-11-15";
    date.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Preview content and audience");
  await click("I reviewed these fields and this audience");
  await click("Confirm reviewed creation");
}
it.each([401, 403, 404])(
  "hard clears actual native unknown form on independent proof %s",
  async (status) => {
    let denied = false;
    const submitted: any[] = [];
    s.request.mockImplementation(
      async (path: string, method: string, body: any) => {
        if (path.endsWith("/publication-access")) {
          if (denied)
            throw new NativeApiError(status, "not_found", "Unavailable");
          return { current: true, committed: true };
        }
        if (path.endsWith("/jobs/job")) return job;
        if (path.endsWith("/task-preview"))
          return {
            audienceUserIds: ["actor", "reviewer"],
            notice: "Reviewed",
            intelligenceReviewHash: "review",
          };
        if (path.endsWith("/tasks") && method === "POST") {
          submitted.push(body);
          throw Error("Lost response");
        }
        return { jobs: [], operations: { summary: true } };
      },
    );
    await render(<IntelligenceScreen initialJob="job" />);
    await render(<IntelligenceScreen initialJob="job" />);
    await nativeSubmitCurrent();
    expect(c.textContent).toContain("Retry original submitted draft");
    denied = true;
    s.w.recordEpoch++;
    await render(<IntelligenceScreen initialJob="job" />);
    await render(<IntelligenceScreen initialJob="job" />);
    expect(c.textContent).not.toContain("Retry original submitted draft");
    expect(submitted).toHaveLength(1);
  },
);
it.each([
  ["ack", false],
  ["error", false],
  ["ack", true],
  ["error", true],
] as const)(
  "late native old %s cannot retire/resurrect new actual canonical intent (candidate switch %s)",
  async (mode, candidateSwitch) => {
    let finish: (v: any) => void = () => {},
      fail: (e: unknown) => void = () => {};
    const submitted: any[] = [];
    s.request.mockImplementation(
      async (path: string, method: string, body: any) => {
        if (path.endsWith("/publication-access"))
          return { current: true, committed: true };
        if (path.endsWith("/jobs/job"))
          return candidateSwitch
            ? {
                ...job,
                result: {
                  ...job.result,
                  candidates: [
                    ...job.result.candidates,
                    { ...job.result.candidates[0], title: "Second candidate" },
                  ],
                },
              }
            : job;
        if (path.endsWith("/task-preview"))
          return {
            audienceUserIds: ["actor", "reviewer"],
            notice: "Reviewed",
            intelligenceReviewHash: "review",
          };
        if (path.endsWith("/tasks") && method === "POST") {
          submitted.push(body);
          if (submitted.length === 1)
            return new Promise((r, j) => {
              finish = r;
              fail = j;
            });
          if (submitted.length === 2) throw Error("New response lost");
          return { id: "new" };
        }
        return { jobs: [], operations: { summary: true } };
      },
    );
    await render(<IntelligenceScreen initialJob="job" />);
    await render(<IntelligenceScreen initialJob="job" />);
    await nativeSubmitCurrent();
    expect(submitted).toHaveLength(1);
    if (!candidateSwitch) {
      await act(async () => {
        clearAllBusinessAttempts();
        clearAllDrafts();
        root.render(null);
      });
      await render(<IntelligenceScreen initialJob="job" />);
      await render(<IntelligenceScreen initialJob="job" />);
    }
    await nativeSubmitCurrent(candidateSwitch ? 1 : 0);
    expect(submitted).toHaveLength(2);
    const newer = submitted[1];
    await act(async () => {
      if (mode === "ack") finish({ id: "old" });
      else fail(Error("Late old error"));
    });
    expect(c.textContent).not.toContain("Created work successfully.");
    expect(c.textContent).toContain("Retry original submitted draft");
    await click("Retry original submitted draft");
    expect(submitted[2]).toEqual(newer);
    expect(newer.retryKey).not.toBe(submitted[0].retryKey);
  },
);
it.each(["company", "session"])(
  "discards delayed owner history cursor after native %s switch",
  async (kind) => {
    let finish: (v: any) => void = () => {};
    let switched = false;
    s.request.mockImplementation(async (path: string) => {
      if (path.includes("/intelligence/jobs?cursor=held"))
        return new Promise((r) => {
          finish = r;
        });
      if (path.endsWith("/intelligence/jobs"))
        return switched
          ? { jobs: [] }
          : {
              jobs: Array.from({ length: 20 }, (_, i) => ({
                jobId: "old-" + i,
                operation: "summary",
                state: "ready",
              })),
              cursor: "held",
            };
      if (path.endsWith("/jobs/job")) return job;
      return { operations: { summary: true } };
    });
    await render(<IntelligenceScreen initialJob="job" />);
    await render(<IntelligenceScreen initialJob="job" />);
    expect(s.request.mock.calls.some((c) => c[0].includes("cursor=held"))).toBe(
      true,
    );
    switched = true;
    if (kind === "company") s.w.company = "new-company";
    else s.w.session = { user: { id: "new-user" } };
    await render(<IntelligenceScreen initialJob="job" />);
    await act(async () =>
      finish({
        jobs: [{ jobId: "old-20", operation: "summary", state: "ready" }],
      }),
    );
    expect(
      [...c.querySelectorAll("button")].filter((b) =>
        /summary request \d+ · ready/.test(b.textContent ?? ""),
      ),
    ).toHaveLength(0);
  },
);
