import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativeClient } from "./client";
const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => storage.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => {
    storage.set(k, v);
  }),
  deleteItemAsync: vi.fn(async (k: string) => {
    storage.delete(k);
  }),
}));
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("__DEV__", false);
});
afterEach(() => vi.unstubAllGlobals());
describe("native authorization boundary", () => {
  it("keeps bearer credentials out of URLs and requires HTTPS in release", async () => {
    const c = new NativeClient();
    await expect(
      c.login("http://workspace.example.in", "a", "b"),
    ).rejects.toThrow("secure");
    await expect(
      c.login("https://user:secret@workspace.example.in", "a", "b"),
    ).rejects.toThrow("without credentials");
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetch);
    c.endpoint = "https://workspace.example.in";
    c.token = "secret-bearer";
    await c.request("/companies/one/conversations");
    expect(fetch.mock.calls[0][0]).not.toContain("secret");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer secret-bearer",
    );
  });
  it("rejects a response whose body finished after a company switch", async () => {
    let resolve: (v: unknown) => void = () => {};
    const c = new NativeClient();
    c.endpoint = "https://workspace.example.in";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          new Promise((r) => {
            resolve = r;
          }),
      }),
    );
    const pending = c.request("/companies/old/conversations");
    await Promise.resolve();
    c.clearGeneration();
    resolve({ private: "old company" });
    await expect(pending).rejects.toThrow("changed");
  });
  it("clears the secure token after logout even when the network fails", async () => {
    const c = new NativeClient();
    c.endpoint = "https://workspace.example.in";
    c.token = "session";
    storage.set("schach.session", "session");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(c.logout()).rejects.toThrow("offline");
    expect(c.token).toBe("");
    expect(storage.has("schach.session")).toBe(false);
  });
  it("refuses a development HTTP endpoint restored into a release client", async () => {
    storage.set("schach.endpoint", "http://localhost:8080");
    storage.set("schach.session", "session");
    const c = new NativeClient();
    await c.restore();
    expect(c.token).toBe("");
    expect(storage.has("schach.session")).toBe(false);
  });
});

describe("native policy contact", () => {
  it("invalidates registered private UI and in-flight generations after an authorization denial", async () => {
    const c = new NativeClient();
    c.endpoint = "https://workspace.example.in";
    c.token = "session";
    const clear = vi.fn();
    c.onPolicyChange = clear;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          error: { message: "Current conversation unavailable" },
        }),
      }),
    );
    const generation = c.generation;
    await expect(
      c.request("/companies/one/conversations/private"),
    ).rejects.toThrow("unavailable");
    expect(clear).toHaveBeenCalledOnce();
    expect(c.generation).toBeGreaterThan(generation);
  });
});
it("exposes status/code while retaining a recoverable transport scope", async () => {
  const c = new NativeClient();
  c.endpoint = "https://workspace.example.in";
  const before = c.generation;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: { code: "refetch_required", message: "History changed" },
      }),
    }),
  );
  await expect(
    c.request("/companies/c/conversations/a/sync"),
  ).rejects.toMatchObject({ status: 409, code: "refetch_required" });
  expect(c.generation).toBe(before);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Error("offline")));
  await expect(c.request("/companies/c/bootstrap")).rejects.toThrow("offline");
  expect(c.generation).toBe(before);
});
it("sends additive evidence as multipart file with bearer auth and no JSON content type", async () => {
  const c = new NativeClient();
  c.endpoint = "https://workspace.example.in";
  c.token = "private-token";
  const send = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ id: "evidence" }) });
  vi.doMock("expo/fetch", () => ({ fetch: send }));
  await c.appendFile(
    "/companies/c/tasks/t/attachments",
    new Blob(["evidence"], { type: "text/plain" }),
    "note.txt",
  );
  const options = send.mock.calls[0][1];
  expect(options.headers.Authorization).toBe("Bearer private-token");
  expect(options.headers["Content-Type"]).toBeUndefined();
  expect(options.body.get("file").name).toBe("note.txt");
  expect(await options.body.get("file").text()).toBe("evidence");
  expect(send.mock.calls[0][0]).not.toContain("private-token");
});

it.each([true, false])(
  "contextual thread404 reauthorizes metadata before choosing source absence vs policy denial (%s)",
  async (authorized) => {
    const c = new NativeClient();
    c.endpoint = "https://test.example";
    c.token = "token";
    const policy = vi.fn();
    c.onPolicyChange = policy;
    const gone = {
      ok: false,
      status: 404,
      json: async () => ({ error: { code: "not_found", message: "Gone" } }),
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(gone)
        .mockResolvedValueOnce(
          authorized
            ? { ok: true, json: async () => ({ conversation: { id: "a" } }) }
            : gone,
        ),
    );
    await expect(
      c.requestThread("/companies/c/conversations/a/messages/deleted/thread"),
    ).rejects.toMatchObject(
      authorized ? { contextualSource: true } : { status: 404 },
    );
    expect(policy).toHaveBeenCalledTimes(authorized ? 0 : 1);
    expect(c.generation).toBe(authorized ? 0 : 1);
  },
);

it.each([
  ["GET", "/intelligence/jobs/raw", 403, "expired", true],
  ["GET", "/intelligence/jobs/raw", 403, "source_unavailable", false],
  ["GET", "/intelligence/jobs/raw", 401, "expired", false],
  ["GET", "/intelligence/jobs/raw", 404, "expired", false],
  ["POST", "/intelligence/jobs/raw/publication-access", 403, "expired", false],
  ["POST", "/intelligence/jobs/raw/cancel", 403, "expired", false],
  ["GET", "/tasks/raw", 403, "expired", false],
] as const)(
  "actual native raw expiry transport classification %s %s %s %s",
  async (method, path, status, code, preserve) => {
    const { beginAttempt, readAttempt, clearAllBusinessAttempts } =
      await import("../../shared/business/attempts");
    clearAllBusinessAttempts();
    const c = new NativeClient();
    c.endpoint = "https://owned.test";
    const scope = {
      serverOrigin: c.endpoint,
      companyId: "co",
      userId: "actor",
      formId: "$intelligence-review:raw:0",
    };
    const original = beginAttempt(
      scope,
      { title: "Human authored", intelligenceBasis: { jobId: "raw" } },
      "original-key",
      {
        path: "/tasks",
        method: "POST",
        canonical: true,
        sources: ["/intelligence/jobs/raw/publication-access"],
      },
    );
    const retired = vi.fn(() => clearAllBusinessAttempts());
    c.onPolicyChange = retired;
    const cancel = vi.fn();
    c.registerCancellation(cancel);
    const generation = c.generation;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status,
        json: async () => ({ error: { code, message: "Raw unavailable" } }),
      })),
    );
    await expect(
      c.request("/companies/co" + path, method),
    ).rejects.toMatchObject({ status, code });
    expect(c.generation).toBe(generation + (preserve ? 0 : 1));
    expect(retired).toHaveBeenCalledTimes(preserve ? 0 : 1);
    expect(cancel).toHaveBeenCalledTimes(preserve ? 0 : 1);
    expect(readAttempt(scope)).toBe(preserve ? original : undefined);
    clearAllBusinessAttempts();
  },
);
