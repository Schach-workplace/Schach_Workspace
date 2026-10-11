// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import PeopleOnboarding from "./PeopleOnboarding";
import AccessReview from "./AccessReview";
import DepartureHandover from "./DepartureHandover";
import {
  clearAllBusinessAttempts,
  readAttempt,
} from "../../shared/business/attempts";
import { clearAllDrafts } from "./conversationDrafts";
const state = vi.hoisted(() => ({ w: {} as any, request: vi.fn() }));
vi.mock("./client", () => ({
  client: {
    endpoint: "https://fictional.invalid",
    generation: 1,
    request: state.request,
  },
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
vi.mock("@react-native-community/datetimepicker", () => ({
  default: () => null,
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-router", () => ({
  router: { replace: vi.fn(), back: vi.fn(), push: vi.fn() },
}));
vi.mock("./Workspace", () => ({ useWorkspace: () => state.w }));
vi.mock("./PeoplePage", () => ({
  default: ({ children }: { children: ReactNode }) =>
    createElement("div", {}, children),
}));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  Sheet: ({ children, title }: any) =>
    createElement("section", { "aria-label": title }, children),
}));
vi.mock("react-native", () => ({
  Text: ({ children }: any) => createElement("span", {}, children),
  View: ({ children, style }: any) => createElement("div", { style }, children),
  TextInput: ({
    value,
    onChangeText,
    accessibilityLabel,
    secureTextEntry,
    editable,
  }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      type: secureTextEntry ? "password" : "text",
      disabled: editable === false,
      onChange: (e: any) => onChangeText(e.target.value),
    }),
  FlatList: ({ data, renderItem }: any) =>
    createElement(
      "div",
      {},
      data.map((item: any) =>
        createElement("div", { key: item.id }, renderItem({ item })),
      ),
    ),
}));
let root: Root, c: HTMLDivElement;
const people = [
  {
    id: "actor",
    membershipId: "ma",
    name: "Fictional Admin",
    email: "admin@example.invalid",
    role: "founder",
    departmentId: "",
    managerId: "",
    title: "",
    capacityHours: 40,
    active: true,
    membershipVersion: 1,
    memberAccessEpoch: 1,
    companyPermissionEpoch: 1,
  },
  {
    id: "target",
    membershipId: "mt",
    name: "Fictional Member",
    email: "member@example.invalid",
    role: "member",
    departmentId: "",
    managerId: "",
    title: "",
    capacityHours: 40,
    active: true,
    membershipVersion: 1,
    memberAccessEpoch: 1,
    companyPermissionEpoch: 1,
  },
];
const effect = {
  reauthenticate: true,
  scope: "account_sessions",
  devicesMustReregister: true,
  callsMustRejoin: true,
  otherCompanyMembershipsPreserved: true,
};
const render = async (node: ReactNode) =>
  act(async () => {
    root.render(node);
    await new Promise((r) => setTimeout(r, 10));
  });
const press = async (title: string) =>
  act(async () => {
    const b = [...c.querySelectorAll("button")].find(
      (b) => b.textContent === title,
    );
    expect(b, "button " + title).toBeTruthy();
    expect(b!.disabled).toBe(false);
    b!.click();
    await new Promise((r) => setTimeout(r, 10));
  });
