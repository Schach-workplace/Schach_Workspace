import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Button, NativeModules, Platform, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  isTrackReference,
  useLocalParticipant,
  useRoomContext,
  useTracks,
} from "@livekit/react-native";
import { Track } from "livekit-client";
import { requestRecordingPermissionsAsync } from "expo-audio";
import { client } from "./client";
import { useWorkspace, type CallConnection } from "./Workspace";

export type CallKind = "audio" | "video";

/**
 * A call start that has not completed. Its target path and body are frozen
 * when it is first created: a retry re-sends exactly the original kind,
 * conversation and retry key, never the user's current selection.
 */
export interface PendingCall {
  readonly scope: string;
  readonly conversationId: string;
  readonly kind: CallKind;
  readonly path: string;
  readonly body: Readonly<{ kind: CallKind; retryKey: string }>;
  readonly id?: string;
}

/** Company/session/access scope a pending attempt belongs to. */
export function callScope(
  endpoint: string,
  companyId: string,
  userId: string,
  policyEpoch: number,
) {
  return [endpoint, companyId, userId, policyEpoch].join("|");
}

export function createPendingCall(
  scope: string,
  companyId: string,
  conversationId: string,
  kind: CallKind,
  retryKey: string,
): PendingCall {
  return Object.freeze({
    scope,
    conversationId,
    kind,
    path: `/companies/${companyId}/conversations/${conversationId}/calls`,
    body: Object.freeze({ kind, retryKey }),
  });
}

/** The pending attempt that is still valid for the current company/session. */
export function pendingInScope(pending: PendingCall | null, scope: string) {
  return pending && pending.scope === scope ? pending : null;
}

export type CallStartPlan =
  | { type: "new" }
  | { type: "retry"; attempt: PendingCall }
  | { type: "conflict"; attempt: PendingCall };

/**
 * Decides what a tap on "Audio call" / "Video call" does. A pending attempt is
 * only reused for the same conversation and kind; any other request must be
 * resolved explicitly (retry the original or discard it).
 */
export function planCallStart(
  pending: PendingCall | null,
  scope: string,
  conversationId: string,
  kind: CallKind,
): CallStartPlan {
  const current = pendingInScope(pending, scope);
  if (!current) return { type: "new" };
  if (current.conversationId === conversationId && current.kind === kind)
    return { type: "retry", attempt: current };
  return { type: "conflict", attempt: current };
}

export async function requestCallPermissions(kind: string) {
  const microphone = await requestRecordingPermissionsAsync();
  if (!microphone.granted)
    throw new Error(
      microphone.canAskAgain === false
        ? "Microphone access is off for Schach Workspace. Enable it in device Settings to join calls."
        : "Microphone permission is required to join a call.",
    );
  if (kind !== "video") return;
  const camera = await ImagePicker.requestCameraPermissionsAsync();
  if (!camera.granted)
    throw new Error(
      camera.canAskAgain === false
        ? "Camera access is off for Schach Workspace. Enable it in device Settings to join video calls, or start an audio call instead."
        : "Camera permission is required for video calls. Allow camera access, or start an audio call instead.",
    );
}

function stopNativeCall() {
  void AudioSession.stopAudioSession();
  if (Platform.OS === "android") NativeModules.SchachCallService?.stop();
}

function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function Tracks({ kind }: { kind: string }) {
  const w = useWorkspace();
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare]);
  const {
    localParticipant,
    isMicrophoneEnabled,
    isCameraEnabled,
    lastMicrophoneError,
    lastCameraError,
  } = useLocalParticipant();
  const [toggling, setToggling] = useState<"" | "microphone" | "camera">("");
  const [problem, setProblem] = useState("");
  async function toggle(device: "microphone" | "camera") {
    setToggling(device);
    setProblem("");
    try {
      if (device === "microphone")
        await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
      else await localParticipant.setCameraEnabled(!isCameraEnabled);
    } catch (e) {
      const text = `Could not change the ${device}: ${message(e)}`;
      setProblem(text);
      w.setError(text);
    } finally {
      setToggling("");
    }
  }
  function output(route: "speaker" | "earpiece") {
    void AudioSession.selectAudioOutput(route).catch((e) =>
      w.setError(`Could not change audio output: ${message(e)}`),
    );
  }
  const deviceError =
    problem ||
    (lastMicrophoneError && `Microphone: ${lastMicrophoneError.message}`) ||
    (lastCameraError && `Camera: ${lastCameraError.message}`) ||
    "";
  return (
    <View>
      {tracks.filter(isTrackReference).map((t) => (
        <VideoTrack
          key={t.publication.trackSid}
          trackRef={t}
          style={{ height: 220 }}
        />
      ))}
      <Button
        disabled={!!toggling}
        title={isMicrophoneEnabled ? "Mute microphone" : "Unmute microphone"}
        onPress={() => void toggle("microphone")}
      />
      {kind === "video" && (
        <Button
          disabled={!!toggling}
          title={isCameraEnabled ? "Stop camera" : "Start camera"}
          onPress={() => void toggle("camera")}
        />
      )}
      <Button title="Use speaker" onPress={() => output("speaker")} />
      <Button
        title="Use headset / earpiece"
        onPress={() => output("earpiece")}
      />
      {!!deviceError && <Text accessibilityRole="alert">{deviceError}</Text>}
    </View>
  );
}

