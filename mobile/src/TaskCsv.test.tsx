// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearAllBusinessAttempts } from "../../shared/business/attempts";
import TaskCsv from "./TaskCsv";

const env = vi.hoisted(() => {
  class NativeApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
      public rows: { row: number; message: string }[] = [],
    ) {
      super(message);
    }
  }
  return {
    NativeApiError,
    w: {} as any,
    client: { request: vi.fn(), generation: 1, endpoint: "https://s.example" },
    projects: {} as any,
    projectPaths: [] as string[],
    files: {} as Record<string, string>,
    deleted: [] as string[],
    pick: vi.fn(),
    share: vi.fn(),
    shareAvailable: vi.fn(async () => true),
  };
});
vi.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));
vi.mock("./client", () => ({
  client: env.client,
  NativeApiError: env.NativeApiError,
}));
vi.mock("./Workspace", () => ({ useWorkspace: () => env.w }));
vi.mock("./execution", () => ({
  useExecutionRead: (path: string, enabled: boolean) => {
    if (enabled) env.projectPaths.push(path);
    return env.projects;
  },
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: env.pick }));
vi.mock("expo-sharing", () => ({
  shareAsync: env.share,
  isAvailableAsync: env.shareAvailable,
}));
vi.mock("expo-file-system", () => {
  const join = (parts: any[]) =>
    parts.map((p) => (typeof p === "string" ? p : p.uri)).join("/");
  class Directory {
    uri: string;
    constructor(...parts: any[]) {
      this.uri = join(parts);
    }
    get exists() {
      return Object.keys(env.files).some((k) => k.startsWith(this.uri + "/"));
    }
    create() {}
    delete() {
      env.deleted.push(this.uri);
      for (const k of Object.keys(env.files))
        if (k.startsWith(this.uri + "/")) delete env.files[k];
    }
  }
  class File {
    uri: string;
    constructor(...parts: any[]) {
      this.uri = join(parts);
    }
    get exists() {
      return this.uri in env.files;
    }
    create() {
      env.files[this.uri] = "";
    }
    write(text: string) {
      env.files[this.uri] = text;
    }
    async text() {
      return env.files[this.uri];
    }
    delete() {
      env.deleted.push(this.uri);
      delete env.files[this.uri];
    }
  }
  return { File, Directory, Paths: { cache: { uri: "cache:" } } };
});
vi.mock("./ConnectUI", () => ({
  ui: new Proxy({}, { get: () => ({}) }),
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  Sheet: ({ title, children, onClose }: any) =>
    createElement(
      "section",
      { "aria-label": title },
      createElement("button", { onClick: onClose }, "Close"),
      children,
    ),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) =>
    createElement("div", {}, children),
  Text: ({ children, accessibilityRole }: any) =>
    createElement("span", { role: accessibilityRole }, children),
}));

const header = "Title,Owner email,Department,Due date";
let root: Root, host: HTMLDivElement;
const button = (title: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === title);
const click = (title: string) =>
  act(async () => {
    const b = button(title);
    expect(b, title).toBeTruthy();
    b!.click();
  });
const alerts = () =>
  [...host.querySelectorAll('[role="alert"]')].map((e) => e.textContent);
