// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import GoalScreen from "./GoalScreen";
import GoalMetadataForm from "./GoalMetadataForm";
import GoalReminderPreferences from "./GoalReminderPreferences";
import { NativeApiError } from "./client";
import GoalMeasurementForm from "./GoalMeasurementForm";
import GoalsScreen from "./GoalsScreen";
import PlanningScreen from "./PlanningScreen";
import { clearAllDrafts } from "./conversationDrafts";
import { clearAllBusinessAttempts } from "../../shared/business/attempts";
const s = vi.hoisted(() => ({
  w: {} as any,
  request: vi.fn(),
  lastList: {} as any,
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
  StyleSheet: { create: (value: unknown) => value },
  Platform: { OS: "android" },
  FlatList: ({
    data,
    renderItem,
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent,
    ...rest
  }: any) => {
    s.lastList = { data, ListHeaderComponent, ListFooterComponent, ...rest };
    return createElement(
      "div",
      {},
      ListHeaderComponent,
      ...data.map((item: any) => renderItem({ item })),
      !data.length && ListEmptyComponent,
      ListFooterComponent,
    );
  },
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
it("submits only writable preference fields from a full DTO and preserves uncertain same-key retry across remount", async () => {
  const preference: any = {
    goalId: "quality",
    userId: "actor",
    version: 7,
    enabled: false,
    cadence: "weekly",
    weekday: 1,
    monthDay: 1,
    localTime: "09:00",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  const posts: any[] = [];
  s.request.mockImplementation(
    async (path: string, method: string, body: any) => {
      if (method === "PATCH") {
        posts.push(body);
        const allowed = [
          "retryKey",
          "expectedVersion",
          "enabled",
          "cadence",
          "weekday",
          "monthDay",
          "localTime",
          "reason",
        ];
        if (Object.keys(body).some((k) => !allowed.includes(k)))
          throw new NativeApiError(400, "invalid_json", "Forbidden DTO field");
        if (posts.length === 1) throw new TypeError("ACK uncertain");
        return { ok: true };
      }
      return { preference };
    },
  );
  await render(
    createElement(GoalReminderPreferences, { goalId: "quality", ready: true }),
  );
  await enter("Reminder preference reason", "Explicit opt in");
  await press("Reminder disabled · enable");
  await press("Save my reminder preference");
  expect(Object.keys(posts[0]).sort()).toEqual(
    [
      "retryKey",
      "expectedVersion",
      "enabled",
      "cadence",
      "weekday",
      "monthDay",
      "localTime",
      "reason",
    ].sort(),
  );
  await render(null);
  preference.version = 9;
  await render(
    createElement(GoalReminderPreferences, { goalId: "quality", ready: true }),
  );
  await press("Retry same reminder preference");
  expect(posts[1]).toEqual(posts[0]);
  expect(posts[1].expectedVersion).toBe(7);
});
it("requires explicit numeric text, preserves zero, and deliberately loads the current version after rejection", async () => {
  let version = 7;
  const posts: any[] = [];
  s.request.mockImplementation(
    async (path: string, method: string, body: any) => {
      if (path.endsWith("/measurements") && method === "POST") {
        posts.push(body);
        if (posts.length === 1)
          throw new NativeApiError(409, "version_conflict", "Inspect latest");
        return { ok: true };
      }
      return { options: [] };
    },
  );
  const goal: any = { id: "quality", version, current: 4.8, unit: "defects" };
  await render(createElement(GoalMeasurementForm, { goal, ready: true }));
  await enter("Measurement reason", "Explicit observation");
  await enter("Measured value", " ");
  expect(
    Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === "Save measured result",
    )?.disabled,
  ).toBe(true);
  expect(posts).toEqual([]);
  await enter("Measured value", "0");
  await press("Save measured result");
  expect(posts[0].value).toBe(0);
  await render(null);
  await render(
    createElement(GoalMeasurementForm, {
      goal: { ...goal, version: 9, current: -2 },
      ready: true,
    }),
  );
  await press("Load latest value and version");
  await enter("Measurement reason", "Explicit latest negative observation");
  await press("Save measured result");
  expect(posts[1].expectedVersion).toBe(9);
  expect(posts[1].value).toBe(-2);
  expect(posts[1].retryKey).not.toBe(posts[0].retryKey);
});
it("recovers rejected native metadata fields and CAS by explicit discard/load across remount", async () => {
  const goal: any = {
    id: "quality",
    name: "Authorized quality",
    description: "",
    version: 7,
    ownerId: "actor",
    departmentId: "",
    baseline: 8,
    target: 3,
    current: 4.8,
    unit: "defects",
    taskIds: [],
    dueDate: "",
  };
  let latest = { ...goal };
  const posts: any[] = [];
  s.request.mockImplementation(
    async (path: string, method: string, body: any) => {
      if (method === "PATCH") {
        posts.push(body);
        if (posts.length === 1)
          throw new NativeApiError(422, "validation", "Invalid metadata");
        if (posts.length === 2)
          throw new NativeApiError(
            409,
            "version_conflict",
            "This task changed since you opened it.",
          );
        return { ok: true };
      }
      return { goal: latest, canEdit: true, canMeasure: true, options: [] };
    },
  );
  await render(
    createElement(GoalMetadataForm, {
      item: goal,
      ready: true,
      onClose: () => {},
    }),
  );
  await enter("Goal name", "Invalid intent");
  await enter("Goal metadata reason", "Explicit metadata reason");
  await press("Save reviewed goal");
  await enter("Goal name", "Corrected intent");
  await press("Discard submitted intent and edit");
  await press("Save reviewed goal");
  expect(posts[1].name).toBe("Corrected intent");
  expect(posts[1].retryKey).not.toBe(posts[0].retryKey);
  expect(c.textContent).toContain("This goal changed");
  await render(null);
  latest = { ...goal, name: "Fresh authorized", unit: "new-unit", version: 9 };
  await render(
    createElement(GoalMetadataForm, {
      item: goal,
      ready: true,
      onClose: () => {},
    }),
  );
  expect(
    (c.querySelector('[aria-label="Goal name"]') as HTMLInputElement).value,
  ).toBe("Corrected intent");
  await press("Load latest goal and version");
  await press("Save reviewed goal");
  expect(posts[2]).toMatchObject({
    version: 9,
    name: "Fresh authorized",
    unit: "new-unit",
  });
  expect(posts[2]).not.toHaveProperty("current");
});
it("native preference rejection is editable as a new intent and loads a fresh captured version", async () => {
  let pref: any = {
    goalId: "quality",
    userId: "actor",
    version: 7,
    enabled: false,
    cadence: "weekly",
    weekday: 1,
    monthDay: 1,
    localTime: "09:00",
    createdAt: "server",
    updatedAt: "server",
  };
  const posts: any[] = [];
  s.request.mockImplementation(
    async (path: string, method: string, body: any) => {
      if (method === "PATCH") {
        posts.push(body);
        if (posts.length === 1)
          throw new NativeApiError(422, "validation", "Invalid weekday");
        if (posts.length === 2)
          throw new NativeApiError(
            409,
            "conflict",
            "Current preference changed",
          );
        return { ok: true };
      }
      return { preference: pref };
    },
  );
  await render(
    createElement(GoalReminderPreferences, { goalId: "quality", ready: true }),
  );
  await enter("Reminder preference reason", "Human preference");
  await enter("Reminder weekday", "9");
  await press("Save my reminder preference");
  await enter("Reminder weekday", "2");
  await press("Discard submitted intent and edit");
  await press("Save my reminder preference");
  expect(posts[1].weekday).toBe(2);
  expect(posts[1].retryKey).not.toBe(posts[0].retryKey);
  await render(null);
  pref = { ...pref, version: 9 };
  await render(
    createElement(GoalReminderPreferences, { goalId: "quality", ready: true }),
  );
  await press("Load latest preference and version");
  await enter("Reminder preference reason", "Current preference");
  await press("Save my reminder preference");
  expect(posts[2].expectedVersion).toBe(9);
});
it("blank bundled native initial observation cannot become zero", async () => {
  s.request.mockResolvedValue({ options: [] });
  await render(
    createElement(GoalMetadataForm, { ready: true, onClose: () => {} }),
  );
  await enter("Goal name", "New quality");
  await enter("Initial measurement reason", "Explicit initial reason");
  await enter("Initial measured value", "");
  expect(
    Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === "Save reviewed goal",
    )?.disabled,
  ).toBe(true);
  await enter("Initial measured value", "0");
  expect(
    Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === "Save reviewed goal",
    )?.disabled,
  ).toBe(false);
});
it("keeps measurement header position and focused authored reason across ready/pending for31s", async () => {
  s.request.mockResolvedValue({ options: [] });
  const goal: any = {
    id: "quality",
    version: 7,
    current: 4.8,
    unit: "private-unit",
  };
  await render(createElement(GoalMeasurementForm, { goal, ready: true }));
  await enter("Measurement reason", "Stationary authored reason");
  const editor = c.querySelector(
    '[aria-label="Measurement reason"]',
  ) as HTMLInputElement;
  editor.focus();
  const slot = Array.from(editor.parentElement!.children).indexOf(editor);
  await render(createElement(GoalMeasurementForm, { goal, ready: false }));
  expect(Array.from(editor.parentElement!.children).indexOf(editor)).toBe(slot);
  expect(c.textContent).not.toContain("private-unit");
  expect(document.activeElement).toBe(editor);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 31000));
  });
  expect(document.activeElement).toBe(editor);
  expect(editor.value).toBe("Stationary authored reason");
  expect(Array.from(editor.parentElement!.children).indexOf(editor)).toBe(slot);
  await render(createElement(GoalMeasurementForm, { goal, ready: true }));
  expect(document.activeElement).toBe(editor);
  expect(Array.from(editor.parentElement!.children).indexOf(editor)).toBe(slot);
}, 40000);
it("retains only measured planning extent while current deep header reads are held31s, then restores drill", async () => {
  const summary: any = {
    projectionBasis: "basis",
    methodDescription: "Current methodology",
    coverage: { uniqueSelectedRemainingHours: 8, weeklyExposureHours: 24 },
    weeks: [
      {
        from: "2026-10-05",
        to: "2026-10-11",
        remainingHours: 8,
        people: [
          {
            id: "actor",
            name: "Private planning person",
            recordedCapacity: 40,
            remainingHours: 8,
            utilization: 20,
          },
        ],
        drill: { category: "scheduled", week: "2026-10-05" },
      },
    ],
  };
  let held = false;
  let release!: () => void;
  s.request.mockImplementation(async (path: string) => {
    if (path.includes("/planning/summary")) {
      if (held) await new Promise<void>((r) => (release = r));
      return summary;
    }
    return { warnings: [], tasks: [] };
  });
  await render(createElement(PlanningScreen));
  await act(async () => {
    s.lastList.onContentSizeChange(430, 5000);
    s.lastList.ListHeaderComponent.props.onLayout({
      nativeEvent: { layout: { height: 4500 } },
    });
  });
  held = true;
  s.w.executionEpoch = 1;
  await render(createElement(PlanningScreen));
  expect(s.lastList.contentContainerStyle.minHeight).toBe(5000);
  expect(c.textContent).not.toContain("Private planning person");
  await act(async () => {
    await new Promise((r) => setTimeout(r, 31000));
  });
  expect(s.lastList.contentContainerStyle.minHeight).toBe(5000);
  await act(async () => {
    held = false;
    release();
    await new Promise((r) => setTimeout(r, 10));
  });
  expect(c.textContent).toContain("Private planning person");
  await press("Inspect week");
  expect(c.textContent).toContain("Authorized task drill");
}, 40000);
it("actual GoalScreen metadata sheet loads new authority/version despite its stored stale item", async () => {
  let current: any = {
    id: "quality",
    name: "Original parent goal",
    description: "",
    version: 7,
    ownerId: "actor",
    departmentId: "",
    baseline: 8,
    target: 3,
    current: 4.8,
    unit: "defects",
    taskIds: [],
    dueDate: "",
    currentMeasurementId: "initial",
  };
  const posts: any[] = [];
  s.request.mockImplementation(
    async (path: string, method: string, body: any) => {
      if (method === "PATCH") {
        posts.push(body);
        if (posts.length === 1)
          throw new NativeApiError(409, "conflict", "Parent goal changed");
        return { ok: true };
      }
      if (path.endsWith("/measurements")) return { measurements: [] };
      return { goal: current, canEdit: true, canMeasure: true, attainment: 64 };
    },
  );
  await render(createElement(GoalScreen, { id: "quality" }));
  await press("Edit goal metadata");
  await enter("Goal name", "Authored before parent refresh");
  await enter("Goal metadata reason", "Parent route recovery");
  await press("Save reviewed goal");
  current = { ...current, version: 9, name: "Current parent goal" };
  s.w.executionEpoch = 1;
  await render(createElement(GoalScreen, { id: "quality" }));
  expect(
    (c.querySelector('[aria-label="Goal name"]') as HTMLInputElement).value,
  ).toBe("Authored before parent refresh");
  await press("Load latest goal and version");
  await press("Save reviewed goal");
  expect(posts[1]).toMatchObject({ version: 9, name: "Current parent goal" });
  expect(posts[1].retryKey).not.toBe(posts[0].retryKey);
});