function PrivacyCallState() {
  const room = useRoomContext();
  const w = useWorkspace();
  const report = useEffectEvent((text: string) => w.setError(text));
  useEffect(() => {
    if (!w.foreground)
      void Promise.all([
        room.localParticipant.setCameraEnabled(false),
        room.localParticipant.setScreenShareEnabled(false),
      ]).catch((e) => report(e.message));
  }, [w.foreground, room]);
  return null;
}

export function ActiveCall() {
  const w = useWorkspace();
  useEffect(() => () => stopNativeCall(), [w.call?.call.id]);
  if (!w.call) return null;
  const connection = w.call;
  const leave = () => {
    w.setCall(null);
    stopNativeCall();
  };
  return (
    <LiveKitRoom
      token={connection.token}
      serverUrl={connection.url}
      connect
      audio
      video={connection.call.kind === "video"}
      onDisconnected={leave}
      onError={(e) => w.setError(e.message)}
    >
      <PrivacyCallState />
      <View style={{ padding: 12, backgroundColor: "#e6f4ee" }}>
        <Text>Active {connection.call.kind} call · Recording off</Text>
        {w.foreground && <Tracks kind={connection.call.kind} />}
        <Button title="Leave call" onPress={leave} />
        <Button
          title="End call for everyone"
          onPress={() =>
            void client
              .request(
                `/companies/${w.company}/calls/${connection.call.id}/end`,
                "POST",
                { expectedVersion: connection.call.version },
              )
              .then(() => w.setCall(null))
              .catch((e) => w.setError(e.message))
          }
        />
      </View>
    </LiveKitRoom>
  );
}

export function CallConversationPicker() {
  const w = useWorkspace();
  const rows = w.conversations.filter((c) => !c.archived);
  return (
    <View>
      <Text>Conversation to call</Text>
      {rows.length === 0 && (
        <Text>
          No conversations are available yet. Start or join one in Chats.
        </Text>
      )}
      {rows.map((c) => (
        <Button
          key={c.id}
          title={c.title + (w.selected === c.id ? " ✓" : "")}
          accessibilityLabel={c.title}
          accessibilityState={{ selected: w.selected === c.id }}
          onPress={() => w.select(c.id)}
        />
      ))}
      {w.listMore && (
        <Button
          title="Load more conversations"
          onPress={w.loadMoreConversations}
        />
      )}
    </View>
  );
}

/** How often active calls are re-read while the Calls screen is focused. */
export const ACTIVE_CALL_REFRESH_MS = 10000;