function pickCsv(text: string, size = text.length) {
  env.files["cache:/picked.csv"] = text;
  env.pick.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: "cache:/picked.csv", name: "tasks.csv", size }],
  });
}
async function render(role = "member") {
  env.w.work.me.role = role;
  await act(async () =>
    root.render(<TaskCsv tasks={env.w.work.tasks} onClose={() => {}} />),
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  clearAllBusinessAttempts();
  env.client.generation = 1;
  env.client.request.mockReset();
  env.pick.mockReset();
  env.share.mockReset();
  env.share.mockResolvedValue(undefined);
  env.shareAvailable.mockResolvedValue(true);
  env.files = {};
  env.deleted = [];
  env.projectPaths = [];
  env.projects = {
    ready: true,
    data: { projects: [{ id: "p1", name: "Launch", departmentId: "d1" }] },
    retry: vi.fn(),
  };
  const me = {
    id: "me",
    name: "Me",
    email: "me@x.co",
    role: "member",
    active: true,
    departmentId: "d1",
  };
  env.w = {
    company: "c",
    session: { user: { id: "me" } },
    setError: vi.fn(),
    refresh: vi.fn(async () => {}),
    work: {
      me,
      company: { id: "c", timezone: "UTC" },
      people: [
        me,
        { id: "head", name: "Head", email: "head@x.co", role: "head", active: true, departmentId: "d1" },
      ],
      departments: [{ id: "d1", name: "Design", headId: "head" }],
      tasks: [
        {
          id: "t1",
          code: "T-1",
          title: "Prepare handover",
          status: "todo",
          ownerId: "me",
          reviewerId: "head",
          departmentId: "d1",
          projectId: "p1",
          dueDate: "2026-10-20",
          deadlineMode: "all_day",
          dueAt: "",
          dueTimezone: "",
          originalDueAt: "",
          originalDueDate: "2026-10-20",
          description: "",
          version: 1,
          requiresApproval: true,
          attachments: [],
        },
      ],
    },
  };
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});

it("lets every role export the shown tasks but only non-viewers import", async () => {
  await render("viewer");
  expect(button("Export 1 shown tasks")).toBeTruthy();
  expect(button("Choose CSV")).toBeUndefined();
  expect(button("Share CSV template")).toBeUndefined();
  expect(host.textContent).toContain("Viewers can export");
  await render("member");
  expect(button("Choose CSV")).toBeTruthy();
  expect(button("Share CSV template")).toBeTruthy();
});