it("reserves measured correction geometry while withholding inherited private text and wrapped unit", async () => {
  s.request.mockResolvedValue({ options: [] });
  const goal: any = {
    id: "quality",
    version: 7,
    current: 4.8,
    unit: "long private unit ".repeat(30),
    currentMeasurementId: "old",
  };
  const correction: any = {
    id: "old",
    value: 4.8,
    unit: goal.unit,
    effectiveAt: "2026-10-10T01:02:03.123456Z",
  };
  await render(
    createElement(GoalMeasurementForm, { goal, correction, ready: true }),
  );
  await enter("Measurement reason", "Correction authored reason");
  const editor = c.querySelector(
    '[aria-label="Measurement reason"]',
  ) as HTMLInputElement;
  editor.focus();
  const header = s.lastList.ListHeaderComponent.props.children[0];
  const inherited = header.props.children.find(
    (n: any) => n?.props?.accessibilityLabel === "Correction source",
  );
  expect(inherited).toBeTruthy();
  await act(async () =>
    inherited.props.onLayout({ nativeEvent: { layout: { height: 126 } } }),
  );
  await render(
    createElement(GoalMeasurementForm, { goal, correction, ready: false }),
  );
  const pendingHeader = s.lastList.ListHeaderComponent.props.children[0];
  const pending = pendingHeader.props.children.find(
    (n: any) => n?.props?.accessibilityLabel === "Correction source",
  );
  expect(pending.props.style.minHeight).toBe(126);
  expect(c.textContent).not.toContain("long private unit");
  expect(c.textContent).not.toContain(correction.effectiveAt);
  expect(c.textContent).not.toContain("Changes the current measurement");
  expect(document.activeElement).toBe(editor);
  const valueLabel = pendingHeader.props.children.find(
    (n: any) => n?.props?.children?.[0] === "Measured value ",
  );
  expect(valueLabel.props.numberOfLines).toBe(1);
  await render(
    createElement(GoalMeasurementForm, { goal, correction, ready: true }),
  );
  expect(document.activeElement).toBe(editor);
  expect(editor.value).toBe("Correction authored reason");
});

