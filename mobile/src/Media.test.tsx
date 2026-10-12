// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Media, { playablePreview } from "./Media";
import { CaptureOwner } from "./captureOwner";
const env = vi.hoisted(() => ({
  owner: null as any,
  captureImage: vi.fn(),
  document: vi.fn(),
  library: vi.fn(),
}));
vi.mock("./capture", () => ({
  captureOwner: () => env.owner,
  captureImage: env.captureImage,
}));
vi.mock("./client", () => ({
  client: { endpoint: "https://test", userId: "u", generation: 0 },
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: env.document }));
vi.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: env.library,
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));
vi.mock("expo-sharing", () => ({}));
vi.mock("expo-file-system", () => {
  class File {
    uri: string;
    exists = true;
    size = 10;
    type = "image/png";
    constructor(...parts: any[]) {
      this.uri = parts.map((p) => (typeof p === "string" ? p : "cache")).join("/");
    }
    copy() {}
    delete() {
      this.exists = false;
    }
  }
  return { File, Paths: { cache: {} } };
});
vi.mock("expo-audio", () => ({
  AudioModule: {},
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: vi.fn(),
  useAudioRecorder: () => ({ isRecording: false }),
  useAudioPlayer: () => ({ play: vi.fn(), pause: vi.fn() }),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) =>
    createElement("div", {}, children),
  Text: ({ children }: { children: ReactNode }) =>
    createElement("span", {}, children),
  Image: ({ accessibilityLabel }: any) =>
    createElement("img", { alt: accessibilityLabel }),
  Button: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
}));
let root: Root, container: HTMLDivElement;
const scope = {
  serverOrigin: "https://test",
  companyId: "c",
  userId: "u",
  targetKind: "chat" as const,
  targetId: "conv",
};
const titles = () =>
  Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
const button = (title: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === title,
  )!;
const render = () =>
  act(async () =>
    root.render(
      createElement(Media, {
        company: "c",
        conversation: "conv",
        disabled: false,
        onSent: async () => {},
      }),
    ),
  );
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  env.owner = new CaptureOwner(scope);
  env.captureImage.mockReset();
  env.document.mockReset();
  env.library.mockReset();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
});
it("offers distinctly labelled photo and file choosers without duplicates", async () => {
  await render();
  expect(titles()).toEqual([
    "Take photo",
    "Choose photo",
    "Choose file",
    "Record voice note",
  ]);
  expect(titles()).not.toContain("Choose attachment");
});
it("routes each chooser to its own picker and adopts the selection", async () => {
  await render();
  env.captureImage.mockResolvedValue(null);
  await act(async () => button("Take photo").click());
  expect(env.captureImage).toHaveBeenCalledWith(scope);
  env.library.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "picked", fileName: "site.png", mimeType: "image/png" }],
  });
  await act(async () => button("Choose photo").click());
  expect(env.library).toHaveBeenCalledWith(
    expect.objectContaining({ mediaTypes: ["images"] }),
  );
  expect(env.document).not.toHaveBeenCalled();
  expect(env.owner.state.file?.name).toBe("site.png");
  expect(container.querySelector("img")?.alt).toBe("Selected photo preview");
  // Image previews have nothing to play.
  expect(titles()).not.toContain("Play preview");
  expect(titles()).not.toContain("Pause preview");
  expect(button("Choose file").disabled).toBe(true);
});
it("shows playback controls only for audio or video selections", async () => {
  await render();
  env.document.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "voice", name: "memo.m4a", mimeType: "audio/mp4" }],
  });
  await act(async () => button("Choose file").click());
  expect(env.document).toHaveBeenCalledOnce();
  expect(titles()).toContain("Play preview");
  expect(titles()).toContain("Pause preview");
  expect(playablePreview("video/mp4")).toBe(true);
  expect(playablePreview("image/jpeg")).toBe(false);
  expect(playablePreview("application/pdf")).toBe(false);
  expect(playablePreview(undefined)).toBe(false);
});
