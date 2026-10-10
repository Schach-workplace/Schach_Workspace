import CaptureControl from "./CaptureControl";
import { captureOwner } from "./capture";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, Image, Text, View } from "react-native";
import * as Picker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
import * as Sharing from "expo-sharing";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioPlayer,
} from "expo-audio";
import { client } from "./client";
async function download(company: string, conversation: string, id: string) {
  return downloadPath(
    `/companies/${company}/conversations/${conversation}/media/${id}/download`,
    id,
  );
}
async function downloadPath(path: string, id: string) {
  const generation = client.generation;
  const target = new File(Paths.cache, id);
  try {
    const file = await File.downloadFileAsync(
      client.endpoint + "/api" + path,
      target,
      {
        headers: { Authorization: "Bearer " + client.token },
        idempotent: true,
      },
    );
    if (generation !== client.generation)
      throw new Error("Company access changed.");
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri);
    else throw new Error("This device cannot open the file.");
  } finally {
    if (target.exists) target.delete();
  }
}
interface Pending {
  file: File;
  name: string;
  clientMessageId: string;
  reservation?: string;
  uploaded: boolean;
  clean: boolean;
}
function Media({
  company,
  conversation,
  disabled,
  onSent,
}: {
  company: string;
  conversation: string;
  disabled: boolean;
  onSent: () => Promise<void>;
}) {
  const scope = {
    serverOrigin: client.endpoint,
    companyId: company,
    userId: client.userId,
    targetKind: "chat" as const,
    targetId: conversation,
  };
  const owner = captureOwner(scope);
  const selected = useSyncExternalStore(
    owner.subscribe,
    () => owner.state,
  ).file;
  const file = selected ? new File(selected.uri) : null;
  const name = selected?.name ?? "";
  const setFile = (
    file: File | null,
    name = "Attachment",
    mime = "application/octet-stream",
  ) => {
    if (file)
      owner.select({
        uri: file.uri,
        name,
        mime,
        size: file.size,
        delete: () => {
          if (file.exists) file.delete();
        },
      });
    else owner.clear();
  };
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [retry, setRetry] = useState(!!owner.intent);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useAudioPlayer(file?.uri ?? null);
  const alive = useRef(true);
  const startGeneration = useRef(client.generation);
  const owned = useRef(new Set<File>());

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (recorder.isRecording)
        void recorder.stop().then(() => {
          if (recorder.uri) {
            const f = new File(recorder.uri);
            if (f.exists) f.delete();
          }
        });
      player.pause();
    };
  }, [recorder, player]);
  function current() {
    if (!alive.current || startGeneration.current !== client.generation)
      throw new Error("Company or conversation changed.");
  }
  async function choose() {
    const result = await Picker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (!result.canceled) {
      const asset = result.assets[0];
      const selected = new File(asset.uri);
      owned.current.add(selected);
      try {
        current();
      } catch (e) {
        if (selected.exists) selected.delete();
        throw e;
      }
      if (selected.size > 25 * 1024 * 1024) {
        if (selected.exists) selected.delete();
        throw new Error("Choose media up to 25 MiB.");
      }
      setFile(selected, asset.name, asset.mimeType ?? selected.type);
    }
  }
  async function voice() {
    if (recording) {
      await recorder.stop();
      current();
      setRecording(false);
      if (recorder.uri) {
        const voiceFile = new File(recorder.uri);
        owned.current.add(voiceFile);
        setFile(voiceFile, "Voice note.m4a", "audio/mp4");
      }
      return;
    }
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    current();
    if (!permission.granted) throw new Error("Microphone access is disabled.");
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    current();
    await recorder.prepareToRecordAsync();
    current();
    recorder.record();
    setRecording(true);
  }
  async function send() {
    if (!file || !owner.beginIntent()) return;
    setBusy(true);
    try {
      const attempt = {
        ...((owner.intent as Pending | null) ?? {
          file,
          name,
          clientMessageId: Crypto.randomUUID(),
          uploaded: false,
          clean: false,
        }),
      };
      owner.setIntent({ ...attempt });
      setRetry(true);
      const root = `/companies/${company}/conversations/${conversation}/media`;
      if (!attempt.reservation) {
        const bytes = await attempt.file.bytes();
        const hash = await Crypto.digest(
          Crypto.CryptoDigestAlgorithm.SHA256,
          bytes,
        );
        const sha256 = Array.from(new Uint8Array(hash))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        current();
        const reserved = await client.request<{ id: string }>(root, "POST", {
          clientUploadId: attempt.clientMessageId,
          fileName: attempt.name,
          size: attempt.file.size,
          sha256,
        });
        current();
        attempt.reservation = reserved.id;
        owner.setIntent({ ...attempt });
      }
      if (!attempt.uploaded) {
        await client.upload(
          company,
          conversation,
          attempt.reservation,
          attempt.file,
        );
        current();
        attempt.uploaded = true;
        owner.setIntent({ ...attempt });
      }
      if (!attempt.clean) {
        await client.request(
          root + `/${attempt.reservation}/finalize`,
          "POST",
          {},
        );
        current();
        attempt.clean = true;
        owner.setIntent({ ...attempt });
      }
      await client.request(
        `/companies/${company}/conversations/${conversation}/messages`,
        "POST",
        {
          body: attempt.name,
          clientMessageId: attempt.clientMessageId,
          mediaIds: [attempt.reservation],
        },
      );
      current();
      owner.setIntent(null);
      setRetry(false);
      if (attempt.file.exists) attempt.file.delete();
      setFile(null);
      await onSent();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      owner.endIntent();
      if (alive.current) setBusy(false);
    }
  }
  return (
    <View>
      <CaptureControl scope={scope} label="Chat photo" onFile={() => {}} />
      <Button
        title="Choose attachment"
        disabled={disabled || busy || retry || recording}
        onPress={() => void choose().catch((e) => setError(e.message))}
      />
      <Button
        title={recording ? "Stop voice note" : "Record voice note"}
        disabled={disabled || busy || retry}
        onPress={() => void voice().catch((e) => setError(e.message))}
      />
      {file && (
        <View>
          <Text>
            {name} · {file.size} bytes
          </Text>
          {selected?.mime.startsWith("image/") && (
            <Image
              accessibilityLabel="Selected photo preview"
              source={{ uri: file.uri }}
              style={{ width: 200, height: 200 }}
            />
          )}
          <Button title="Play preview" onPress={() => player.play()} />
          <Button title="Pause preview" onPress={() => player.pause()} />
          <Button
            title={retry ? "Retry same media message" : "Send selected media"}
            disabled={disabled || busy}
            onPress={() => void send()}
          />
          <Button
            title="Discard selected file"
            disabled={busy || retry}
            onPress={() => {
              player.pause();
              if (file.exists) file.delete();
              setFile(null);
            }}
          />
        </View>
      )}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
    </View>
  );
}
export default Object.assign(Media, { download, downloadPath });