it("requires an explicit observation time while preserving ordinary task all-day semantics", async () => {
  s.request.mockResolvedValue({ options: [] });
  const goal: any = {
    id: "quality",
    version: 7,
    current: 4.8,
    unit: "defects",
  };
  await render(createElement(GoalMeasurementForm, { goal, ready: true }));
  await enter("Measurement reason", "Explicit observation");
  expect(c.textContent).not.toContain("Use all-day deadline");
  await enter("Observation time", "");
  expect(
    Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === "Save measured result",
    )?.disabled,
  ).toBe(true);
  await enter("Observation time", "10:30");
  expect(
    Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === "Save measured result",
    )?.disabled,
  ).toBe(false);

  await act(() => root.unmount());
  root = createRoot(c);
  await render(
    createElement(GoalMetadataForm, { ready: true, onClose: vi.fn() }),
  );
  await enter("Goal name", "New outcome");
  await enter("Initial measurement reason", "Initial evidence");
  await enter("Observation time", "");
  expect(
    Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === "Save reviewed goal",
    )?.disabled,
  ).toBe(true);
});
it("reconstructs frozen measurement controls after graph-only draft clearing", async () => {
  const goal: any = {
    id: "frozen",
    version: 7,
    current: 4.8,
    baseline: 8,
    target: 3,
    unit: "defects",
  };
  const bodies: any[] = [];
  s.request.mockImplementation(
    async (path: string, method: string, body: any) => {
      if (path.endsWith("/measurements")) {
        bodies.push(body);
        if (bodies.length === 1) throw Error("lost ACK");
        return { id: "frozen" };
      }
      return { options: [] };
    },
  );
  await render(createElement(GoalMeasurementForm, { goal, ready: true }));
  await enter("Measured value", "2.7");
  await enter("Measurement reason", "Frozen human observation");
  await press("Save measured result");
  await render(null);
  clearAllDrafts();
  await render(
    createElement(GoalMeasurementForm, {
      goal: { ...goal, current: 1, version: 9 },
      ready: true,
    }),
  );
  expect(
    (c.querySelector('[aria-label="Measured value"]') as HTMLInputElement)
      .value,
  ).toBe("2.7");
  expect(
    (c.querySelector('[aria-label="Measurement reason"]') as HTMLInputElement)
      .value,
  ).toBe("Frozen human observation");
  await press("Retry same measurement");
  expect(bodies[1]).toEqual(bodies[0]);
});
