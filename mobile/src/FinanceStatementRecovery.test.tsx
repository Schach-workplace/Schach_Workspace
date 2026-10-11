// @vitest-environment happy-dom
import FinanceStatementReview from "./FinanceStatementReview";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
const h = vi.hoisted(() => ({
  posts: [] as any[],
  preview: 0,
  w: {
    company: "native-recovery",
    foreground: true,
    session: { user: { id: "actor" } },
    work: { company: { currency: "INR" } },
    refresh: vi.fn(),
  },
}));
vi.mock("./Workspace", () => ({ useWorkspace: () => h.w, styles: {} }));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("./client", () => ({
  NativeApiError: class extends Error {},
  client: {
    generation: 1,
    endpoint: "https://owned-recovery.test",
    request: async (path: string, method: string, payload: any) => {
      if (path.endsWith("/finance/statement-previews"))
        return { preview: { id: "native-preview-" + ++h.preview } };
      h.posts.push({ path, method, payload });
      if (h.posts.length === 1)
        throw new TypeError("Committed import ACK lost");
      return { id: "canonical-native-import" };
    },
  },
}));
vi.mock("./execution", async (original) => ({
  ...(await original<any>()),
  useExecutionRead: (path: string, enabled = true) =>
    !enabled
      ? { ready: false }
      : path.startsWith("/finance/intakes/")
        ? { ready: true, data: { state: "clean", version: 4 } }
        : {
            ready: true,
            data: {
              preview: {
                revision: 1,
                errors: [],
                totals: { debit: "130050", credit: "0", net: "-130050" },
              },
              rows: [],
              rowCount: 1,
            },
          },
}));
vi.mock("./ConnectUI", () => ({
  Sheet: ({ children }: any) => createElement("div", {}, children),
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { disabled, onClick: onPress }, title),
}));
vi.mock("react-native", () => ({
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  TextInput: ({ accessibilityLabel, value, editable, onChangeText }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      disabled: editable === false,
      onChange: (e: any) => onChangeText(e.target.value),
    }),
  FlatList: ({ ListHeaderComponent, ListFooterComponent }: any) =>
    createElement("div", {}, ListHeaderComponent, ListFooterComponent),
}));
it("retains the original unknown native import and freezes every re-preview/remap control through remount", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const node = document.createElement("div");
  let root = createRoot(node);
  const onImported = vi.fn();
  const render = () =>
    root.render(
      createElement(FinanceStatementReview, {
        intakeId: "native-source",
        onClose: () => {},
        onImported,
      }),
    );
  const button = (title: string) =>
    [...node.querySelectorAll("button")].find((b) => b.textContent === title)!;
  await act(async () => render());
  for (const title of [
    "Header row: yes",
    "Delimiter: comma",
    "Date format: YYYY-MM-DD",
    "Amount format: signed",
    "Decimal separator: dot",
    "Grouping separator: none",
  ])
    await act(async () => button(title).click());
  // Drive the actual input callbacks with React's DOM value tracker.
  for (const [label, value] of [
    ["Date column", "1"],
    ["Amount column", "2"],
  ])
    await act(async () => {
      const input = node.querySelector(
        'input[aria-label="' + label + ' (file column 1–32)"]',
      )!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await act(async () => button("Preview exact statement rows").click());
  await act(async () =>
    button("I reviewed the full mapping and all normalized rows").click(),
  );
  await act(async () => button("Import reviewed statement").click());
  expect(h.posts).toHaveLength(1);
  expect(button("Preview exact statement rows").disabled).toBe(true);
  expect(button("Date format: DD/MM/YYYY").disabled).toBe(true);
  await act(async () => button("Preview exact statement rows").click());
  expect(h.preview).toBe(1);
  await act(async () => root.unmount());
  root = createRoot(node);
  await act(async () => render());
  await act(async () => button("Retry same statement import").click());
  expect(onImported).toHaveBeenCalledWith("canonical-native-import");
  expect(h.posts).toHaveLength(2);
  expect(h.posts[1]).toEqual(h.posts[0]);
  await act(async () => root.unmount());
});
