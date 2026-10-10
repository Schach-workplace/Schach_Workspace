// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import LinkedWork from "./LinkedWork";
const env = vi.hoisted(() => ({
  request: vi.fn(),
  push: vi.fn(),
  source: vi.fn(),
}));
vi.mock("./client", () => ({ client: { request: env.request } }));
vi.mock("expo-router", () => ({ router: { push: env.push } }));
vi.mock("./Workspace", () => ({
  useWorkspace: () => ({ company: "c", foreground: true, recordEpoch: 1 }),
}));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({ title, onPress }: any) =>
    createElement("button", { onClick: onPress }, title),
}));
vi.mock("react-native", () => ({
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
}));
afterEach(() => {
  env.request.mockReset();
  env.push.mockReset();
  env.source.mockReset();
  vi.useRealTimers();
});
it("withholds cards while current source reauthorization is pending or empty and routes precise authorized task/source", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  let title = "Current task";
  let sources: any[] = [
    { messageId: "s", revision: 1, currentRevision: 2, outOfDate: true },
  ];
  let release: (v: any) => void = () => {};
  let delay = false;
  env.request.mockImplementation(async (path) =>
    path.endsWith("/sources")
      ? delay
        ? new Promise((r) => (release = r))
        : { sources }
      : {
          tasks: [
            {
              id: "t",
              title,
              status: "in_review",
              dueDate: "2026-10-12",
            },
          ],
        },
  );
  const container = document.createElement("div");
  const root = createRoot(container);
  const click = async (title: string) =>
    act(async () =>
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === title)!
        .click(),
    );
  try {
    await act(async () =>
      root.render(<LinkedWork conversation="a" onSource={env.source} />),
    );
    expect(container.textContent).toContain("Source changed");
    await click("Open task: Current task");
    expect(env.push).toHaveBeenCalledWith({
      pathname: "/task/[id]",
      params: { id: "t", company: "c", conversationId: "a" },
    });
    await click("Open current source");
    expect(env.source).toHaveBeenCalledWith("s");
    title = "Updated linked task";
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(container.textContent).toContain("Updated linked task");
    expect(container.textContent).not.toContain("Current task");
    delay = true;
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(container.textContent).not.toContain("Updated linked task");
    sources = [];
    await act(async () => release({ sources }));
    expect(container.textContent).not.toContain("Updated linked task");
  } finally {
    await act(async () => root.unmount());
  }
});

it.each(["task", "source"])(
  "does not disclose a linked record after independent %s access is denied",
  async (lane) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    env.request.mockImplementation(async (path) => {
      if (
        (lane === "task" && path.endsWith("/work-links")) ||
        (lane === "source" && path.endsWith("/sources"))
      )
        throw Error("Current access denied");
      return path.endsWith("/sources")
        ? { sources: [{ messageId: "secret-source" }] }
        : { tasks: [{ id: "t", title: "Private linked task" }] };
    });
    const c = document.createElement("div");
    const root = createRoot(c);
    try {
      await act(async () =>
        root.render(<LinkedWork conversation="a" onSource={env.source} />),
      );
      expect(c.textContent).not.toContain("Private linked task");
      expect(c.textContent).not.toContain("secret-source");
      expect(c.textContent).toContain("Current access denied");
    } finally {
      await act(async () => root.unmount());
    }
  },
);
