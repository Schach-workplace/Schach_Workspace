// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import GrowthScreen from "./GrowthScreen";
import { clearAllBusinessAttempts } from "../../shared/business/attempts";
import { clearAllDrafts } from "./conversationDrafts";
const h = vi.hoisted(() => ({ request: vi.fn(), w: {} as any }));
vi.mock("./Workspace", () => ({
  useWorkspace: () => h.w,
  Page: ({ children }: any) => createElement("div", {}, children),
}));
vi.mock("./client", () => ({
  client: {
    endpoint: "https://fictional.invalid",
    generation: 1,
    request: h.request,
  },
  NativeApiError: class extends Error {},
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("./PersonPicker", () => ({
  default: ({ value, onChange, label, disabled }: any) =>
    createElement(
      "select",
      {
        "aria-label": label,
        value,
        disabled,
        onChange: (e: any) => onChange(e.target.value),
      },
      createElement("option", { value: "" }, "Only you"),
      createElement("option", { value: "mentor" }, "Fictional mentor"),
    ),
}));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  Sheet: ({ title, children }: any) =>
    createElement("section", { "aria-label": title }, children),
}));
vi.mock("react-native", () => ({
  StyleSheet: { create: (x: any) => x },
  ScrollView: ({ children }: any) => createElement("div", {}, children),
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  Pressable: ({ children, onPress, accessibilityLabel }: any) =>
    createElement(
      "button",
      { onClick: onPress, "aria-label": accessibilityLabel },
      children,
    ),
  TextInput: ({
    value,
    onChangeText,
    accessibilityLabel,
    editable,
    multiline,
  }: any) =>
    createElement(multiline ? "textarea" : "input", {
      "aria-label": accessibilityLabel,
      value,
      disabled: editable === false,
      onChange: (e: any) => onChangeText(e.target.value),
    }),
  FlatList: ({
    data,
    renderItem,
    ListHeaderComponent,
    ListEmptyComponent,
  }: any) =>
    createElement(
      "div",
      {},
      ListHeaderComponent,
      data.length
        ? data.map((item: any) =>
            createElement("div", { key: item.id }, renderItem({ item })),
          )
        : ListEmptyComponent,
    ),
}));
afterEach(() => {
  clearAllBusinessAttempts();
  clearAllDrafts();
});
it.each(["engineering", "office", "field"])(
  "creates %s only after audience review, preserves learning line breaks and freezes unknown retries",
  async (pilot) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    h.w = {
      company: "co",
      foreground: true,
      policyEpoch: 1,
      work: {
        readBasis: "basis",
        me: { id: "me", role: "member" },
        people: [
          {
            id: "mentor",
            name: "Fictional mentor",
            active: true,
            role: "member",
          },
        ],
      },
      session: { user: { id: "me" } },
      refresh: async () => {},
    };
    const pilots = ["engineering", "office", "field"].map((id) => ({
      id,
      label: id,
      careerRoles: ["Learner"],
      levels: ["foundation"],
      competencies: [{ id: id + ".one", label: id + " competency" }],
      suggestedLearning: ["Practice together"],
    }));
    const attempts: any[] = [];
    h.request.mockImplementation(
      async (path: string, method = "GET", body: any) => {
        if (method !== "GET") {
          attempts.push(body);
          throw Error("Network interrupted");
        }
        if (path.endsWith("/catalog")) return { pilots };
        return { plans: [], hasMore: false, cursor: "" };
      },
    );
    const node = document.createElement("div"),
      root = createRoot(node);
    const click = async (title: string) =>
      act(async () =>
        [...node.querySelectorAll("button")]
          .find((b) => b.textContent === title)!
          .click(),
      );
    const fill = async (label: string, value: string) =>
      act(async () => {
        const input = node.querySelector(`[aria-label="${label}"]`)!;
        Object.getOwnPropertyDescriptor(
          input.tagName === "TEXTAREA"
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    try {
      await act(async () => root.render(<GrowthScreen />));
      await click("New development plan");
      await click(pilot);
      await fill("Plan title", "Grow through practice");
      await fill(
        "Development objective",
        "Develop a reliable handover practice",
      );
      await click(pilot + " competency");
      await fill("Learning actions (one per line)", "First action\n");
      expect(
        (
          node.querySelector(
            '[aria-label="Learning actions (one per line)"]',
          ) as HTMLTextAreaElement
        ).value,
      ).toBe("First action\n");
      await fill(
        "Learning actions (one per line)",
        "First action\nSecond action",
      );
      expect(
        [...node.querySelectorAll("button")].find(
          (b) => b.textContent === "Save development plan",
        )!.disabled,
      ).toBe(true);
      await click("I reviewed this plan and audience");
      await click("Save development plan");
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({
        pilot,
        title: "Grow through practice",
        learningActions: ["First action", "Second action"],
      });
      expect(
        (node.querySelector('[aria-label="Plan title"]') as HTMLInputElement)
          .disabled,
      ).toBe(true);
      await click("Retry original plan submission");
      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toEqual(attempts[0]);
    } finally {
      await act(async () => root.unmount());
    }
  },
);

// Exercise the production RAM input and business-attempt hooks across real root remounts.
async function mountScreen() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const node = document.createElement("div"),
    root = createRoot(node);
  await act(async () => root.render(<GrowthScreen />));
  return {
    node,
    unmount: () => act(async () => root.unmount()),
    click: (title: string) =>
      act(async () => {
        const button = [...node.querySelectorAll("button")].find(
          (b) =>
            b.textContent === title || b.getAttribute("aria-label") === title,
        );
        expect(button, title).toBeTruthy();
        button!.click();
      }),
    fill: (label: string, value: string) =>
      act(async () => {
        const input = node.querySelector(`[aria-label="${label}"]`)!;
        expect(input, label).toBeTruthy();
        Object.getOwnPropertyDescriptor(
          input.tagName === "TEXTAREA"
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }),
  };
}

it.each([
  ["edit", "success"],
  ["review", "success"],
  ["edit", "reset"],
  ["review", "reset"],
])(
  "keeps a v1 growth %s draft and unknown retry bound across v2 remounts, with deliberate %s retirement",
  async (mode, retirement) => {
    h.w = {
      company: "co",
      foreground: true,
      policyEpoch: 1,
      session: { user: { id: "me" } },
      refresh: async () => {},
      work: {
        readBasis: "basis",
        me: { id: "me", role: "member" },
        people: [
          {
            id: "mentor",
            name: "Fictional mentor",
            active: true,
            role: "member",
          },
        ],
      },
    };
    let plan = {
      id: "p",
      ownerId: "me",
      pilot: "engineering",
      title: "Original plan",
      careerRole: "Learner",
      careerLevel: "foundation",
      competencyIds: ["engineering.one"],
      objective: "Original objective",
      learningActions: ["Original practice"],
      evidenceNote: "Original evidence",
      mentorId: "mentor",
      state: "active",
      version: 1,
    };
    const pilots = [
      {
        id: "engineering",
        label: "Engineering",
        careerRoles: ["Learner"],
        levels: ["foundation"],
        competencies: [{ id: "engineering.one", label: "Competency" }],
        suggestedLearning: [],
      },
    ];
    const writes: { path: string; body: any }[] = [];
    let succeed = false;
    h.request.mockImplementation(
      async (path: string, method = "GET", body: any) => {
        if (method !== "GET") {
          writes.push({ path, body });
          if (!succeed) throw Error("Offline");
          return { id: "p", version: 3 };
        }
        if (path.endsWith("/catalog")) return { pilots };
        if (path.endsWith("/plans")) return { plans: [plan] };
        return { plan, reviews: [], canEdit: true, canReview: true };
      },
    );
    const open = async (view: Awaited<ReturnType<typeof mountScreen>>) => {
      await view.click("Open development plan: " + plan.title);
      await view.click(
        mode === "edit" ? "Edit development plan" : "Add mentor feedback",
      );
    };
    let view = await mountScreen();
    try {
      await open(view);
      await view.fill(
        mode === "edit"
          ? "Learning actions (one per line)"
          : "Mentor observations",
        mode === "edit" ? "Authored practice\n" : "Original observations",
      );
      await view.unmount();
      plan = {
        ...plan,
        version: 2,
        title: "Concurrent plan",
        objective: "Concurrent objective",
        learningActions: ["Concurrent practice"],
        mentorId: "other",
      };
      view = await mountScreen();
      await open(view);
      if (mode === "edit") {
        expect(
          (
            view.node.querySelector(
              '[aria-label="Learning actions (one per line)"]',
            ) as HTMLTextAreaElement
          ).value,
        ).toBe("Authored practice\n");
        await view.click("I reviewed this plan and audience");
        await view.click("Save development plan");
      } else {
        const sheet = view.node.querySelector(
          '[aria-label="Mentor feedback"]',
        )!;
        expect(sheet.textContent).toContain("reviewed version 1");
        expect(sheet.textContent).toContain("Original objective");
        expect(sheet.textContent).toContain("Mentor mentor");
        await view.fill("Next development step", "Repeat original practice");
        await view.click("Publish mentor feedback");
      }
      expect(writes[0].body.expectedVersion).toBe(1);
      expect(writes[0].path).toBe(
        "/companies/co/growth/plans/p" + (mode === "review" ? "/reviews" : ""),
      );
      await view.unmount();
      view = await mountScreen();
      await open(view);
      if (mode === "review") {
        const sheet = view.node.querySelector(
          '[aria-label="Mentor feedback"]',
        )!;
        expect(sheet.textContent).toContain("reviewed version 1");
        expect(sheet.textContent).toContain("Mentor mentor");
      }
      succeed = true;
      if (retirement === "success") {
        await view.click(
          mode === "edit"
            ? "Retry original plan submission"
            : "Retry original mentor feedback",
        );
        expect(writes[1]).toEqual(writes[0]);
        await view.click(
          mode === "edit" ? "Edit development plan" : "Add mentor feedback",
        );
      } else {
        await view.click(
          mode === "edit"
            ? "Discard attempt and review current plan"
            : "Discard feedback attempt and review latest",
        );
        expect(writes).toHaveLength(1);
      }
      if (mode === "edit")
        expect(
          (
            view.node.querySelector(
              '[aria-label="Learning actions (one per line)"]',
            ) as HTMLTextAreaElement
          ).value,
        ).toBe("Concurrent practice");
      else {
        expect(
          (
            view.node.querySelector(
              '[aria-label="Mentor observations"]',
            ) as HTMLTextAreaElement
          ).value,
        ).toBe("");
        expect(
          view.node.querySelector('[aria-label="Mentor feedback"]')!
            .textContent,
        ).toContain("reviewed version 2");
      }
      if (retirement === "reset") {
        if (mode === "edit") {
          await view.click("I reviewed this plan and audience");
          await view.click("Save development plan");
        } else {
          await view.fill(
            "Mentor observations",
            "Checked concurrent objective",
          );
          await view.fill("Next development step", "Next concurrent practice");
          await view.click("Publish mentor feedback");
        }
        expect(writes[1].body.expectedVersion).toBe(2);
        expect(writes[1].body.retryKey).not.toBe(writes[0].body.retryKey);
      }
    } finally {
      await view.unmount();
    }
  },
);
