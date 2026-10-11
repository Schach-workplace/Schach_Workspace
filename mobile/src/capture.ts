import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { client } from "./client";
import {
  CaptureOwner,
  type CaptureScope,
  type PreviewFile,
} from "./captureOwner";
export type { CaptureScope, PreviewFile } from "./captureOwner";
const owners = new Map<string, CaptureOwner>();
let epoch = 0;
let context = { serverOrigin: "", companyId: "", userId: "", ready: false };
let pendingCamera: CaptureScope | null = null;
let pendingChooser = false;
let recoverableCamera: { scope: CaptureScope; generation: number } | null =
  null;
const waits = new Set<() => void>();
export function setCaptureContext(next: typeof context) {
  context = next;
  waits.forEach((fn) => fn());
}
export function clearCaptures() {
  epoch++;
  pendingCamera = null;
  recoverableCamera = null;
  for (const owner of owners.values()) owner.clear();
  owners.clear();
  waits.forEach((fn) => fn());
}
export function captureOwner(scope: CaptureScope) {
  const key = JSON.stringify(scope);
  let owner = owners.get(key);
  if (!owner) {
    owner = new CaptureOwner(scope);
    owners.set(key, owner);
  }
  return owner;
}
const same = (s: CaptureScope) =>
  context.serverOrigin === s.serverOrigin &&
  context.companyId === s.companyId &&
  context.userId === s.userId;
async function ready(scope: CaptureScope) {
  if (!same(scope))
    throw Error("Capture destination changed. Choose the destination again.");
  if (context.ready) return;
  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (!same(scope)) {
        waits.delete(check);
        reject(Error("Capture destination changed."));
      } else if (context.ready) {
        waits.delete(check);
        resolve();
      }
    };
    waits.add(check);
    check();
  });
}
export async function authorizeCapture(scope: CaptureScope) {
  await ready(scope);
  if (client.endpoint !== scope.serverOrigin) throw Error("Server changed.");
  const path = `/companies/${scope.companyId}/${scope.targetKind === "chat" ? "conversations" : scope.targetKind === "task" ? "tasks" : scope.targetKind === "finance_intake" ? "finance/intakes" : "expenses"}/${scope.targetId}`;
  const source = await client.request<{ state?: string; purpose?: string }>(
    path,
  );
  if (!same(scope) || !context.ready) throw Error("Company access changed.");
  return source;
}
async function adopt(
  scope: CaptureScope,
  asset: {
    uri: string;
    fileName?: string | null;
    mimeType?: string;
    name?: string;
  },
  generation: number,
  cameraReservation = false,
): Promise<PreviewFile> {
  const name =
    asset.fileName ??
    asset.name ??
    (asset.uri.toLowerCase().endsWith(".png") ? "Photo.png" : "Photo.jpg");
  const ext = name.toLowerCase().split(".").at(-1);
  const mime =
    asset.mimeType ??
    {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      pdf: "application/pdf",
      txt: "text/plain",
      csv: "text/csv",
    }[ext ?? ""] ??
    "application/octet-stream";
  const file = new File(
    Paths.cache,
    "schach-capture-" + Crypto.randomUUID() + "." + ext,
  );
  try {
    new File(asset.uri).copy(file);
    const preview = {
      uri: file.uri,
      name,
      mime,
      size: file.size,
      delete: () => {
        if (file.exists) file.delete();
      },
    };
    if (generation !== epoch) throw Error("Capture access changed.");
    const source = await authorizeCapture(scope);
    if (
      cameraReservation &&
      scope.targetKind === "finance_intake" &&
      source.state !== "capture_reserved"
    )
      throw Error("Capture reservation changed before camera return.");
    if (generation !== epoch) throw Error("Capture access changed.");
    const owner = captureOwner(scope);
    owner.select(preview);
    return preview;
  } catch (e) {
    if (file.exists) file.delete();
    throw e;
  }
}
export async function captureImage(scope: CaptureScope) {
  if (pendingCamera || pendingChooser)
    throw Error("Finish the current camera capture first.");
  const generation = epoch;
  pendingCamera = scope;
  try {
    const source = await authorizeCapture(scope);
    if (
      scope.targetKind === "finance_intake" &&
      (source.purpose !== "receipt" || source.state !== "capture_reserved")
    )
      throw Error(
        "This canonical reservation is already bound. Open its existing intake flow.",
      );
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted)
      throw Error(
        permission.canAskAgain
          ? "Camera permission denied. Choose attachment or allow camera in system settings."
          : "Camera disabled in system settings. Choose attachment or enable Camera there.",
      );
    recoverableCamera = { scope, generation };
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.9,
      allowsEditing: false,
    });
    recoverableCamera = null;
    if (result.canceled) return null;
    return await adopt(scope, result.assets[0], generation, true);
  } finally {
    pendingCamera = null;
  }
}
export async function chooseCapture(scope: CaptureScope) {
  if (pendingCamera || pendingChooser)
    throw Error("Finish the current camera or file selection first.");
  pendingChooser = true;
  try {
    const generation = epoch;
    await authorizeCapture(scope);
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/pdf",
        "text/plain",
        "text/csv",
      ],
    });
    if (result.canceled) return null;
    return await adopt(scope, result.assets[0], generation);
  } finally {
    pendingChooser = false;
  }
}
export async function recoverCamera() {
  const result = await ImagePicker.getPendingResultAsync();
  if (!result || "code" in result || result.canceled) return;
  const pending = recoverableCamera;
  recoverableCamera = null;
  if (!pending)
    throw Error(
      "Camera returned without its original destination. Choose the destination and capture again.",
    );
  return adopt(pending.scope, result.assets[0], pending.generation, true);
}
export async function appendCapture(scope: CaptureScope, file: PreviewFile) {
  if (scope.targetKind === "finance_intake")
    throw Error("Stage finance intake through its exact content binding flow.");
  await authorizeCapture(scope);
  await client.appendFile(
    `/companies/${scope.companyId}/${scope.targetKind === "task" ? "tasks" : "expenses"}/${scope.targetId}/${scope.targetKind === "task" ? "attachments" : "receipts"}`,
    new File(file.uri),
    file.name,
  );
}

