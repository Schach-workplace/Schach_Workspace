// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ConversationTools } from "./ConnectPresentation";
vi.mock("react-native", () => ({
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  Pressable: ({ children, onPress, accessibilityState }: any) =>
    createElement(
      "button",
      { onClick: onPress, "aria-expanded": accessibilityState?.expanded },
      children,
    ),
}));
vi.mock("./ConnectUI", () => ({
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
}));
it("discloses secondary tools, preserves their handlers and disabled calls", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  const search = vi.fn(),
    records = vi.fn(),
    mentions = vi.fn(),
    call = vi.fn();
  await act(async () =>
    root.render(
      <ConversationTools
        disabled
        onSearch={search}
        onRecords={records}
        onMentions={mentions}
        onCall={call}
      />,
    ),
  );
  expect(host.textContent).not.toContain("Search & pins");
  const toggle = host.querySelector("button")!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  for (const [label, callback] of [
    ["Search & pins", search],
    ["Records", records],
    ["Mentions in loaded history", mentions],
  ] as const) {
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === label)!
        .click(),
    );
    expect(callback).toHaveBeenCalledTimes(1);
  }
  const calls = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Audio / video",
  )!;
  expect(calls.disabled).toBe(true);
  await act(async () => calls.click());
  expect(call).not.toHaveBeenCalled();
  await act(async () => toggle.click());
  expect(host.textContent).not.toContain("Search & pins");
  await act(async () => root.unmount());
});
it("keeps enabled calling explicit and resets tool expansion on a conversation-scope remount", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const node = document.createElement("div"),
    root = createRoot(node),
    call = vi.fn();
  const props = {
    disabled: false,
    onSearch: vi.fn(),
    onRecords: vi.fn(),
    onMentions: vi.fn(),
    onCall: call,
  };
  try {
    await act(async () =>
      root.render(<ConversationTools key="company:a:chat:one" {...props} />),
    );
    await act(async () => node.querySelector("button")!.click());
    await act(async () =>
      [...node.querySelectorAll("button")]
        .find((b) => b.textContent === "Audio / video")!
        .click(),
    );
    expect(call).toHaveBeenCalledTimes(1);
    await act(async () =>
      root.render(<ConversationTools key="company:b:chat:two" {...props} />),
    );
    expect(node.textContent).not.toContain("Audio / video");
    expect(node.querySelector("button")!.getAttribute("aria-expanded")).toBe(
      "false",
    );
  } finally {
    await act(async () => root.unmount());
  }
});
