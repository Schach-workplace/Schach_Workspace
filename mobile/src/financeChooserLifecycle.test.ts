import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { chooseFinanceFile, clearCaptures, setCaptureContext } from "./capture";
const h = vi.hoisted(() => ({
  endpoint: "https://owned.test",
  generation: 1,
  request: vi.fn(),
  pick: vi.fn(),
  deleted: 0,
}));
vi.mock("./client", () => ({ client: h }));
vi.mock("expo-image-picker", () => ({}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "owned" }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "owned-cache" },
  File: class {
    uri: string;
    size = 212;
    exists = true;
    constructor(...v: string[]) {
      this.uri = v.join("/");
    }
    copy() {}
    delete() {
      this.exists = false;
      h.deleted++;
    }
  },
}));
const scope = {
  serverOrigin: "https://owned.test",
  companyId: "c",
  userId: "u",
  policyEpoch: 1,
  ready: true,
};
const result = {
  canceled: false,
  assets: [
    { uri: "documents.csv", name: "fictional.csv", mimeType: "text/csv" },
  ],
};
afterEach(() => {
  clearCaptures();
  vi.clearAllMocks();
  h.deleted = 0;
  h.endpoint = scope.serverOrigin;
  h.generation = 1;
});
it("waits for fresh foreground authorization after DocumentsUI clears request generation", async () => {
  setCaptureContext(scope);
  h.request.mockResolvedValue({ items: [] });
  h.pick.mockImplementation(async () => {
    h.generation++;
    setCaptureContext({ ...scope, ready: false });
    return result;
  });
  const pending = chooseFinanceFile(scope.serverOrigin, "c", "u", "statement");
  let completed = false;
  pending.then(
    () => {
      completed = true;
    },
    () => {
      completed = true;
    },
  );
  await new Promise<void>((r) => setTimeout(r, 0));
  expect(completed).toBe(false);
  expect(h.request).not.toHaveBeenCalled();
  setCaptureContext(scope);
  const file = await pending;
  expect(file?.name).toBe("fictional.csv");
  const routes = readFileSync(
    new URL("../../backend/platform/finance_statements.go", import.meta.url),
    "utf8",
  );
  const base = routes.match(
    /func \(s \*Server\) financeStatementRoutes\(\) \{\s*base := "([^"]+)"/,
  )![1];
  const suffix = routes.match(
    /s.route\("GET "\+base\+"([^"]+)", s.listFinanceStatementImports\)/,
  )![1];
  expect(h.request).toHaveBeenCalledWith(
    base.replace("/api", "").replace("{cid}", "c") + suffix,
  );
  file?.delete();
});
it.each(["company", "user", "origin", "policy", "logout", "denied"])(
  "deletes chooser bytes after genuine %s change",
  async (kind) => {
    setCaptureContext(scope);
    h.request.mockImplementation(async () => {
      if (kind === "denied") throw Error("Finance access denied");
      return { items: [] };
    });
    h.pick.mockImplementation(async () => {
      h.generation++;
      setCaptureContext({ ...scope, ready: false });
      const next = { ...scope };
      if (kind === "company") next.companyId = "other";
      if (kind === "user") next.userId = "other";
      if (kind === "origin") {
        next.serverOrigin = "https://other.test";
        h.endpoint = next.serverOrigin;
      }
      if (kind === "policy") next.policyEpoch++;
      if (kind === "logout") {
        clearCaptures();
        next.userId = "";
      }
      setCaptureContext(next);
      return result;
    });
    await expect(
      chooseFinanceFile(scope.serverOrigin, "c", "u", "statement"),
    ).rejects.toThrow();
    expect(h.deleted).toBe(1);
    if (kind !== "denied") expect(h.request).not.toHaveBeenCalled();
  },
);
