// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import Intake from "./Intake";
import { clearAllDrafts } from "./conversationDrafts";
const env = vi.hoisted(() => ({
  zone: "Asia/Kolkata",
  request: vi.fn(),
  setError: vi.fn(),
  change: (_v: any) => {},
}));
vi.mock("./client", () => ({
  client: { endpoint: "https://test", generation: 1, request: env.request },
}));
vi.mock("./Workspace", () => ({
  styles: {},
  useWorkspace: () => ({
    company: "c",
    session: { user: { id: "u" } },
    refresh: async () => {},
    setError: env.setError,
    work: {
      me: { role: "admin" },
      people: [],
      departments: [],
      company: { timezone: env.zone },
    },
  }),
}));
vi.mock("./PersonPicker", () => ({ default: () => null }));
vi.mock("./DeadlinePicker", () => ({
  default: (p: any) => {
    env.change = p.onChange;
    return createElement("span", {}, p.date + " " + p.time);
  },
}));
vi.mock("react-native", () => ({
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children, accessibilityRole }: any) =>
    createElement("span", { role: accessibilityRole }, children),
  Button: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  TextInput: () => null,
}));
afterEach(() => {
  clearAllDrafts();
  env.request.mockReset();
  env.setError.mockReset();
});
it.each([
  {
    zone: "Asia/Kolkata",
    date: "2026-10-12",
    time: "16:00",
    expected: "2026-10-12T10:30:00.000Z",
  },
  {
    zone: "America/New_York",
    date: "2026-11-01",
    time: "01:30",
    expected: "2026-11-01T06:30:00.000Z",
  },
])(
  "submits company timed intake and explicit fold choice in $zone",
  async ({ zone, date, time, expected }) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    env.zone = zone;
    let submitted: any = null;
    env.request.mockImplementation(async (path, _method, body) => {
      if (path.endsWith("/assign")) {
        submitted = body;
        return { task: { id: "t" } };
      }
      return {
        requests: [
          {
            id: "r",
            title: "Request",
            summary: "Brief",
            state: "open",
            version: 2,
            departmentId: "d",
          },
        ],
      };
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    const click = async (label: string) =>
      act(async () => {
        const button = [...container.querySelectorAll("button")].find(
          (b) => b.textContent === label,
        )!;
        expect(button.disabled).toBe(false);
        button.click();
      });
    try {
      await act(async () => root.render(<Intake />));
      await click("Review intake action");
      await act(async () => env.change({ date, time }));
      if (zone === "America/New_York") await click(expected);
      await click("Assign through task workflow");
      expect(submitted.task).toMatchObject({
        dueDate: date,
        deadlineMode: "timed",
        dueAt: expected,
        dueTimezone: zone,
      });
    } finally {
      await act(async () => root.unmount());
    }
  },
);
it("refuses an intake commitment in a company DST gap", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  env.zone = "America/New_York";
  env.request.mockResolvedValue({
    requests: [
      {
        id: "r",
        title: "Request",
        summary: "Brief",
        state: "open",
        version: 2,
      },
    ],
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Intake />));
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === "Review intake action")!
        .click(),
    );
    await act(async () => env.change({ date: "2026-03-08", time: "02:30" }));
    const assign = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Assign through task workflow",
    )!;
    expect(assign.disabled).toBe(true);
    expect(container.textContent).toContain("does not exist");
  } finally {
    await act(async () => root.unmount());
  }
});
it("loads an exact published intake outside the first list page", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  env.request.mockResolvedValue({
    request: {
      id: "outside-first-100",
      title: "Exact published request",
      summary: "Published only",
      state: "open",
      version: 7,
      departmentId: "",
    },
  });
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(<Intake initialId="outside-first-100" />),
    );
    expect(env.request).toHaveBeenCalledWith(
      "/companies/c/communication/requests/outside-first-100",
    );
    expect(host.textContent).toContain("Exact published request");
    expect(host.textContent).toContain("version 7");
  } finally {
    await act(async () => root.unmount());
  }
});
