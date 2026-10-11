export interface CaptureScope {
  serverOrigin: string;
  companyId: string;
  userId: string;
  targetKind: "chat" | "task" | "expense" | "finance_intake";
  targetId: string;
}
export interface PreviewFile {
  uri: string;
  name: string;
  mime: string;
  size: number;
  delete: () => void;
}
export class CaptureOwner {
  state: {
    file: PreviewFile | null;
    phase: "preview" | "uploading" | "recheck";
    error: string;
  } = { file: null, phase: "preview", error: "" };
  private epoch = 0;
  private listeners = new Set<() => void>();
  intent: unknown = null;
  busy = false;
  constructor(public scope: CaptureScope) {}
  setIntent(value: unknown) {
    this.intent = value;
  }
  beginIntent() {
    if (this.busy) return false;
    this.busy = true;
    return true;
  }
  endIntent() {
    this.busy = false;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    this.state = { ...this.state };
    this.listeners.forEach((l) => l());
  }
  select(file: PreviewFile) {
    const limit = (this.scope.targetKind === "chat" ? 25 : 10) * 1024 * 1024;
    if (!file.size || file.size > limit)
      throw Error(`Choose a nonempty file up to ${limit / 1024 / 1024} MiB.`);
    if (
      !(this.scope.targetKind === "chat" && file.mime.startsWith("audio/")) &&
      ![
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/pdf",
        "text/plain",
        "text/csv",
      ].includes(file.mime)
    )
      throw Error(
        "Unsupported image/file. Choose JPEG, PNG, WebP, PDF, text or CSV. HEIC cannot be renamed.",
      );
    if (
      this.scope.targetKind === "finance_intake" &&
      !["image/jpeg", "image/png", "application/pdf", "text/csv"].includes(
        file.mime,
      )
    )
      throw Error(
        "Finance intake requires JPEG, PNG, PDF or CSV actual bytes.",
      );
    this.clear();
    this.state = { file, phase: "preview", error: "" };
    this.publish();
  }
  clear() {
    this.epoch++;
    this.intent = null;
    this.busy = false;
    try {
      this.state.file?.delete();
    } finally {
      this.state = { file: null, phase: "preview", error: "" };
      this.publish();
    }
  }
  async upload(append: (file: PreviewFile) => Promise<void>) {
    if (!this.state.file || this.state.phase !== "preview") return;
    const epoch = this.epoch,
      file = this.state.file;
    this.state = { ...this.state, phase: "uploading", error: "" };
    this.publish();
    try {
      await append(file);
      if (epoch === this.epoch) this.clear();
    } catch (e) {
      if (epoch === this.epoch) {
        this.state = {
          ...this.state,
          phase: "recheck",
          error:
            "Upload confirmation unavailable. Recheck the record before another deliberate append; it may already be present. " +
            (e as Error).message,
        };
        this.publish();
      }
    }
  }
  async recheck(read: () => Promise<void>) {
    if (this.state.phase !== "recheck") return;
    const epoch = this.epoch;
    await read();
    if (epoch === this.epoch) {
      this.state = {
        ...this.state,
        phase: "preview",
        error:
          "Record rechecked. Inspect current evidence before manually uploading again.",
      };
      this.publish();
    }
  }
}
