// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import FinanceScreen from "./FinanceScreen";
const h = vi.hoisted(() => ({
  foreground: true,
  company: "owned-company",
  work: {
    me: { role: "member" },
    expenses: [
      {
        id: "e",
        title: "Human draft",
        status: "draft",
        amountMinor: 130050,
        currency: "INR",
      },
    ],
  },
  push: vi.fn(),
}));
vi.mock("./Workspace", () => ({
  useWorkspace: () => h,
  styles: {},
  Page: ({ children }: any) => createElement("div", {}, children),
}));
vi.mock("./ConnectUI", () => ({
  Action: ({ title, onPress }: any) =>
    createElement("button", { onClick: onPress }, title),
}));
vi.mock("./FinanceDraftForm", () => ({
  default: () => createElement("div", {}, "Human draft form"),
}));
vi.mock("expo-router", () => ({ router: { push: h.push } }));
vi.mock("react-native", () => ({
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  FlatList: ({ data, renderItem }: any) =>
    createElement(
      "div",
      {},
      data.map((item: any) =>
        createElement("div", { key: item.id }, renderItem({ item })),
      ),
    ),
}));
it("keeps real manual finance/exact money and company route, withholds fetched expenses in background", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const node = document.createElement("div");
  const root = createRoot(node);
  await act(async () => root.render(createElement(FinanceScreen)));
  expect(node.textContent).toContain("₹1,300.50");
  await act(async () =>
    [...node.querySelectorAll("button")]
      .find(
        (b) =>
          b.textContent === "Receipt extraction, duplicates and statements",
      )!
      .click(),
  );
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/finance/assistance",
    params: { company: "owned-company" },
  });
  await act(async () =>
    [...node.querySelectorAll("button")]
      .find((b) => b.textContent === "Create expense draft")!
      .click(),
  );
  expect(node.textContent).toContain("Human draft form");
  h.foreground = false;
  await act(async () => root.render(createElement(FinanceScreen)));
  expect(node.textContent).not.toContain("Human draft");
  expect(node.textContent).toContain("Checking current finance access");
  await act(async () => root.unmount());
  h.foreground = true;
});