export default function Calls({ focused = true }: { focused?: boolean }) {
  const w = useWorkspace();
  // Active-call reads are keyed by company and conversation so a result from
  // a previous selection is never shown for the current one.
  const [read, setRead] = useState<{
    key: string;
    calls: { id: string; kind: string; state: string }[];
    error: string;
  }>({ key: "", calls: [], error: "" });
  const [pendingCall, setPendingCall] = useState<PendingCall | null>(null);
  const [conflict, setConflict] = useState<{
    kind: CallKind;
    conversationId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const loadSequence = useRef(0);
  const scope = callScope(
    client.endpoint,
    w.company,
    w.session?.user.id ?? "",
    w.policyEpoch,
  );
  // Attempts from another company, session or access epoch are discarded.
  const pending = pendingInScope(pendingCall, scope);
  const visibleConflict = pending ? conflict : null;
  const title = (id: string) =>
    w.conversations.find((c) => c.id === id)?.title ?? "another conversation";

  async function join(id: string) {
    const generation = client.generation;
    const check = () => {
      if (generation !== client.generation || !client.token)
        throw new Error("Company or session changed during call setup.");
    };
    try {
      const connection = await client.request<CallConnection>(
        `/companies/${w.company}/calls/${id}/token`,
        "POST",
        { deviceId: w.device },
      );
      await requestCallPermissions(connection.call.kind);
      check();
      if (Platform.OS === "android") {
        if (!NativeModules.SchachCallService)
          throw new Error(
            "Install the current native development build to use calling.",
          );
        await NativeModules.SchachCallService.start();
      }
      await AudioSession.configureAudio({ ios: { defaultOutput: "earpiece" } });
      await AudioSession.startAudioSession();
      check();
      w.setCall(connection);
    } catch (e) {
      stopNativeCall();
      throw e;
    }
  }

  async function run(attempt: PendingCall) {
    setBusy(true);
    setConflict(null);
    setPendingCall(attempt);
    try {
      let current = attempt;
      if (!current.id) {
        const item = await client.request<{ id: string }>(
          current.path,
          "POST",
          current.body,
        );
        current = Object.freeze({ ...current, id: item.id });
        setPendingCall((p) => (p === attempt ? current : p));
      }
      await join(current.id!);
      setPendingCall((p) =>
        p === attempt || p === current ? null : p,
      );
    } catch (e) {
      w.setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  function start(kind: CallKind) {
    const plan = planCallStart(pendingCall, scope, w.selected, kind);
    if (plan.type === "conflict") {
      setConflict({ kind, conversationId: w.selected });
      return;
    }
    void run(
      plan.type === "retry"
        ? plan.attempt
        : createPendingCall(
            scope,
            w.company,
            w.selected,
            kind,
            Crypto.randomUUID(),
          ),
    );
  }

  const readKey = w.company + "|" + w.selected;
  const available = read.key === readKey ? read.calls : [];
  const loadError = read.key === readKey ? read.error : "";
  async function load() {
    if (!w.selected) return;
    const key = readKey;
    const sequence = ++loadSequence.current;
    const generation = client.generation;
    try {
      const v = await client.request<{ calls: typeof available }>(
        `/companies/${w.company}/conversations/${w.selected}/calls`,
      );
      if (
        sequence !== loadSequence.current ||
        generation !== client.generation
      )
        return;
      setRead({ key, calls: v.calls, error: "" });
    } catch (e) {
      if (sequence === loadSequence.current)
        setRead((old) => ({
          key,
          calls: old.key === key ? old.calls : [],
          error: `Could not refresh active calls: ${message(e)}`,
        }));
    }
  }
  const loadEvent = useEffectEvent(load);
  useEffect(() => {
    if (!focused || !w.selected) return;
    const tick = () => void Promise.resolve().then(() => loadEvent());
    tick();
    const timer = setInterval(tick, ACTIVE_CALL_REFRESH_MS);
    return () => clearInterval(timer);
  }, [focused, w.company, w.selected, w.call?.call.id]);

  const canStart = !busy && !w.call && !!w.device && !!w.selected;
  return (
    <View>
      <CallConversationPicker />
      {!w.device && (
        <View>
          <Text>
            This device is not registered for calls yet. Calls need a
            registered device so the server can issue a call token for it.
          </Text>
          <Button
            title="Register this device"
            onPress={() =>
              void w.registerDevice(false).catch((e) => w.setError(e.message))
            }
          />
          <Button
            title="Open Account"
            onPress={() => router.push("/account")}
          />
        </View>
      )}
      {pending && (
        <View accessibilityRole="alert">
          <Text>
            Your {pending.kind} call in {title(pending.conversationId)} did not
            start. Retrying sends the same call request again.
          </Text>
          {visibleConflict && (
            <Text>
              Retry or discard it before starting a {visibleConflict.kind} call
              {visibleConflict.conversationId !== pending.conversationId
                ? ` in ${title(visibleConflict.conversationId)}`
                : ""}
              .
            </Text>
          )}
          <Button
            disabled={busy || !!w.call || !w.device}
            title={`Retry ${pending.kind} call`}
            onPress={() => void run(pending)}
          />
          <Button
            disabled={busy}
            title="Discard pending call"
            onPress={() => {
              setPendingCall(null);
              setConflict(null);
            }}
          />
        </View>
      )}
      {w.selected ? (
        <View>
          <Button
            disabled={!canStart}
            title="Audio call"
            onPress={() => start("audio")}
          />
          <Button
            disabled={!canStart}
            title="Video call"
            onPress={() => start("video")}
          />
          {available
            .filter((c) => c.state === "active")
            .map((c) => (
              <Button
                key={c.id}
                disabled={busy || !!w.call || !w.device}
                title={`Join ${c.kind} call`}
                onPress={() =>
                  void join(c.id).catch((e) => w.setError(message(e)))
                }
              />
            ))}
          <Button title="Refresh active calls" onPress={() => void load()} />
          {!!loadError && <Text>{loadError}</Text>}
        </View>
      ) : (
        <Text>Choose a conversation above to start or join a call.</Text>
      )}
      <Text>
        Recording is off. Active-call audio uses the native audio session and
        Android foreground service. Background, headset and network behavior
        must pass device validation before rollout.
      </Text>
    </View>
  );
}
