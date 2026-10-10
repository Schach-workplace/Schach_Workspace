import { beforeEach, expect, it, vi } from "vitest";
import {
  captureImage,
  recoverCamera,
  captureOwner,
  setCaptureContext,
  clearCaptures,
} from "./capture";
const env = vi.hoisted(() => ({
  granted: true,
  launchError: false,
  pending: null as any,
  canceled: false,
  deletes: 0,
  resolve: null as any,
}));
vi.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: async () => ({
    granted: env.granted,
    canAskAgain: false,
  }),
  launchCameraAsync: async () => {
    if (env.launchError) throw Error("Activity was recreated");
    return env.resolve
      ? new Promise((r) => (env.resolve = r))
      : {
          canceled: env.canceled,
          assets: [
            {
              uri: "camera.jpg",
              fileName: "photo.jpg",
              mimeType: "image/jpeg",
            },
          ],
        };
  },
  getPendingResultAsync: async () => env.pending,
}));
vi.mock("expo-document-picker", () => ({
  getDocumentAsync: async () => ({ canceled: true }),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "cache" },
  File: class {
    uri: string;
    size = 32;
    exists = true;
    constructor(...parts: string[]) {
      this.uri = parts.join("/");
    }
    copy(file: any) {
      file.exists = true;
    }
    delete() {
      this.exists = false;
      env.deletes++;
    }
  },
}));
vi.mock("./client", () => ({
  client: { endpoint: "https://test", request: async () => ({}) },
}));
const scope = {
  serverOrigin: "https://test",
  companyId: "c",
  userId: "u",
  targetKind: "task" as const,
  targetId: "t",
};
beforeEach(() => {
  clearCaptures();
  env.granted = true;
  env.launchError = false;
  env.pending = null;
  env.canceled = false;
  env.deletes = 0;
  env.resolve = null;
  setCaptureContext({ ...scope, ready: true });
});
it("denied or canceled camera never creates an upload preview", async () => {
  env.granted = false;
  await expect(captureImage(scope)).rejects.toThrow("system settings");
  expect(captureOwner(scope).state.file).toBeNull();
  env.granted = true;
  env.canceled = true;
  expect(await captureImage(scope)).toBeNull();
  expect(captureOwner(scope).state.file).toBeNull();
});
it("retains original destination across temporary background and deletes a returned preview on company change", async () => {
  env.resolve = true;
  const pending = captureImage(scope);
  await vi.waitFor(() => expect(typeof env.resolve).toBe("function"));
  setCaptureContext({ ...scope, ready: false });
  env.resolve({
    canceled: false,
    assets: [
      { uri: "camera.jpg", fileName: "photo.jpg", mimeType: "image/jpeg" },
    ],
  });
  await Promise.resolve();
  setCaptureContext({ ...scope, ready: true });
  expect((await pending)?.name).toBe("photo.jpg");
  expect(captureOwner(scope).state.file?.name).toBe("photo.jpg");
  captureOwner(scope).clear();
  env.resolve = true;
  const other = captureImage(scope);
  await vi.waitFor(() => expect(typeof env.resolve).toBe("function"));
  setCaptureContext({ ...scope, companyId: "other", ready: true });
  env.resolve({
    canceled: false,
    assets: [
      { uri: "camera.jpg", fileName: "photo.jpg", mimeType: "image/jpeg" },
    ],
  });
  await expect(other).rejects.toThrow("changed");
  expect(env.deletes).toBeGreaterThan(0);
});

it("recovers Android pending output only with its original RAM destination, never after scope cleanup", async () => {
  env.launchError = true;
  await expect(captureImage(scope)).rejects.toThrow("recreated");
  env.pending = {
    canceled: false,
    assets: [
      { uri: "camera.jpg", fileName: "photo.jpg", mimeType: "image/jpeg" },
    ],
  };
  expect((await recoverCamera())?.name).toBe("photo.jpg");
  clearCaptures();
  await expect(recoverCamera()).rejects.toThrow("original destination");
  expect(captureOwner(scope).state.file).toBeNull();
});
