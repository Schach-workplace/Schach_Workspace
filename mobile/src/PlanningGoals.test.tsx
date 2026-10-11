// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import GoalMeasurementForm from "./GoalMeasurementForm";
import GoalsScreen from "./GoalsScreen";
import PlanningScreen from "./PlanningScreen";
import { clearAllDrafts } from "./conversationDrafts";
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
vi.mock("expo-router", () => ({ router: { push: vi.fn(), back: vi.fn() } }));
vi.mock("./Workspace", () => ({
  useWorkspace: () => s.w,
  Page: ({ children }: { children: ReactNode }) =>
    createElement("div", {}, children),
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
  TextInput: ({ value, onChangeText, accessibilityLabel }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      onChange: (e: any) => onChangeText(e.target.value),
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
it("keeps authored observation and reason mounted through a current-read refresh, then submits exact version", async () => {
  const goal: any = {
    id: "quality",
    version: 7,
    current: 4.8,
    baseline: 8,
    target: 3,
    unit: "%",
  };
  await render(createElement(GoalMeasurementForm, { goal, ready: true }));
  const reason = c.querySelector(
    '[aria-label="Measurement reason"]',
  ) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(reason, "Human measured reason");
    reason.dispatchEvent(new Event("input", { bubbles: true }));
    reason.dispatchEvent(new Event("change", { bubbles: true }));
  });
  reason.focus();
  await render(
    createElement(GoalMeasurementForm, {
      goal: { ...goal, version: 8 },
      ready: false,
    }),
  );
  expect(c.querySelector('[aria-label="Measurement reason"]')).toBe(reason);
  expect(document.activeElement).toBe(reason);
  expect(reason.value).toBe("Human measured reason");
});
it("renders decreasing independent raw goals and virtualized currently authorized planning without fabricated capacity", async () => {
  s.request.mockImplementation(async (path: string) =>
    path.endsWith("/goals")
      ? {
          goals: [
            {
              id: "quality",
              name: "Quality",
              current: 4.8,
              baseline: 8,
              target: 3,
              unit: "%",
            },
          ],
        }
      : path.includes("/planning/summary")
        ? {
            projectionBasis: "b",
            methodDescription: "Visible remaining effort",
            coverage: {
              uniqueSelectedRemainingHours: 8,
              weeklyExposureHours: 24,
              undated: 1,
              invalidInterval: 1,
              recordedZeroEstimate: 1,
              missingOwner: 0,
              invalidNumeric: 0,
            },
            weeks: [],
          }
        : { warnings: [] },
  );
  await render(createElement(GoalsScreen));
  expect(c.textContent).toContain("4.8");
  await render(createElement(PlanningScreen));
  expect(c.textContent).toContain("Unique selected effort: 8");
  expect(c.textContent).not.toContain("Room available");
});
async function enter(label: string, value: string) {
  const el = c.querySelector(
    '[aria-label="' + label + '"]',
  ) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function press(title: string) {
  await act(async () => {
    (
      [...c.querySelectorAll("button")].find(
        (b) => b.textContent === title,
      ) as HTMLButtonElement
    ).click();
    await new Promise((r) => setTimeout(r, 10));
  });
}
it("replays a lost ACK with the original optimistic version and retry key after remount, and records success before failed refresh", async () => {
  const goal: any = {
    id: "quality",
    version: 7,
    current: 4.8,
    baseline: 8,
    target: 3,
    unit: "%",
  };
  const payloads: any[] = [];
  s.request.mockImplementation(
    async (path: string, method: string, body: any) => {
      if (path.endsWith("/measurements")) {
        payloads.push(body);
        if (payloads.length === 1) throw Error("owned ACK lost");
        return {
          ok: true,
          id: "quality",
          measurementId: "one-fact",
          goalVersion: 8,
        };
      }
      return { options: [] };
    },
  );
  s.w.refresh.mockRejectedValue(Error("owned refresh outage"));
  await render(createElement(GoalMeasurementForm, { goal, ready: true }));
  await enter("Measurement reason", "Observed result independently");
  await enter("Measured value", "4");
  await press("Save measured result");
  await render(null);
  await render(
    createElement(GoalMeasurementForm, {
      goal: { ...goal, version: 9, current: 2 },
      ready: true,
    }),
  );
  expect(
    (c.querySelector('[aria-label="Measured value"]') as HTMLInputElement)
      .value,
  ).toBe("4");
  await press("Retry same measurement");
  expect(payloads.length).toBe(2);
  expect(payloads[1]).toEqual(payloads[0]);
  expect(payloads[1].expectedVersion).toBe(7);
  expect(payloads[1].retryKey).toBeTruthy();
  expect(c.textContent).toContain("Measurement saved");
  expect(c.textContent).not.toContain("Retry same measurement");
});
it("inherits correction microseconds exactly without a Date conversion", async () => {
  let input: any;
  s.request.mockImplementation(
    async (path: string, method: string, body: any) => {
      if (path.endsWith("/measurements")) {
        input = body;
        return { ok: true, id: "quality" };
      }
      return { options: [] };
    },
  );
  const goal: any = {
    id: "quality",
    version: 7,
    current: 4.8,
    baseline: 8,
    target: 3,
    unit: "%",
    currentMeasurementId: "latest",
  };
  const correction: any = {
    id: "older",
    value: 5,
    unit: "old-unit",
    effectiveAt: "1960-01-01T00:00:00.123456Z",
  };
  await render(
    createElement(GoalMeasurementForm, { goal, correction, ready: true }),
  );
  await enter("Measurement reason", "Correct old observation");
  await press("Save measured result");
  expect(input.correctsId).toBe("older");
  expect(input.effectiveAt).toBe(correction.effectiveAt);
  expect(c.textContent).toContain(
    "Corrects older history; current result remains",
  );
});
