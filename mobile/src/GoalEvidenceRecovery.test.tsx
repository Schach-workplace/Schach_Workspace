// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import GoalMeasurementForm from "./GoalMeasurementForm";
import { NativeApiError } from "./client";
import { clearAllDrafts, writeDraft } from "./conversationDrafts";
import {
  beginAttempt,
  clearAllBusinessAttempts,
  readAttempt,
} from "./businessAttempts";
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
vi.mock("./Workspace", () => ({ useWorkspace: () => s.w }));
vi.mock("@react-native-community/datetimepicker", () => ({
  default: () => null,
}));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  FlatList: ({
    data,
    renderItem,
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent,
  }: any) =>
    createElement(
      "div",
      {},
      ListHeaderComponent,
      ...data.map((item: any) => renderItem({ item })),
      !data.length && ListEmptyComponent,
      ListFooterComponent,
    ),
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  TextInput: ({ value, onChangeText, accessibilityLabel, editable }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      readOnly: editable === false,
      onChange: (e: any) => onChangeText(e.target.value),
    }),
}));
const actor = {
  memberAccessEpoch: 4,
  role: "founder",
  departmentId: "",
  managerId: "",
};
const goal: any = {
  id: "quality",
  version: 7,
  current: 4.8,
  baseline: 8,
  target: 3,
  unit: "%",
};
const scope = {
  serverOrigin: "https://owned.test",
  companyId: "co",
  userId: "actor",
  formId: "$goal-measure:quality:new",
};
const bindings = ["first", "second source"].map((sourceId) => ({
  kind: "message" as const,
  sourceId,
  parentId: "private",
  revision: "r1",
  contentHash: "fixture-binding",
}));
let root: Root, c: HTMLDivElement;
const flush = async (node?: ReactNode) =>
  act(async () => {
    if (node !== undefined) root.render(node);
    await new Promise((r) => setTimeout(r, 10));
  });
const button = (name: string) =>
  [...c.querySelectorAll("button")].find((b) => b.textContent === name)!;
