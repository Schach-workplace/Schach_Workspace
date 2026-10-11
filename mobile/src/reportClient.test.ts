import { it, expect, vi, beforeEach } from "vitest";
import { ReportTransfer, cleanupReportTemps } from "./reportClient";
const env = vi.hoisted(() => ({
  download: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
  share: vi.fn(),
  size: 10,
  request: vi.fn(),
  generation: 1,
  downloadArgs: [] as any[],
  invalidate: () => {},
  resume: (_state: string) => {},
}));
vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///private-cache/",
  FileSystemSessionType: { FOREGROUND: 1 },
  getInfoAsync: async () => ({
    exists: true,
    isDirectory: false,
    size: env.size,
  }),
  makeDirectoryAsync: vi.fn(),
  deleteAsync: env.remove,
  readDirectoryAsync: async () => ["orphan.csv"],
  createDownloadResumable: (...args: any[]) => {
    env.downloadArgs = args;
    return { downloadAsync: env.download, cancelAsync: env.cancel };
  },
}));
vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_event: string, fn: (state: string) => void) => {
      env.resume = fn;
      return {
        remove: () => {
          env.resume = () => {};
        },
      };
    },
  },
}));
vi.mock("expo-sharing", () => ({
  isAvailableAsync: async () => true,
  shareAsync: env.share,
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("./client", () => ({
  client: {
    endpoint: "https://owned.test",
    token: "private-token",
    get generation() {
      return env.generation;
    },
    request: env.request,
    registerCancellation: (fn: () => void) => {
      env.invalidate = fn;
      return () => {
        env.invalidate = () => {};
      };
    },
  },
}));
beforeEach(() => {
  vi.useRealTimers();
  env.request.mockClear();
  env.share.mockReset();
  env.share.mockResolvedValue(undefined);
  env.generation = 1;
  env.size = 10;
  env.cancel.mockResolvedValue(undefined);
  env.remove.mockResolvedValue(undefined);
  env.download.mockResolvedValue({ status: 200 });
  env.request.mockResolvedValue({
    job: { state: "ready", artifactId: "artifact" },
    artifact: { id: "artifact", length: 10, expiresAt: "2099-01-01T00:00:00Z" },
  });
  env.share.mockClear();
  env.remove.mockClear();
  env.cancel.mockClear();
});
it("authenticates only the controlled API path, rechecks ready access and deletes the private explicit share copy", async () => {
  await new ReportTransfer().share("co", "job", () => true);
  expect(env.downloadArgs[0]).toBe(
    "https://owned.test/api/companies/co/reports/artifacts/artifact",
  );
  expect(env.downloadArgs[2].headers.Authorization).toBe(
    "Bearer private-token",
  );
  expect(env.request).toHaveBeenCalledTimes(2);
  expect(env.share).toHaveBeenCalledTimes(1);
  expect(env.remove).toHaveBeenCalled();
});
it("never shares partial bytes or a scope changed during download", async () => {
  env.size = 9;
  await expect(
    new ReportTransfer().share("co", "job", () => true),
  ).rejects.toThrow(/incomplete/);
  expect(env.share).not.toHaveBeenCalled();
  env.size = 10;
  env.download.mockImplementationOnce(async () => {
    env.generation++;
    return { status: 200 };
  });
  await expect(
    new ReportTransfer().share("co", "job", () => true),
  ).rejects.toThrow();
  expect(env.share).not.toHaveBeenCalled();
});
it("cleans only its owned temporary namespace after restart", async () => {
  await cleanupReportTemps();
  expect(env.remove).toHaveBeenCalledWith(
    "file:///private-cache/report-private-v1/",
    { idempotent: true },
  );
});

it("preserves an already published original URI through OS background and same-source recheck until the receiver finishes", async () => {
  let finish: () => void = () => {};
  let authorized = true;
  env.share.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const transfer = new ReportTransfer();
  const done = transfer.share("co", "job", () => authorized);
  await vi.waitFor(() => expect(env.share).toHaveBeenCalledTimes(1));
  const uri = env.share.mock.calls[0][0];
  authorized = false;
  env.generation++;
  env.invalidate();
  await transfer.cancel();
  expect(env.remove.mock.calls.some(([path]) => path === uri)).toBe(false);
  expect(env.request).toHaveBeenCalledTimes(2);
  finish();
  await done;
  expect(env.remove).toHaveBeenCalledWith(uri, { idempotent: true });
});

it("deletes published copies on receiver failure and enforces the original 120-second handoff deadline", async () => {
  env.share.mockRejectedValueOnce(Error("receiver failed"));
  await expect(
    new ReportTransfer().share("co", "job", () => true),
  ).rejects.toThrow("receiver failed");
  expect(env.remove).toHaveBeenCalledWith(env.share.mock.calls[0][0], {
    idempotent: true,
  });
  env.remove.mockClear();
  env.share.mockClear();
  env.share.mockImplementationOnce(() => new Promise<void>(() => {}));
  vi.useFakeTimers();
  try {
    const done = new ReportTransfer().share("co", "job", () => true);
    const rejected = expect(done).rejects.toThrow(/timed out/);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(env.share).toHaveBeenCalledTimes(1);
    const uri = env.share.mock.calls[0][0];
    await vi.advanceTimersByTimeAsync(119999);
    expect(env.remove.mock.calls.some(([path]) => path === uri)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(env.remove).toHaveBeenCalledWith(uri, { idempotent: true });
  } finally {
    vi.useRealTimers();
  }
});

it("revocation immediately before OS handoff discards unpublished bytes and never shares", async () => {
  let authorized = true;
  env.request.mockImplementationOnce(async () => ({
    job: { state: "ready" },
    artifact: { id: "artifact", length: 10, expiresAt: "2099-01-01T00:00:00Z" },
  }));
  env.request.mockImplementationOnce(async () => {
    authorized = false;
    env.generation++;
    env.invalidate();
    return {
      job: { state: "ready" },
      artifact: {
        id: "artifact",
        length: 10,
        expiresAt: "2099-01-01T00:00:00Z",
      },
    };
  });
  await expect(
    new ReportTransfer().share("co", "job", () => authorized),
  ).rejects.toThrow(/access changed/);
  expect(env.share).not.toHaveBeenCalled();
  expect(env.remove).toHaveBeenCalledWith(env.downloadArgs[1], {
    idempotent: true,
  });
});

it("checks elapsed handoff time on resume when suspended timers have not run", async () => {
  vi.useFakeTimers();
  try {
    const started = Date.now();
    env.share.mockImplementationOnce(() => new Promise<void>(() => {}));
    const done = new ReportTransfer().share("co", "job", () => true);
    const rejected = expect(done).rejects.toThrow(/timed out/);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(env.share).toHaveBeenCalledTimes(1);
    const uri = env.share.mock.calls[0][0];
    vi.setSystemTime(started + 120001);
    expect(env.remove.mock.calls.some(([path]) => path === uri)).toBe(false);
    env.resume("active");
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(env.remove).toHaveBeenCalledWith(uri, { idempotent: true });
    await rejected;
  } finally {
    vi.useRealTimers();
  }
});
