import { afterEach, expect, it, vi } from "vitest";
import { captureImage, clearCaptures, setCaptureContext } from "./capture";
const state = vi.hoisted(() => ({
  generation: 1,
  endpoint: "https://company.test",
  request: vi.fn(),
  launch: vi.fn(),
  permission: vi.fn(),
  deleted: 0,
}));
vi.mock("./client", () => ({ client: state }));
vi.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: state.permission,
  launchCameraAsync: state.launch,
}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "fixture" }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "cache" },
  File: class {
    uri: string;
    exists = true;
    size = 20;
    constructor(...v: string[]) {
      this.uri = v.join("/");
    }
    copy() {}
    delete() {
      state.deleted++;
    }
  },
}));
const scope = {
  serverOrigin: state.endpoint,
  companyId: "c",
  userId: "u",
  targetKind: "finance_intake" as const,
  targetId: "real-reserved-id",
};
afterEach(() => {
  clearCaptures();
  vi.clearAllMocks();
  state.deleted = 0;
});
it("authorizes a real private capture reservation before camera and freshly after return", async () => {
  setCaptureContext({
    serverOrigin: state.endpoint,
    companyId: "c",
    userId: "u",
    ready: true,
  });
  state.request.mockResolvedValue({
    state: "capture_reserved",
    purpose: "receipt",
  });
  state.permission.mockResolvedValue({ granted: true });
  state.launch.mockResolvedValue({
    canceled: false,
    assets: [
      { uri: "source.jpg", fileName: "Photo.jpg", mimeType: "image/jpeg" },
    ],
  });
  await captureImage(scope);
  expect(
    state.request.mock.calls.every(
      ([path]) => path === "/companies/c/finance/intakes/real-reserved-id",
    ),
  ).toBe(true);
  expect(state.request).toHaveBeenCalledTimes(2);
});
it("does not recapture a canonical already-bound source", async () => {
  setCaptureContext({
    serverOrigin: state.endpoint,
    companyId: "c",
    userId: "u",
    ready: true,
  });
  state.request.mockResolvedValue({ state: "reserved", purpose: "receipt" });
  await expect(captureImage(scope)).rejects.toThrow(/bound|reservation/i);
  expect(state.launch).not.toHaveBeenCalled();
});
it("discards camera return after original company changes", async () => {
  setCaptureContext({
    serverOrigin: state.endpoint,
    companyId: "c",
    userId: "u",
    ready: true,
  });
  state.request.mockResolvedValue({
    state: "capture_reserved",
    purpose: "receipt",
  });
  state.permission.mockResolvedValue({ granted: true });
  state.launch.mockImplementation(async () => {
    setCaptureContext({
      serverOrigin: state.endpoint,
      companyId: "other",
      userId: "u",
      ready: true,
    });
    return {
      canceled: false,
      assets: [
        { uri: "source.jpg", fileName: "Photo.jpg", mimeType: "image/jpeg" },
      ],
    };
  });
  await expect(captureImage(scope)).rejects.toThrow();
  expect(state.deleted).toBe(1);
});