const enter = async (label: string, value: string) =>
  act(async () => {
    const el = c.querySelector(
      '[aria-label="' + label + '"]',
    ) as HTMLInputElement;
    expect(el).toBeTruthy();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  clearAllBusinessAttempts();
  clearAllDrafts();
  c = document.createElement("div");
  document.body.append(c);
  root = createRoot(c);
  state.w = {
    company: "company",
    session: { user: { id: "actor" } },
    foreground: true,
    policyEpoch: 0,
    recordEpoch: 0,
    attentionEpoch: 0,
    work: {
      readBasis: "current",
      me: people[0],
      people,
      departments: [],
      company: { timezone: "UTC" },
    },
    refresh: vi.fn().mockResolvedValue(undefined),
    setError: vi.fn(),
  };
  state.request.mockReset();
});
afterEach(async () => {
  await act(() => root.unmount());
  c.remove();
});
function reads(path: string) {
  if (path.endsWith("/people/context"))
    return {
      people,
      departments: [],
      roles: ["founder", "admin", "member"],
      readBasis: "current",
    };
  if (
    path.endsWith("/people/presets") ||
    path.endsWith("/people/access-reviews")
  )
    return { items: [] };
  if (path.endsWith("/task-templates")) return { templates: [] };
  if (path.endsWith("/projects")) return { projects: [] };
  return undefined;
}
it("retains exact submitted onboarding after lost ACK and clears the credential before failed refresh", async () => {
  const submitted: any[] = [];
  state.request.mockImplementation(
    async (path: string, method: string, body: any) => {
      const r = reads(path);
      if (r) return r;
      if (path.endsWith("/onboarding/preview"))
        return {
          id: "preview",
          version: 1,
          accountMode: "new_account",
          person: {
            name: "Fictional Starter",
            email: "starter@example.invalid",
          },
          grants: [],
          taskPreviews: [],
          unresolved: [],
          sessionEffect: effect,
        };
      if (path.endsWith("/onboarding/apply")) {
        submitted.push(body);
        if (submitted.length === 1) throw Error("Fictional lost ACK");
        return { id: "created", sessionEffect: effect };
      }
      throw Error("Unexpected endpoint");
    },
  );
  state.w.refresh.mockImplementation(async () => {
    expect(
      readAttempt({
        serverOrigin: "https://fictional.invalid",
        companyId: "company",
        userId: "actor",
        formId: "$people-onboard-apply",
      }),
    ).toBeUndefined();
    expect(c.querySelector('input[type="password"]')).toBeNull();
    throw Error("Fictional dependent refresh failure");
  });
  await render(createElement(PeopleOnboarding));
  await enter("Name", "Fictional Starter");
  await enter("Email", "starter@example.invalid");
  await press("Continue to access");
  await press("Continue to starting work");
  await press("Review onboarding");
  await enter("New account password", "fictional-never-log-123");
  await press("Confirm onboarding");
  expect(c.textContent).toContain("Retry the same submission");
  expect(c.querySelector('input[type="password"]')).toBeNull();
  await render(null);
  clearAllDrafts();
  state.w.work = { ...state.w.work, readBasis: "other-graph" };
  await render(createElement(PeopleOnboarding));
  await press("Retry the same submission");
  expect(submitted).toHaveLength(2);
  expect(submitted[1]).toEqual(submitted[0]);
  expect(c.textContent).toContain("Company onboarding completed.");
  expect(c.textContent).not.toContain("Retry the same submission");
});
it("captures all reviewed memberships despite display filtering and records pending handover", async () => {
  let captured: any;
  state.request.mockImplementation(
    async (path: string, method: string, body: any) => {
      const r = reads(path);
      if (r) return r;
      if (path.endsWith("/access-reviews/preview")) {
        captured = body;
        return {
          id: "review",
          previewId: "preview",
          version: 1,
          sessionEffect: effect,
        };
      }
      if (path.endsWith("/review/complete"))
        return {
          id: "review",
          decisions: captured.decisions.map((d: any) => ({
            ...d,
            accessOutcome: "unchanged",
            handoverStatus:
              d.action === "departure_required" ? "pending" : "not_requested",
          })),
          sessionEffect: effect,
        };
      throw Error("Unexpected endpoint");
    },
  );
  await render(createElement(AccessReview));
  await press("Capture current company memberships");
  await enter("Review reason", "Quarterly fictional attestation");
  await act(async () => {
    const rows = [...c.querySelectorAll("button")].filter(
      (b) => b.textContent === "Access decision: Keep access",
    );
    rows[1].click();
    await new Promise((r) => setTimeout(r, 10));
  });
  await press("Departure follow-up required");
  await enter("Filter reviewed members", "Admin");
  await press("Preview access decisions");
  expect(captured.decisions).toHaveLength(2);
  expect(captured.decisions[1].action).toBe("departure_required");
  await press("Complete access attestation");
  expect(c.textContent).toContain("handover pending");
});
it("withholds blocked departure completion while direct revocation stays independently reachable", async () => {
  state.request.mockImplementation(
    async (path: string) =>
      reads(path) ?? {
        id: "departure-preview",
        version: 1,
        target: people[1],
        liveItems: [],
        retainedHistory: { tasks: 2 },
        unresolved: [
          {
            code: "private_review_resolution_required",
            message:
              "An independent private review requires authorized source resolution.",
          },
        ],
        sessionEffect: effect,
        readyToApply: false,
      },
  );
  await render(createElement(DepartureHandover, { userId: "target" }));
  await enter("Departure reason", "Reviewed fictional departure");
  await press("Inspect current obligations");
  expect(c.textContent).toContain("independent private review");
  expect(c.textContent).not.toContain("Complete company departure");
  expect(c.textContent).toContain("Revoke company access");
  expect(c.textContent).toContain("responsibilities retained");
});
it("holds authored access and password nodes while current reads are pending", async () => {
  let held = false;
  let release: (() => void) | undefined;
  state.request.mockImplementation(async (path: string) => {
    if (path.endsWith("/people/context") && held)
      await new Promise<void>((r) => {
        release = r;
      });
    return (
      reads(path) ?? {
        id: "held-preview",
        version: 1,
        accountMode: "new_account",
        person: { name: "Fictional", email: "fictional@example.invalid" },
        grants: [],
        taskPreviews: [],
        unresolved: [],
        sessionEffect: effect,
      }
    );
  });
  await render(createElement(PeopleOnboarding));
  await enter("Name", "Held fictional");
  await enter("Email", "held@example.invalid");
  await press("Continue to access");
  for (const label of ["Title", "Weekly capacity"]) {
    await enter(label, label === "Title" ? "Authored title" : "31.");
    const field = c.querySelector(
      `[aria-label="${label}"]`,
    ) as HTMLInputElement;
    field.focus();
    field.setSelectionRange(1, 2);
    const typed = field.value;
    held = true;
    state.w.recordEpoch++;
    await render(createElement(PeopleOnboarding));
    expect(release).toBeTruthy();
    expect(c.querySelector(`[aria-label="${label}"]`)).toBe(field);
    expect(field.disabled).toBe(false);
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe(typed);
    expect([field.selectionStart, field.selectionEnd]).toEqual([1, 2]);
    held = false;
    await act(async () => {
      release!();
      await new Promise((r) => setTimeout(r, 10));
    });
    release = undefined;
  }
  await enter("Weekly capacity", "31.5");
  await press("Continue to starting work");
  await press("Review onboarding");
  await enter("New account password", "fictional-held-secret");
  const password = c.querySelector("input[type=password]") as HTMLInputElement;
  password.focus();
  password.setSelectionRange(3, 7);
  held = true;
  state.w.recordEpoch++;
  await render(createElement(PeopleOnboarding));
  expect(release).toBeTruthy();
  const work = state.w.work;
  state.w.work = null;
  await render(createElement(PeopleOnboarding));
  expect(c.querySelector("input[type=password]") === password).toBe(true);
  expect(password.value.length).toBe(21);
  expect(document.activeElement === password).toBe(true);
  expect([password.selectionStart, password.selectionEnd]).toEqual([3, 7]);
  held = false;
  state.w.work = work;
  await act(async () => {
    release!();
    await new Promise((r) => setTimeout(r, 10));
  });
  await render(createElement(PeopleOnboarding));
});
it.each(["review", "departure"])(
  "keeps authored %s and an open picker through held current reads",
  async (mode) => {
    let held = false;
    let release: (() => void) | undefined;
    state.request.mockImplementation(async (path: string) => {
      if (path.endsWith("/people/context") && held)
        await new Promise<void>((r) => {
          release = r;
        });
      return (
        reads(path) ?? {
          id: "departure",
          version: 1,
          target: people[1],
          liveItems: [
            {
              kind: "task_owner",
              sourceId: "task",
              version: 7,
              title: "Fictional duty",
              state: "todo",
              candidates: [people[0]],
            },
          ],
          retainedHistory: { tasks: 1 },
          unresolved: [],
          readyToApply: false,
          sessionEffect: effect,
        }
      );
    });
    const node = () =>
      mode === "review"
        ? createElement(AccessReview)
        : createElement(DepartureHandover, { userId: "target" });
    await render(node());
    let field: HTMLInputElement;
    if (mode === "review") {
      await press("Capture current company memberships");
      await act(async () => {
        const rows = [...c.querySelectorAll("button")].filter(
          (b) => b.textContent === "Access decision: Keep access",
        );
        rows[1].click();
        await new Promise((r) => setTimeout(r, 10));
      });
      await press("Change reviewed access");
      await enter("Title", "Authored review");
      field = c.querySelector('input[aria-label="Title"]') as HTMLInputElement;
    } else {
      await enter("Departure reason", "Reviewed exit");
      await press("Inspect current obligations");
      await press("Replacement for task owner: Choose a current option");
      await enter("Find replacement for task owner", "Admin");
      field = c.querySelector(
        'input[aria-label="Find replacement for task owner"]',
      ) as HTMLInputElement;
    }
    field.focus();
    field.setSelectionRange(1, 3);
    held = true;
    state.w.recordEpoch++;
    await render(node());
    expect(release).toBeTruthy();
    expect(document.contains(field)).toBe(true);
    expect(field.disabled).toBe(false);
    expect(document.activeElement === field).toBe(true);
    expect([field.selectionStart, field.selectionEnd]).toEqual([1, 3]);
    if (mode === "departure") {
      const picker = c.querySelector(
        'section[aria-label="Replacement for task owner"]',
      );
      expect(picker?.textContent).toContain("Checking current options…");
      expect(picker?.textContent).not.toContain("Fictional Admin");
    }
    held = false;
    await act(async () => {
      release!();
      await new Promise((r) => setTimeout(r, 10));
    });
    await render(node());
  },
);

