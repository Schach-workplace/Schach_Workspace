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
    registerCancellation: () => () => {},
  },
}));
beforeEach(() => {
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