it("exports through a private cache file, shares it as CSV and deletes it", async () => {
  await render("viewer");
  await click("Export 1 shown tasks");
  expect(env.share).toHaveBeenCalledOnce();
  const [uri, options] = env.share.mock.calls[0];
  expect(uri).toMatch(/^cache:\/task-csv-uuid\/workspace-tasks-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(options).toMatchObject({ mimeType: "text/csv", UTI: "public.comma-separated-values-text" });
  expect(env.deleted).toContain("cache:/task-csv-uuid");
  expect(Object.keys(env.files)).toEqual([]);
  expect(env.client.request).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Exported 1 tasks.");
});

it("deletes the export file even when sharing fails, and surfaces the failure", async () => {
  env.share.mockRejectedValueOnce(Error("Share sheet failed"));
  await render();
  await click("Export 1 shown tasks");
  expect(env.deleted).toContain("cache:/task-csv-uuid");
  expect(Object.keys(env.files)).toEqual([]);
  expect(alerts()).toContain("Share sheet failed");
});

it("waits for authorized projects before CSV actions are offered", async () => {
  env.projects = { loading: true, ready: false, retry: vi.fn() };
  await render();
  expect(env.projectPaths).toContain("/projects");
  expect(button("Export 1 shown tasks")!.disabled).toBe(true);
  expect(button("Choose CSV")!.disabled).toBe(true);
  env.projects = { ready: false, error: "Company access is unavailable.", denied: true, retry: vi.fn() };
  await render();
  expect(alerts().join(" ")).toContain("Company access is unavailable.");
});

it("previews a picked CSV and imports only after explicit confirmation", async () => {
  await render();
  pickCsv(`${header}\nFirst,,,2026-10-20\nSecond,head@x.co,Design,2026-10-21\n`);
  await click("Choose CSV");
  expect(env.pick).toHaveBeenCalledWith(
    expect.objectContaining({ copyToCacheDirectory: true, multiple: false }),
  );
  // The picked cache copy is removed once read.
  expect(env.deleted).toContain("cache:/picked.csv");
  expect(host.textContent).toContain("2 tasks ready to import");
  expect(host.textContent).toContain("First");
  expect(host.textContent).toContain("Second");
  expect(env.client.request).not.toHaveBeenCalled();
  env.client.request.mockResolvedValueOnce({ ok: true, created: 2, ids: ["a", "b"] });
  await click("Import 2 tasks");
  expect(env.client.request).toHaveBeenCalledOnce();
  const [path, method, body] = env.client.request.mock.calls[0];
  expect(path).toBe("/companies/c/tasks/import");
  expect(method).toBe("POST");
  expect(Object.keys(body).sort()).toEqual(["retryKey", "rows"]);
  expect(body.retryKey).toBe("uuid");
  expect(body.rows.map((r: any) => [r.title, r.ownerId, r.reviewerId, r.departmentId])).toEqual([
    ["First", "me", "head", "d1"],
    ["Second", "head", "", "d1"],
  ]);
  expect(env.w.refresh).toHaveBeenCalledWith("tasks");
  expect(host.textContent).toContain("Imported 2 tasks.");
  expect(button("Import 2 tasks")).toBeUndefined();
});

it("shows local validation errors with the CSV row and offers no import", async () => {
  await render();
  pickCsv(`${header}\nFirst,nobody@x.co,,2026-10-20\n`);
  await click("Choose CSV");
  expect(alerts()).toContain(
    'Row 2: Owner email "nobody@x.co" is not an active person in this company.',
  );
  expect(button("Import tasks")!.disabled).toBe(true);
  pickCsv(`${header}\nFirst,,,2026-10-20\n`, 2_000_001);
  await click("Choose CSV");
  expect(alerts()).toContain("Choose a CSV smaller than 2 MB.");
});

it("ignores a cancelled pick", async () => {
  await render();
  env.pick.mockResolvedValueOnce({ canceled: true, assets: null });
  await click("Choose CSV");
  expect(host.textContent).not.toContain("ready to import");
  expect(alerts()).toEqual([]);
});

it("shows server row errors and retries the frozen body and key", async () => {
  await render();
  pickCsv(`${header}\nFirst,,,2026-10-20\nSecond,,,2026-10-21\n`);
  await click("Choose CSV");
  env.client.request.mockRejectedValueOnce(
    new env.NativeApiError(422, "invalid_import", "No rows were imported. Fix the listed row errors and retry.", [
      { row: 2, message: "Reviewer is outside your scope." },
    ]),
  );
  await click("Import 2 tasks");
  expect(alerts()).toContain("No rows were imported. Fix the listed row errors and retry.");
  expect(alerts()).toContain("Row 3: Reviewer is outside your scope.");
  expect(host.textContent).toContain("The previous import may already exist.");
  // Another CSV cannot replace the frozen attempt.
  expect(button("Choose CSV")!.disabled).toBe(true);
  const first = env.client.request.mock.calls[0][2];
  env.client.request.mockResolvedValueOnce({ ok: true, created: 2, ids: ["a", "b"] });
  await click("Retry same import");
  const second = env.client.request.mock.calls[1][2];
  expect(second).toEqual(first);
  expect(host.textContent).toContain("Imported 2 tasks.");
});

it("abandoning a frozen import clears it and allows a new CSV", async () => {
  await render();
  pickCsv(`${header}\nFirst,,,2026-10-20\n`);
  await click("Choose CSV");
  env.client.request.mockRejectedValueOnce(Error("Network request failed"));
  await click("Import 1 tasks");
  expect(alerts()).toContain("Network request failed");
  await click("Abandon retry; prior work may exist");
  expect(button("Choose CSV")!.disabled).toBe(false);
  expect(host.textContent).not.toContain("ready to import");
});

it("surfaces a 403 from the current role and drops the frozen attempt", async () => {
  await render();
  pickCsv(`${header}\nFirst,,,2026-10-20\n`);
  await click("Choose CSV");
  env.client.request.mockRejectedValueOnce(
    new env.NativeApiError(403, "forbidden", "You do not have permission to perform this action."),
  );
  await click("Import 1 tasks");
  expect(alerts()).toContain("You do not have permission to perform this action.");
  expect(host.textContent).not.toContain("The previous import may already exist.");
});

it("drops an import result that lands after the company or session changed", async () => {
  await render();
  pickCsv(`${header}\nFirst,,,2026-10-20\n`);
  await click("Choose CSV");
  env.client.request.mockImplementationOnce(async () => {
    env.client.generation++;
    return { ok: true, created: 1, ids: ["a"] };
  });
  await click("Import 1 tasks");
  expect(host.textContent).not.toContain("Imported");
  expect(env.w.refresh).not.toHaveBeenCalled();
});