it("preserves sequential decimal and blank capacity drafts, validates sends, and reloads current membership", async () => {
  const { default: MembershipEditor } =
    await import("./PeopleMembershipEditor");
  state.request.mockImplementation(
    async (path: string) => reads(path) ?? { id: "saved" },
  );
  await render(
    createElement(MembershipEditor, { person: people[1], onClose: vi.fn() }),
  );
  const field = c.querySelector(
    '[aria-label="Weekly capacity"]',
  ) as HTMLInputElement;
  field.focus();
  for (const text of ["3", "31", "31.", "31.5"]) {
    await enter("Weekly capacity", text);
    expect(field.value).toBe(text);
    expect(c.querySelector('[aria-label="Weekly capacity"]')).toBe(field);
    expect(document.activeElement).toBe(field);
  }
  const save = () =>
    Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === "Save reviewed company access",
    )!;
  for (const text of ["", "31.", "169", "Infinity", "-1"]) {
    await enter("Weekly capacity", text);
    expect(field.value).toBe(text);
    expect(save().disabled).toBe(true);
  }
  await enter("Weekly capacity", "40");
  await enter("Weekly capacity", "40.");
  await press("Load current membership and version");
  expect(field.value).toBe("40");
  await enter("Weekly capacity", "31.");
  clearAllDrafts();
  await render(
    createElement(MembershipEditor, { person: people[1], onClose: vi.fn() }),
  );
  expect(field.value).toBe("40");
  for (const text of ["0", "168", ".5", "31.5"]) {
    await enter("Weekly capacity", text);
    expect(save().disabled).toBe(false);
  }
  await press("Save reviewed company access");
  const call = state.request.mock.calls.find(
    ([, method]) => method === "PATCH",
  );
  expect(call?.[2]).toMatchObject({
    capacityHours: 31.5,
    expectedVersion: people[1].membershipVersion,
  });
  expect(Object.hasOwn(call?.[2] ?? {}, "capacityInput")).toBe(false);
});