const press = async (name: string) => {
  await act(async () => {
    button(name).click();
    await new Promise((r) => setTimeout(r, 10));
  });
};
function seed() {
  writeDraft(
    { ...scope, conversationId: scope.formId, threadRootId: "input:draft" },
    {
      body: JSON.stringify({
        expectedVersion: 7,
        value: "4",
        date: "2026-10-02",
        time: "09:00",
        instant: "",
        reason: "Authored observation",
        evidence: bindings,
        authored: true,
      }),
    },
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  clearAllBusinessAttempts();
  clearAllDrafts();
  s.w = {
    company: "co",
    session: { user: { id: "actor" } },
    foreground: true,
    policyEpoch: 0,
    recordEpoch: 0,
    attentionEpoch: 0,
    executionEpoch: 0,
    work: { readBasis: "same", me: actor, company: { timezone: "UTC" } },
    refresh: vi.fn().mockResolvedValue(undefined),
  };
  s.request.mockReset();
  c = document.createElement("div");
  document.body.append(c);
  root = createRoot(c);
  seed();
});
afterEach(async () => {
  await act(() => root.unmount());
  c.remove();
});
it.each([false, true])(
  "revalidates ALL unknown bindings before retry, denial=%s",
  async (denied) => {
    let held = false;
    const releases = new Map<string, (v: any) => void>();
    const reads: string[] = [],
      sent: any[] = [];
    const facts = new Map<string, string>();
    s.request.mockImplementation(
      async (path: string, method: string, body: any) => {
        if (method === "POST") {
          sent.push(body);
          facts.set(body.retryKey, "one-canonical-fact");
          if (sent.length === 1) throw Error("Committed response dropped");
          return { id: "quality", measurementId: "one-canonical-fact" };
        }
        if (path.includes("evidence-preview")) {
          const id = new URL(path, "https://owned.test").searchParams.get(
            "sourceId",
          )!;
          reads.push(id);
          if (held)
            return new Promise((resolve, reject) =>
              releases.set(id, (ok) =>
                ok
                  ? resolve({
                      ...bindings.find((b) => b.sourceId === id),
                      revision: "r2",
                      label: "Private label",
                    })
                  : reject(
                      new NativeApiError(
                        404,
                        "not_found",
                        "Source unavailable",
                      ),
                    ),
              ),
            );
          return {
            ...bindings.find((b) => b.sourceId === id),
            label: "Private label",
          };
        }
        if (path.endsWith("/conversations"))
          return {
            conversations: [{ id: "private", title: "Fictional parent" }],
          };
        return { options: [] };
      },
    );
    await flush(createElement(GoalMeasurementForm, { goal, ready: true }));
    await press("message");
    await press("Fictional parent");
    await press("Save measured result");
    const original = readAttempt(scope)!;
    expect(original.state).toBe("unknown");
    expect(facts.size).toBe(1);
    const reason = c.querySelector(
      '[aria-label="Measurement reason"]',
    ) as HTMLInputElement;
    reason.focus();
    reason.setSelectionRange(3, 8);
    const exactSource =
      "/goals/quality/evidence-preview?kind=message&sourceId=second%20source&parentId=private";
    const dependentScope = { ...scope, formId: "another-dependent-intent" };
    beginAttempt(dependentScope, { reason: "Dependent" }, "dependent-key", {
      canonical: true,
      path: "/goals/other/measurements",
      method: "POST",
      sources: [exactSource],
    });
    const unrelated = [
      "kind=task_comment&sourceId=second%20source&parentId=private",
      "kind=message&sourceId=second%20source&parentId=other",
      "kind=message&sourceId=other&parentId=private",
    ].map((tuple, i) => {
      const other = { ...scope, formId: "unrelated-" + i };
      beginAttempt(other, { reason: "Other" }, "other-key-" + i, {
        canonical: true,
        path: "/goals/other/measurements",
        method: "POST",
        sources: ["/goals/quality/evidence-preview?" + tuple],
      });
      return other;
    });
    held = true;
    reads.length = 0;
    s.w = { ...s.w, foreground: false };
    await flush(createElement(GoalMeasurementForm, { goal, ready: true }));
    s.w = { ...s.w, foreground: true };
    await flush(createElement(GoalMeasurementForm, { goal, ready: true }));
    expect(reads.sort()).toEqual(["first", "second source"]);
    expect(button("Retry same measurement").disabled).toBe(true);
    expect(c.textContent).not.toContain("Private label");
    expect(c.querySelector('[aria-label="Measurement reason"]')).toBe(reason);
    expect(document.activeElement).toBe(reason);
    expect(reason.selectionStart).toBe(3);
    expect(reason.selectionEnd).toBe(8);
    expect(reason.value).toBe("Authored observation");
    expect(readAttempt(scope)).toBe(original);
    await act(async () => {
      releases.get("first")!(true);
    });
    expect(button("Retry same measurement").disabled).toBe(true);
    await act(async () => {
      releases.get("second source")!(!denied);
    });
    await flush();
    for (const other of unrelated)
      expect(readAttempt(other)?.state).toBe("unknown");
    if (denied) {
      expect(readAttempt(dependentScope)).toBeUndefined();
      expect(button("Choose another parent source")).toBeUndefined();
      expect(readAttempt(scope)).toBeUndefined();
      expect(c.textContent).toContain("0 evidence selections");
      expect(button("Retry same measurement")).toBeUndefined();
      expect(reason.value).toBe("");
      expect(button("Save measured result").disabled).toBe(true);
      held = false;
      reads.length = 0;
      s.w = { ...s.w, foreground: false };
      await flush(createElement(GoalMeasurementForm, { goal, ready: true }));
      s.w = { ...s.w, foreground: true };
      await flush(createElement(GoalMeasurementForm, { goal, ready: true }));
      expect(reads).toEqual([]);
      await flush(null);
      await flush(createElement(GoalMeasurementForm, { goal, ready: true }));
      expect(
        (
          c.querySelector(
            '[aria-label="Measurement reason"]',
          ) as HTMLInputElement
        ).value,
      ).toBe("");
      expect(c.textContent).toContain("0 evidence selections");
      expect(sent).toHaveLength(1);
    } else {
      expect(readAttempt(scope)).toBe(original);
      expect(button("Retry same measurement").disabled).toBe(false);
      await press("Retry same measurement");
      expect(sent).toHaveLength(2);
      expect(sent[1]).toEqual(sent[0]);
      expect(facts.size).toBe(1);
      expect(c.textContent).toContain("Measurement saved.");
    }
  },
);
it.each([false, true])(
  "ignores an old measurement ACK after source denial and preserves a newer registry intent, rejected=%s",
  async (rejected) => {
    let denied = false,
      release!: (value: any) => void,
      rejectOld!: (error: Error) => void;
    s.request.mockImplementation(async (path: string, method: string) => {
      if (method === "POST")
        return new Promise((resolve, reject) => {
          release = resolve;
          rejectOld = reject;
        });
      if (path.includes("evidence-preview")) {
        if (denied)
          throw new NativeApiError(404, "not_found", "Source unavailable");
        return { ...bindings[0], label: "Private label" };
      }
      return { options: [] };
    });
    await flush(createElement(GoalMeasurementForm, { goal, ready: true }));
    await press("Save measured result");
    expect(readAttempt(scope)).toBeTruthy();
    denied = true;
    s.w = { ...s.w, foreground: false };
    await flush(createElement(GoalMeasurementForm, { goal, ready: true }));
    s.w = { ...s.w, foreground: true };
    await flush(createElement(GoalMeasurementForm, { goal, ready: true }));
    expect(readAttempt(scope)).toBeUndefined();
    expect(
      (c.querySelector('[aria-label="Measurement reason"]') as HTMLInputElement)
        .value,
    ).toBe("");
    await act(async () => {
      beginAttempt(
        scope,
        {
          expectedVersion: 7,
          value: 3,
          effectiveAt: "2026-10-02T09:00:00Z",
          reason: "New intent",
          evidence: [],
        },
        "new-key",
        {
          canonical: true,
          path: "/goals/quality/measurements",
          method: "POST",
        },
        actor,
      );
      if (rejected)
        rejectOld(new NativeApiError(404, "not_found", "Old source denial"));
      else release({ id: "quality", measurementId: "old-fact" });
    });
    expect(readAttempt(scope)?.retryKey).toBe("new-key");
    expect(c.textContent).not.toContain("Measurement saved.");
    expect(
      (c.querySelector('[aria-label="Measurement reason"]') as HTMLInputElement)
        .value,
    ).toBe("New intent");
  },
);
