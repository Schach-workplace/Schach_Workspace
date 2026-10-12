// @vitest-environment happy-dom
import { act, Children, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import OverviewScreen from "./OverviewScreen";
import WorkloadScreen from "./WorkloadScreen";
const env = vi.hoisted(() => ({
  work: null as any,
  refresh: vi.fn(),
  push: vi.fn(),
  read: {} as any,
  paths: [] as string[],
}));
function container({ children, accessibilityRole }: any) {
  for (const child of Children.toArray(children))
    if ((typeof child === "string" && child !== "") || typeof child === "number")
      throw Error("Raw native container text: " + JSON.stringify(child));
  return createElement("div", { role: accessibilityRole }, children);
}
vi.mock("./Workspace", () => ({
  Page: container,
  useWorkspace: () => ({
    company: "c",
    work: env.work,
    refresh: env.refresh,
  }),
}));
vi.mock("expo-router", () => ({ router: { push: env.push } }));
vi.mock("./execution", () => ({
  useExecutionRead: (path: string) => {
    env.paths.push(path);
    return env.read;
  },
}));
vi.mock("./ConnectUI", () => ({
  ui: new Proxy({}, { get: () => ({}) }),
  Action: ({ title, onPress }: any) =>
    createElement("button", { onClick: onPress }, title),
}));
vi.mock("react-native", () => ({
  View: container,
  Pressable: ({ children, onPress, accessibilityLabel }: any) =>
    createElement("button", { onClick: onPress, "aria-label": accessibilityLabel }, children),
  Text: ({ children, accessibilityRole }: any) =>
    createElement("span", { role: accessibilityRole }, children),
  ScrollView: ({ children, refreshControl }: any) =>
    createElement(
      "div",
      {},
      createElement(
        "button",
        {
          "data-refreshing": String(refreshControl.props.refreshing),
          onClick: refreshControl.props.onRefresh,
        },
        "pull to refresh",
      ),
      children,
    ),
  RefreshControl: () => null,
}));
afterEach(() => {
  env.work = null;
  env.read = {};
  env.paths = [];
  env.refresh.mockReset();
  env.push.mockReset();
});
async function render(node: any) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(node));
  const click = (label: string) =>
    act(async () =>
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === label || b.getAttribute("aria-label") === label)!
        .click(),
    );
  return { host, root, click };
}
const work = (role: string, tasks: any[] = []) => ({
  me: { role },
  company: { timezone: "UTC" },
  departments: [],
  people: [{ id: "u", name: "Una" }],
  projects: [],
  activities: [],
  tasks,
});
it("Overview shows loading, then read-only cards and empty states", async () => {
  const r = await render(<OverviewScreen />);
  expect(r.host.textContent).toContain("Loading the current company overview");
  env.work = work("admin");
  await act(async () => r.root.render(<OverviewScreen key="2" />));
  expect(r.host.textContent).toContain("Open commitments");
  expect(r.host.textContent).toContain("Nothing needs attention right now.");
  expect(r.host.textContent).toContain("No active projects.");
  expect(r.host.textContent).toContain("No recent activity is visible.");
  await act(async () => r.root.unmount());
});
it("Overview links attention to task detail and refreshes through the workspace reauthorization", async () => {
  env.work = work("ceo", [
    { id: "t1", title: "Late drawing", status: "blocked", ownerId: "u", deadlineMode: "all_day", dueDate: "", dueAt: "" },
  ]);
  env.refresh.mockRejectedValueOnce(Error("Network unavailable"));
  const r = await render(<OverviewScreen />);
  await r.click("Open task Late drawing");
  expect(env.push).toHaveBeenCalledWith({
    pathname: "/task/[id]",
    params: { id: "t1", company: "c" },
  });
  await r.click("pull to refresh");
  expect(env.refresh).toHaveBeenCalledWith("all");
  expect(r.host.querySelector('[role="alert"]')!.textContent).toBe(
    "Network unavailable",
  );
  await act(async () => r.root.unmount());
});
it("Overview mirrors the browser and withholds the company overview from members", async () => {
  env.work = work("member", [
    { id: "t1", title: "Hidden", status: "blocked", ownerId: "u", deadlineMode: "all_day", dueDate: "", dueAt: "" },
  ]);
  const r = await render(<OverviewScreen />);
  expect(r.host.textContent).toContain("available to leadership roles");
  expect(r.host.textContent).not.toContain("Hidden");
  await act(async () => r.root.unmount());
});
it("Workload reads only the planning summary and surfaces a 403 denial", async () => {
  env.work = work("member");
  env.read = { denied: true, error: "Forbidden", ready: false, loading: false, retry: vi.fn() };
  const r = await render(<WorkloadScreen />);
  expect(env.paths.every((p) => p.startsWith("/planning/summary?from="))).toBe(true);
  expect(r.host.querySelector('[role="alert"]')!.textContent).toContain(
    "Access denied",
  );
  expect(r.host.querySelector('[role="alert"]')!.textContent).toContain("Forbidden");
  await act(async () => r.root.unmount());
});
it("Workload shows loading, error with retry, empty, and data with pull-to-refresh", async () => {
  env.work = work("head");
  const retry = vi.fn();
  env.read = { loading: true, ready: false, retry };
  const r = await render(<WorkloadScreen />);
  expect(r.host.textContent).toContain("Loading currently authorized workload");
  env.read = { error: "Server unavailable", ready: false, retry };
  await act(async () => r.root.render(<WorkloadScreen />));
  await r.click("Retry workload");
  expect(retry).toHaveBeenCalledOnce();
  const empty = {
    method: "visible_remaining_overlap_v1",
    methodDescription: "Remaining hours",
    timezone: "UTC",
    generatedAt: "now",
    readBasis: "",
    projectionBasis: "b",
    filters: { from: "", to: "" },
    weeks: [],
    coverage: { uniqueSelectedRemainingHours: 0, weeklyExposureHours: 0, undated: 0, invalidInterval: 0, recordedZeroEstimate: 0, missingOwner: 0, invalidNumeric: 0, visibleTasks: 0 },
  };
  env.read = { ready: true, data: empty, retry };
  await act(async () => r.root.render(<WorkloadScreen />));
  expect(r.host.textContent).toContain("No visible work or recorded capacity");
  env.read = {
    ready: true,
    retry,
    data: {
      ...empty,
      coverage: { ...empty.coverage, visibleTasks: 2, uniqueSelectedRemainingHours: 12 },
      weeks: [
        {
          from: "2026-10-12", to: "2026-10-18", selectedFrom: "2026-10-12", selectedTo: "2026-10-18",
          partial: false, remainingHours: 12, positiveCapacityHours: 40, positiveCapacityEffort: 12,
          utilization: 30, excludedCapacityRows: 0, drill: { category: "scheduled" },
          people: [
            { id: "u", name: "Una", recordedCapacity: 40, capacityState: "recorded_positive", remainingHours: 12, utilization: 30, drill: { category: "scheduled" } },
          ],
        },
      ],
    },
  };
  await act(async () => r.root.render(<WorkloadScreen />));
  expect(r.host.textContent).toContain("Una");
  expect(r.host.textContent).toContain("12h remaining · 40h capacity · 30% utilization");
  await r.click("pull to refresh");
  expect(retry).toHaveBeenCalledTimes(2);
  const before = env.paths.at(-1)!;
  await r.click("Next");
  expect(env.paths.at(-1)).not.toBe(before);
  await act(async () => r.root.unmount());
});