it.each(["onboarding", "preset", "review"])(
  "guards %s capacity and sends only a complete finite number",
  async (mode) => {
    const { default: Preset } = await import("./PeoplePresetEditor");
    state.request.mockImplementation(async (path: string, method: string) =>
      !method || method === "GET"
        ? reads(path)
        : {
            id: "result",
            version: 1,
            decisions: [],
            person: {},
            grants: [],
            taskPreviews: [],
            unresolved: [],
          },
    );
    if (mode === "onboarding") {
      await render(createElement(PeopleOnboarding));
      await enter("Name", "Fictional numeric");
      await enter("Email", "numeric@example.invalid");
      await press("Continue to access");
    } else if (mode === "preset") {
      await render(createElement(Preset));
      await enter("Preset name", "Fictional numeric preset");
    } else {
      await render(createElement(AccessReview));
      await press("Capture current company memberships");
      await enter("Review reason", "Fictional numeric review");
      await act(async () => {
        Array.from(c.querySelectorAll("button"))
          .filter((b) => b.textContent === "Access decision: Keep access")[1]
          .click();
      });
      await press("Change reviewed access");
    }
    const title =
      mode === "onboarding"
        ? "Continue to starting work"
        : mode === "preset"
          ? "Save reviewed preset"
          : "Preview access decisions";
    const submit = () =>
      Array.from(c.querySelectorAll("button")).find(
        (b) => b.textContent === title,
      )!;
    for (const text of ["", "31.", "168.1", "1e999"]) {
      await enter("Weekly capacity", text);
      expect(submit().disabled).toBe(true);
      expect(
        state.request.mock.calls.filter(
          ([, method]) => !!method && method !== "GET",
        ).length,
      ).toBe(0);
    }
    await enter("Weekly capacity", "31.5");
    expect(submit().disabled).toBe(false);
    await press(title);
    if (mode === "onboarding") await press("Review onboarding");
    const payload = state.request.mock.calls.find(
      ([, method]) => method === "POST",
    )?.[2];
    const membership =
      mode === "review"
        ? payload.decisions.find((d: any) => d.action === "change").fields
        : payload.membership;
    expect(membership.capacityHours).toBe(31.5);
    expect(Object.hasOwn(membership, "capacityInput")).toBe(false);
  },
);