// File import is picked before exact reserve. It stays owned, ephemeral and
// undisclosed until the server creates the real authorized content-bound ID.
export async function chooseFinanceFile(
  origin: string,
  companyId: string,
  userId: string,
  purpose: "receipt" | "statement",
) {
  if (pendingCamera || pendingChooser)
    throw Error("Finish the current camera capture first.");
  const generation = epoch,
    clientGeneration = client.generation;
  const current = () =>
    context.serverOrigin === origin &&
    context.companyId === companyId &&
    context.userId === userId &&
    context.ready &&
    generation === epoch &&
    clientGeneration === client.generation;
  if (!current()) throw Error("Check current company access first.");
  pendingChooser = true;
  try {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type:
        purpose === "statement"
          ? ["text/csv", "text/comma-separated-values", "application/csv"]
          : ["image/jpeg", "image/png", "application/pdf"],
    });
    if (result.canceled) return null;
    const asset = result.assets[0],
      name = asset.name;
    const file = new File(
      Paths.cache,
      "schach-capture-" + Crypto.randomUUID() + "." + name.split(".").at(-1),
    );
    try {
      new File(asset.uri).copy(file);
      if (!current())
        throw Error("Company access changed while choosing the file.");
      if (
        file.size < 1 ||
        file.size > (purpose === "statement" ? 8 : 10) * 1048576
      )
        throw Error("Choose a nonempty bounded file.");
      return {
        uri: file.uri,
        name,
        mime:
          purpose === "statement"
            ? "text/csv"
            : (asset.mimeType ?? "application/octet-stream"),
        size: file.size,
        delete: () => {
          if (file.exists) file.delete();
        },
      } as PreviewFile;
    } catch (e) {
      if (file.exists) file.delete();
      throw e;
    }
  } finally {
    pendingChooser = false;
  }
}
