// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import KnowledgeScreen from "./KnowledgeScreen";
import { clearAllDrafts } from "./conversationDrafts";
import { clearAllBusinessAttempts } from "../../shared/business/attempts";
vi.mock("./shareDocument", () => ({ shareDocument: vi.fn() }));
const h = vi.hoisted(() => ({
  request: vi.fn(),
  w: {
    company: "co",
    foreground: true,
    policyEpoch: 1,
    session: { user: { id: "me" } },
    refresh: async () => {},
    work: {
      readBasis: "basis",
      company: { name: "Fictional company", timezone: "Asia/Kolkata" },
      me: { id: "me", role: "member" },
      people: [
        {
          id: "reviewer",
          name: "Fictional reviewer",
          active: true,
          role: "member",
        },
        {
          id: "reader",
          name: "Fictional reader",
          active: true,
          role: "member",
        },
      ],
    },
  },
}));
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
vi.mock("./ReportControls", () => ({
  ReportField: ({ label, value, onChange }: any) =>
    createElement("input", {
      "aria-label": label,
      value,
      onChange: (e: any) => onChange(e.target.value),
    }),
}));
vi.mock("./PersonPicker", () => ({
  default: ({ label, onChange, value }: any) =>
    createElement(
      "select",
      {
        "aria-label": label,
        value,
        onChange: (e: any) => onChange(e.target.value),
      },
      createElement("option", { value: "" }, "Choose"),
      createElement("option", { value: "reviewer" }, "Fictional reviewer"),
      createElement("option", { value: "reader" }, "Fictional reader"),
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
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  ScrollView: ({ children }: any) => createElement("div", {}, children),
  Pressable: ({ children, onPress, accessibilityLabel }: any) =>
    createElement(
      "button",
      { onClick: onPress, "aria-label": accessibilityLabel },
      children,
    ),
  TextInput: ({ accessibilityLabel, value, onChangeText }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      onChange: (e: any) => onChangeText(e.target.value),
    }),
  FlatList: ({
    data,
    ListHeaderComponent,
    ListEmptyComponent,
    renderItem,
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
  clearAllDrafts();
  clearAllBusinessAttempts();
});
it("requires explicit publication audience review and saves a draft without self-publishing", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const writes: any[] = [];
  h.request.mockImplementation(
    async (_p: string, method = "GET", body: any) => {
      if (method !== "GET") {
        writes.push(body);
        throw Error("Offline");
      }
      return { articles: [], hasMore: false, cursor: "" };
    },
  );
  const node = document.createElement("div"),
    root = createRoot(node);
  const click = async (s: string) =>
    act(async () =>
      [...node.querySelectorAll("button")]
        .find((b) => b.textContent === s)!
        .click(),
    );
  const fill = async (label: string, value: string) =>
    act(async () => {
      const el = node.querySelector(`[aria-label="${label}"]`)!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  try {
    await act(async () => root.render(<KnowledgeScreen />));
    await click("New guidance");
    await fill("Guidance title", "Engineering handover");
    await fill("Guidance body", "Check drawings before handover.");
    expect(
      [...node.querySelectorAll("button")].find(
        (b) => b.textContent === "Save guidance draft",
      )!.disabled,
    ).toBe(true);
    await fill("Guidance review due YYYY-MM-DD", "2026-12-31");
    await act(async () => {
      const select = node.querySelector(
        '[aria-label="Independent guidance reviewer"]',
      ) as HTMLSelectElement;
      select.value = "reviewer";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click("I reviewed this guidance and publication audience");
    await click("Save guidance draft");
    expect(writes).toHaveLength(1);
    expect(writes[0].state).toBe("draft");
    await click("Retry original guidance submission");
    expect(writes[1]).toEqual(writes[0]);
  } finally {
    await act(async () => root.unmount());
  }
});

// Exercise the production RAM input and business-attempt hooks across real root remounts.
async function mountScreen() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const node = document.createElement("div"),
    root = createRoot(node);
  await act(async () => root.render(<KnowledgeScreen />));
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
  "keeps a v1 guidance %s draft and unknown retry source/audience across v2 remounts, with deliberate %s retirement",
  async (mode, retirement) => {
    let article = {
      id: "a",
      ownerId: "me",
      pilot: "engineering",
      title: "Original guide",
      body: "Original guidance body",
      reviewerId: "reviewer",
      audience: "company",
      readerIds: [] as string[],
      state: "draft",
      reviewDueDate: "2026-12-31",
      version: 1,
    };
    const writes: { path: string; body: any }[] = [];
    let succeed = false;
    h.request.mockImplementation(
      async (path: string, method = "GET", body: any) => {
        if (method !== "GET") {
          writes.push({ path, body });
          if (!succeed) throw Error("Offline");
          return { id: "a", version: 3 };
        }
        if (path.includes("/knowledge?")) return { articles: [article] };
        return { article, reviews: [], canEdit: true, canReview: true };
      },
    );
    const open = async (view: Awaited<ReturnType<typeof mountScreen>>) => {
      await view.click("Open guidance: " + article.title);
      await view.click(
        mode === "edit" ? "Edit guidance draft" : "Review guidance publication",
      );
    };
    let view = await mountScreen();
    try {
      await open(view);
      await view.fill(
        mode === "edit" ? "Guidance title" : "Guidance review reason",
        mode === "edit" ? "Authored title" : "Checked original guidance",
      );
      await view.unmount();
      article = {
        ...article,
        version: 2,
        title: "Concurrent guide",
        body: "Concurrent guidance body",
        audience: "selected",
        readerIds: ["reader"],
      };
      view = await mountScreen();
      await open(view);
      if (mode === "edit") {
        expect(
          (
            view.node.querySelector(
              '[aria-label="Guidance title"]',
            ) as HTMLInputElement
          ).value,
        ).toBe("Authored title");
        await view.click("I reviewed this guidance and publication audience");
        await view.click("Save guidance draft");
      } else {
        const sheet = view.node.querySelector(
          '[aria-label="Review guidance publication"]',
        )!;
        expect(sheet.textContent).toContain(
          "Original guide · reviewed version 1",
        );
        expect(sheet.textContent).toContain("Original guidance body");
        expect(sheet.textContent).toContain("all active company members");
        await view.click("I reviewed this decision and publication audience");
        await view.click("Record guidance review");
      }
      expect(writes[0].body.expectedVersion).toBe(1);
      expect(writes[0].path).toBe(
        "/companies/co/knowledge/a" + (mode === "review" ? "/review" : ""),
      );
      await view.unmount();
      view = await mountScreen();
      await open(view);
      if (mode === "review") {
        const sheet = view.node.querySelector(
          '[aria-label="Review guidance publication"]',
        )!;
        expect(sheet.textContent).toContain(
          "Original guide · reviewed version 1",
        );
        expect(sheet.textContent).toContain("all active company members");
        expect(sheet.textContent).toContain("Original guidance body");
      }
      succeed = true;
      if (retirement === "success") {
        await view.click(
          mode === "edit"
            ? "Retry original guidance submission"
            : "Retry original publication decision",
        );
        expect(writes[1]).toEqual(writes[0]);
        await view.click(
          mode === "edit"
            ? "Edit guidance draft"
            : "Review guidance publication",
        );
      } else {
        await view.click(
          mode === "edit"
            ? "Discard guidance attempt and review latest"
            : "Discard publication attempt and review latest",
        );
        expect(writes).toHaveLength(1);
      }
      if (mode === "edit")
        expect(
          (
            view.node.querySelector(
              '[aria-label="Guidance title"]',
            ) as HTMLInputElement
          ).value,
        ).toBe("Concurrent guide");
      else {
        expect(
          (
            view.node.querySelector(
              '[aria-label="Guidance review reason"]',
            ) as HTMLInputElement
          ).value,
        ).toBe("");
        expect(
          view.node.querySelector('[aria-label="Review guidance publication"]')!
            .textContent,
        ).toContain("Concurrent guide · reviewed version 2");
        expect(
          view.node.querySelector('[aria-label="Review guidance publication"]')!
            .textContent,
        ).toContain("selected readers: reader");
      }
      if (retirement === "reset") {
        if (mode === "edit") {
          await view.click("I reviewed this guidance and publication audience");
          await view.click("Save guidance draft");
        } else {
          await view.fill(
            "Guidance review reason",
            "Checked concurrent guidance",
          );
          await view.click("I reviewed this decision and publication audience");
          await view.click("Record guidance review");
        }
        expect(writes[1].body.expectedVersion).toBe(2);
        expect(writes[1].body.retryKey).not.toBe(writes[0].body.retryKey);
      }
    } finally {
      await view.unmount();
    }
  },
);
