// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Calls, {
  ActiveCall,
  callScope,
  createPendingCall,
  planCallStart,
  requestCallPermissions,
} from "./Calls";
const env = vi.hoisted(() => ({
  w: {} as any,
  requests: [] as { path: string; method?: string; body?: any }[],
  respond: (_path: string, _method?: string): any => ({}),
  mic: { granted: true, canAskAgain: true },
  camera: { granted: true, canAskAgain: true },
  cameraRequests: 0,
  participant: {
    isMicrophoneEnabled: true,
    isCameraEnabled: false,
    lastMicrophoneError: undefined as Error | undefined,
    lastCameraError: undefined as Error | undefined,
    localParticipant: {
      setMicrophoneEnabled: vi.fn(async () => {}),
      setCameraEnabled: vi.fn(async () => {}),
      setScreenShareEnabled: vi.fn(async () => {}),
    },
  },
  uuid: 0,
  pushed: [] as unknown[],
}));
vi.mock("./client", () => ({
  client: {
    generation: 1,
    token: "token",
    endpoint: "https://server",
    request: async (path: string, method?: string, body?: unknown) => {
      env.requests.push({ path, method, body });
      return env.respond(path, method);
    },
  },
}));
vi.mock("./Workspace", () => ({ useWorkspace: () => env.w }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "key-" + ++env.uuid }));
vi.mock("expo-router", () => ({
  router: { push: (v: unknown) => env.pushed.push(v) },
}));
vi.mock("expo-audio", () => ({
  requestRecordingPermissionsAsync: async () => env.mic,
}));
vi.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: async () => {
    env.cameraRequests++;
    return env.camera;
  },
}));
vi.mock("livekit-client", () => ({
  Track: { Source: { Camera: "camera", ScreenShare: "screen" } },
}));
vi.mock("@livekit/react-native", () => ({
  AudioSession: {
    configureAudio: async () => {},
    startAudioSession: async () => {},
    stopAudioSession: async () => {},
    selectAudioOutput: async () => {},
  },
  LiveKitRoom: ({ children }: any) => createElement("div", {}, children),
  VideoTrack: () => null,
  isTrackReference: () => true,
  useTracks: () => [],
  useLocalParticipant: () => env.participant,
  useRoomContext: () => ({ localParticipant: env.participant.localParticipant }),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  NativeModules: {},
  View: ({ children, accessibilityRole }: any) =>
    createElement("div", { role: accessibilityRole }, children),
  Text: ({ children, accessibilityRole }: any) =>
    createElement("span", { role: accessibilityRole }, children),
  Button: ({ title, onPress, disabled, accessibilityState }: any) =>
    createElement(
      "button",
      {
        onClick: onPress,
        disabled,
        "aria-selected": accessibilityState?.selected,
      },
      title,
    ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
function workspace(overrides: Record<string, unknown> = {}) {
  env.w = {
    company: "c",
    session: { user: { id: "u" } },
    policyEpoch: 1,
    device: "device",
    selected: "a",
    call: null,
    foreground: true,
    listMore: false,
    conversations: [
      { id: "a", title: "Alpha", archived: false },
      { id: "b", title: "Beta", archived: false },
      { id: "z", title: "Old", archived: true },
    ],
    setError: vi.fn(),
    setCall: vi.fn(),
    select: vi.fn(),
    registerDevice: vi.fn(async () => {}),
    loadMoreConversations: vi.fn(),
    ...overrides,
  };
}
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
async function render(element = createElement(Calls)) {
  await act(async () => root.render(element));
}
function button(title: string) {
  const found = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === title,
  );
  if (!found) throw Error("Missing button " + title + ": " + container.textContent);
  return found as HTMLButtonElement;
}
async function press(title: string) {
  await act(async () => button(title).click());
}
const posts = () =>
  env.requests.filter((r) => r.method === "POST" && r.path.endsWith("/calls"));
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  env.requests = [];
  env.pushed = [];
  env.uuid = 0;
  env.cameraRequests = 0;
  env.mic = { granted: true, canAskAgain: true };
  env.camera = { granted: true, canAskAgain: true };
  env.respond = (path, method) => {
    if (method === "POST" && path.endsWith("/calls")) return { id: "call-1" };
    if (path.endsWith("/token"))
      return { token: "t", url: "wss://x", call: { id: "call-1", kind: "audio", version: 1 } };
    return { calls: [] };
  };
  workspace();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

it("plans retries only for the same scope, conversation and kind", () => {
  const scope = callScope("e", "c", "u", 1);
  const attempt = createPendingCall(scope, "c", "a", "audio", "k");
  expect(Object.isFrozen(attempt.body)).toBe(true);
  expect(attempt.path).toBe("/companies/c/conversations/a/calls");
  expect(planCallStart(attempt, scope, "a", "audio")).toEqual({ type: "retry", attempt });
  expect(planCallStart(attempt, scope, "a", "video").type).toBe("conflict");
  expect(planCallStart(attempt, scope, "b", "audio").type).toBe("conflict");
  expect(planCallStart(attempt, callScope("e", "d", "u", 1), "a", "video")).toEqual({ type: "new" });
  expect(planCallStart(attempt, callScope("e", "c", "v", 1), "a", "audio")).toEqual({ type: "new" });
  expect(planCallStart(attempt, callScope("e", "c", "u", 2), "a", "audio")).toEqual({ type: "new" });
  expect(planCallStart(null, scope, "a", "audio")).toEqual({ type: "new" });
});

it("does not silently re-send a failed attempt for a different call and retries the frozen original explicitly", async () => {
  env.respond = () => {
    throw Error("Network unavailable");
  };
  await render();
  await press("Audio call");
  expect(posts()).toEqual([
    { path: "/companies/c/conversations/a/calls", method: "POST", body: { kind: "audio", retryKey: "key-1" } },
  ]);
  expect(container.textContent).toContain("Your audio call in Alpha did not start");
  // The user moves to another conversation and asks for a video call.
  workspace({ selected: "b" });
  await render();
  await press("Video call");
  expect(posts()).toHaveLength(1);
  expect(container.textContent).toContain("before starting a video call in Beta");
  // Explicit retry re-sends exactly the original kind, conversation and key.
  await press("Retry audio call");
  expect(posts()).toHaveLength(2);
  expect(posts()[1]).toEqual(posts()[0]);
  // Discarding allows a fresh attempt for the current selection.
  await press("Discard pending call");
  expect(container.textContent).not.toContain("did not start");
  await press("Video call");
  expect(posts()[2]).toEqual({
    path: "/companies/c/conversations/b/calls",
    method: "POST",
    body: { kind: "video", retryKey: "key-2" },
  });
});

it("retries the same call with the same key and joins the already-created call", async () => {
  env.mic = { granted: false, canAskAgain: true };
  await render();
  await press("Audio call");
  expect(env.w.setError).toHaveBeenLastCalledWith("Microphone permission is required to join a call.");
  env.mic = { granted: true, canAskAgain: true };
  await press("Audio call");
  // The call was already created, so only a token is requested again.
  expect(posts()).toHaveLength(1);
  expect(env.requests.filter((r) => r.path.endsWith("/token"))).toHaveLength(2);
  expect(env.w.setCall).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain("did not start");
});

it("discards a pending attempt when the company or session changes", async () => {
  env.respond = () => {
    throw Error("offline");
  };
  await render();
  await press("Audio call");
  expect(container.textContent).toContain("did not start");
  workspace({ company: "d" });
  await render();
  expect(container.textContent).not.toContain("did not start");
  await press("Video call");
  expect(posts().at(-1)).toEqual({
    path: "/companies/d/conversations/a/calls",
    method: "POST",
    body: { kind: "video", retryKey: "key-2" },
  });
  workspace({ company: "d", session: { user: { id: "other" } } });
  await render();
  expect(container.textContent).not.toContain("did not start");
});

it("requests camera permission only for video calls with specific denial messages", async () => {
  await requestCallPermissions("audio");
  expect(env.cameraRequests).toBe(0);
  env.camera = { granted: false, canAskAgain: true };
  await expect(requestCallPermissions("video")).rejects.toThrow("Camera permission is required for video calls");
  env.camera = { granted: false, canAskAgain: false };
  await expect(requestCallPermissions("video")).rejects.toThrow(/Enable it in device Settings/);
  env.mic = { granted: false, canAskAgain: false };
  await expect(requestCallPermissions("video")).rejects.toThrow(/Microphone access is off/);
});

it("offers a conversation picker, explains a missing device and refreshes active calls while focused", async () => {
  vi.useFakeTimers();
  workspace({ selected: "", device: "" });
  await render(createElement(Calls, { focused: true }));
  expect(container.textContent).toContain("Choose a conversation above");
  expect(container.textContent).not.toContain("Old");
  expect(button("Alpha").getAttribute("aria-selected")).toBe("false");
  await press("Alpha");
  expect(env.w.select).toHaveBeenCalledWith("a");
  expect(container.textContent).toContain("not registered for calls");
  await press("Open Account");
  expect(env.pushed).toEqual(["/account"]);
  await press("Register this device");
  expect(env.w.registerDevice).toHaveBeenCalledWith(false);
  let active = [{ id: "x", kind: "video", state: "active" }];
  env.respond = () => ({ calls: active });
  workspace({ selected: "a" });
  await render(createElement(Calls, { focused: true }));
  expect(button("Alpha ✓").getAttribute("aria-selected")).toBe("true");
  expect(button("Join video call")).toBeTruthy();
  active = [];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(container.textContent).not.toContain("Join video call");
  const reads = env.requests.length;
  await render(createElement(Calls, { focused: false }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  expect(env.requests.length).toBe(reads);
});

it("shows camera controls only in video calls and reflects the actual local track state", async () => {
  const call = { token: "t", url: "u", call: { id: "1", kind: "audio", version: 1 } };
  workspace({ call });
  await render(createElement(ActiveCall));
  expect(container.textContent).toContain("Mute microphone");
  expect(container.textContent).not.toContain("camera");
  workspace({ call: { ...call, call: { ...call.call, kind: "video" } } });
  env.participant.isCameraEnabled = false;
  await render(createElement(ActiveCall));
  expect(container.textContent).toContain("Start camera");
  env.participant.localParticipant.setCameraEnabled.mockRejectedValueOnce(Error("Camera busy"));
  await press("Start camera");
  expect(env.w.setError).toHaveBeenCalledWith("Could not change the camera: Camera busy");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Camera busy");
  env.participant.isCameraEnabled = true;
  env.participant.isMicrophoneEnabled = false;
  await render(createElement(ActiveCall));
  expect(container.textContent).toContain("Stop camera");
  expect(container.textContent).toContain("Unmute microphone");
});