it("discloses every ordered checklist requirement from the actual server preview before confirmation", async () => {
  // Captured by TestOnboardingReviewedTemplateTasks, not an invented preview DTO.
  const { default: fixture } =
    await import("../../shared/people/testdata/onboarding-review.json");
  state.request.mockImplementation(async (path: string) => {
    if (path.endsWith("/people/context")) return fixture.context;
    if (path.endsWith("/onboarding/preview")) return fixture.preview;
    if (path.endsWith("/projects")) return fixture.projects;
    return reads(path);
  });
  await render(createElement(PeopleOnboarding));
  await enter("Name", fixture.preview.person.name);
  await enter("Email", fixture.preview.person.email);
  await press("Continue to access");
  await press("Continue to starting work");
  await press("Review onboarding");
  expect(c.textContent).toContain("Complete the reviewed starting work");
  expect(c.textContent).toContain(
    "Owner: Founder · Independent reviewer: admin",
  );
  expect(c.textContent).toContain(
    "Project: Reviewed starting project · Project version: 1",
  );
  expect(c.textContent).toContain(
    "Status: todo · Priority: high · Estimated hours: 2.5",
  );
  expect(c.textContent).toContain("Start: 2026-10-11 · Due: 2026-10-14");
  expect(
    [...c.querySelectorAll("span")]
      .filter((el) => el.textContent?.startsWith("Checklist:"))
      .map((el) => el.textContent),
  ).toEqual([
    "Checklist: Read the complete starting handbook",
    "Checklist: Confirm the independent review requirements",
  ]);
  expect(
    [...c.querySelectorAll("button")].find(
      (b) => b.textContent === "Confirm onboarding",
    )?.disabled,
  ).toBe(true);
});

it("requires identity reentry after graph clearing before a fresh native preview", async () => {
  let previews = 0;
  state.request.mockImplementation(async (path: string) => {
    const r = reads(path);
    if (r) return r;
    if (path.endsWith("/onboarding/preview")) {
      previews++;
      return {
        id: "preview",
        version: 1,
        accountMode: "existing_account",
        person: { name: "Starter", email: "starter@example.invalid" },
        grants: [],
        taskPreviews: [],
        unresolved: [],
      };
    }
    throw Error("Unexpected request");
  });
  await render(createElement(PeopleOnboarding));
  await enter("Name", "Starter");
  await enter("Email", "starter@example.invalid");
  await press("Continue to access");
  await press("Continue to starting work");
  await press("Review onboarding");
  await act(async () => clearAllDrafts());
  expect(
    (c.querySelector('[aria-label="Name"]') as HTMLInputElement).value,
  ).toBe("");
  const fresh = [...c.querySelectorAll("button")].find(
    (b) => b.textContent === "Create fresh preview",
  )!;
  expect(fresh.disabled).toBe(true);
  await press("Edit reviewed choices");
  expect(
    c.querySelector('[aria-label="Name"]')?.closest('[style*="display: none"]'),
  ).toBeNull();
  expect(previews).toBe(1);
});

