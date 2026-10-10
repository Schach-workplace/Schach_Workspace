import { useState, useSyncExternalStore } from "react";
import { Alert, Image, Text, View } from "react-native";
import { Action, ui } from "./ConnectUI";
import {
  captureOwner,
  captureImage,
  chooseCapture,
  authorizeCapture,
  appendCapture,
  type CaptureScope,
  type PreviewFile,
} from "./capture";
export default function CaptureControl({
  scope,
  label,
  onUploaded,
  onFile,
}: {
  scope: CaptureScope;
  label: string;
  onUploaded?: () => Promise<void>;
  onFile?: (file: PreviewFile) => void;
}) {
  const owner = captureOwner(scope);
  const state = useSyncExternalStore(owner.subscribe, () => owner.state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function select(camera: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const file = await (camera ? captureImage(scope) : chooseCapture(scope));
      if (file && onFile) {
        onFile(file);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (busy || state.phase !== "preview") return;
    setBusy(true);
    try {
      await authorizeCapture(scope);
      await owner.upload((file) => appendCapture(scope, file));
      if (!owner.state.file) await onUploaded?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View>
      <Text style={ui.name}>{label}</Text>
      <View style={ui.row}>
        <Action
          title="Take photo"
          disabled={busy || !!state.file}
          onPress={() => void select(true)}
        />
        <Action
          title="Choose attachment"
          disabled={busy || !!state.file}
          onPress={() => void select(false)}
        />
      </View>
      {state.file && !onFile && (
        <View>
          {state.file.mime.startsWith("image/") && (
            <Image
              accessibilityLabel={"Preview for " + label}
              source={{ uri: state.file.uri }}
              style={{ width: 200, height: 180 }}
            />
          )}
          <Text>
            {state.file.name} · {state.file.size} bytes · {label}
          </Text>
          <Action
            primary
            title={
              state.phase === "uploading" ? "Uploading…" : "Upload to " + label
            }
            disabled={busy || state.phase !== "preview"}
            onPress={() => void upload()}
          />
          {state.phase === "recheck" && (
            <Action
              title="Recheck record"
              disabled={busy}
              onPress={() => {
                setBusy(true);
                void authorizeCapture(scope)
                  .then(() => onUploaded?.())
                  .then(() => owner.recheck(async () => {}))
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            />
          )}
          <Action
            title="Discard selected file"
            disabled={busy || state.phase === "uploading"}
            onPress={() =>
              Alert.alert(
                "Discard selected file?",
                "The owned preview will be removed.",
                [
                  { text: "Keep", style: "cancel" },
                  {
                    text: "Discard",
                    style: "destructive",
                    onPress: () => owner.clear(),
                  },
                ],
              )
            }
          />
        </View>
      )}
      {!!(error || state.error) && (
        <Text accessibilityRole="alert" style={ui.error}>
          {error || state.error}
        </Text>
      )}
    </View>
  );
}
