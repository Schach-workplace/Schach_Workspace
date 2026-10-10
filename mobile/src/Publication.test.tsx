// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import Publication from "./Publication";
import { clearAllDrafts } from "./conversationDrafts";
const env = vi.hoisted(() => ({ request: vi.fn(), close: vi.fn() }));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("./client", () => ({
  client: { endpoint: "https://test", generation: 1, request: env.request },
}));
vi.mock("./Workspace", () => ({
  styles: {},
  useWorkspace: () => ({
    company: "c",
    session: { user: { id: "u" } },
    refresh: async () => {},
    work: {
      me: { departmentId: "d" },
      people: [],
      departments: [],
      company: { timezone: "Asia/Kolkata" },
      expenseCategories: [],
    },
  }),
}));
vi.mock("./PersonPicker", () => ({ default: () => null }));
vi.mock("./DeadlinePicker", () => ({ default: () => null }));
vi.mock("./ConnectUI", () => ({ Action: () => null }));
vi.mock("react-native", () => ({
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  Button: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  TextInput: ({ value, onChangeText, accessibilityLabel, editable }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      disabled: editable === false,
      onChange: (e: any) => onChangeText(e.target.value),
    }),
}));
afterEach(() => {
  clearAllDrafts();
  env.request.mockReset();
  env.close.mockReset();
});
it("retires only a confirmed publication and starts a new unlocked attempt after reopening", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const bodies: any[] = [];
  env.request.mockImplementation(async (path, _method, body) => {
    if (path.endsWith("/preview"))
      return { audienceUserIds: ["u"], notice: "Authorized audience" };
    bodies.push(body);
    if (bodies.length === 1) throw Error("Lost committed ACK");
    return { task: { id: "created" } };
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  const mount = () =>
    root.render(
      <Publication
        source={{ id: "source", body: "Selected source", revision: 1 } as any}
        conversation={{ id: "a", version: 1 } as any}
        onClose={env.close}
      />,
    );
  const click = async (label: string) =>
    act(async () => {
      const b = [...container.querySelectorAll("button")].find(
        (b) => b.textContent === label,
      )!;
      expect(b.disabled).toBe(false);
      b.click();
    });
  try {
    await act(async () => mount());
    await click("request");
    await click("Preview server audience");
    await click("I reviewed the selected content and audience");
    await click("Publish selected record");
    expect(env.close).not.toHaveBeenCalled();
    await act(async () => root.render(null));
    await act(async () => mount());
    await click("Retry the same publication");
    expect(bodies[1]).toEqual(bodies[0]);
    expect(env.close).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    await act(async () => mount());
    expect(container.textContent).not.toContain("Retry the same publication");
    await click("request");
    await click("Preview server audience");
    await click("I reviewed the selected content and audience");
    await click("Publish selected record");
    expect(bodies[2].retryKey).not.toBe(bodies[0].retryKey);
  } finally {
    await act(async () => root.unmount());
  }
});

it("does not install an earlier source audience preview after a mounted source changes", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let release: (v: any) => void = () => {};
  env.request.mockImplementation(() => new Promise((r) => (release = r)));
  const c = document.createElement("div");
  const root = createRoot(c);
  const mount = (id: string) =>
    root.render(
      <Publication
        source={{ id, body: "Source " + id, revision: 1 } as any}
        conversation={{ id: "a", version: 1 } as any}
        onClose={env.close}
      />,
    );
  try {
    await act(async () => mount("old"));
    await act(async () =>
      [...c.querySelectorAll("button")]
        .find((b) => b.textContent === "Preview server audience")!
        .click(),
    );
    await act(async () => mount("new"));
    await act(async () =>
      release({ audienceUserIds: ["u"], notice: "Stale audience preview" }),
    );
    expect(c.textContent).not.toContain("Stale audience preview");
  } finally {
    await act(async () => root.unmount());
  }
});