it.each([422, 409])(
  "captures corrected preview after explicit same-stack abandonment of HTTP %s",
  async (status) => {
    const { useExecutionMutation } = await import("./execution");
    const { NativeApiError } = await import("./client");
    let action!: ReturnType<typeof useExecutionMutation>;
    function Probe() {
      action = useExecutionMutation("$people-onboard-preview");
      return null;
    }
    const submitted: any[] = [];
    state.request.mockImplementation(async (_path, _method, body) => {
      submitted.push(body);
      if (!body.name || !body.email)
        throw new NativeApiError(
          status,
          "validation",
          "Enter a valid name and email.",
        );
      return { id: "corrected-preview", taskPreviews: [] };
    });
    await render(createElement(Probe));
    await act(async () => {
      await expect(
        action.execute("/people/onboarding/preview", {
          name: "",
          email: "",
          tasks: [],
        }),
      ).rejects.toThrow();
    });
    expect(action.attempt?.payload).toMatchObject({ name: "", email: "" });
    const sameRender = action;
    await act(async () => {
      sameRender.abandon();
      // No intervening render: this is the actual PeopleOnboarding.inspect path.
      await expect(
        sameRender.execute("/people/onboarding/preview", {
          name: "Reviewed Starter",
          email: "reviewed@example.invalid",
          tasks: [],
          expectedPresetVersion: 2,
        }),
      ).resolves.toMatchObject({ id: "corrected-preview" });
    });
    expect(submitted[1]).toMatchObject({
      name: "Reviewed Starter",
      email: "reviewed@example.invalid",
      expectedPresetVersion: 2,
    });
    expect(submitted[1].retryKey).not.toBe(submitted[0].retryKey);
    expect(action.attempt).toBeUndefined();
  },
);

it("preserves an unabandoned unknown attempt's exact payload, key, target and source versions", async () => {
  const { useExecutionMutation } = await import("./execution");
  let action!: ReturnType<typeof useExecutionMutation>;
  function Probe() {
    action = useExecutionMutation("$people-onboard-preview", [
      "/task-templates/original",
    ]);
    return null;
  }
  const submitted: any[] = [];
  state.request.mockImplementation(async (path, method, body) => {
    submitted.push({ path, method, body });
    throw Error("Unknown ACK");
  });
  await render(createElement(Probe));
  await act(async () => {
    await expect(
      action.execute("/people/onboarding/preview", {
        name: "Original",
        expectedPresetVersion: 2,
        tasks: [
          {
            templateId: "original",
            expectedTemplateVersion: 3,
            expectedProjectVersion: 4,
          },
        ],
      }),
    ).rejects.toThrow();
  });
  const original = action.attempt;
  await act(async () => {
    await expect(
      action.execute("/people/onboarding/preview", {
        name: "Changed",
        expectedPresetVersion: 9,
        tasks: [],
      }),
    ).rejects.toThrow("Unknown ACK");
  });
  expect(submitted).toHaveLength(2);
  expect(submitted[1]).toEqual(submitted[0]);
  expect(action.attempt).toBe(original);
  expect(action.attempt?.target?.sources).toEqual(["/task-templates/original"]);
  await act(async () => {
    await expect(
      action.execute("/people/onboarding/apply", {}),
    ).rejects.toThrow("original submitted target");
  });
  expect(submitted).toHaveLength(2);
});

it.each(["abandon", "hard clear"])(
  "ignores a late old ACK after %s and leaves a newer registry attempt intact",
  async (clear) => {
    const { useExecutionMutation } = await import("./execution");
    const { beginAttempt } = await import("../../shared/business/attempts");
    let action!: ReturnType<typeof useExecutionMutation>;
    function Probe() {
      action = useExecutionMutation("$people-onboard-preview");
      return null;
    }
    let resolve!: (value: unknown) => void;
    state.request.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await render(createElement(Probe));
    const committed = vi.fn();
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = action
        .execute(
          "/people/onboarding/preview",
          { name: "Old" },
          "POST",
          committed,
        )
        .catch((e) => e);
    });
    let fresh: unknown;
    await act(async () => {
      if (clear === "hard clear") clearAllBusinessAttempts();
      else action.abandon();
      fresh = beginAttempt(action.scope, { name: "New" }, "new-reviewed-key", {
        path: "/people/onboarding/preview",
        method: "POST",
      });
      resolve({ id: "old-preview" });
      expect(await pending).toBeInstanceOf(Error);
    });
    expect(committed).not.toHaveBeenCalled();
    expect(action.attempt).toBe(fresh);
  },
);
