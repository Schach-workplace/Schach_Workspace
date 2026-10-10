import * as Files from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { randomUUID } from "expo-crypto";
import { client } from "./client";
import type { ExportJob, ReportArtifact } from "../../shared/reports/types";
const root = () => {
  if (!Files.cacheDirectory)
    throw Error("Private temporary storage is unavailable.");
  return Files.cacheDirectory + "report-private-v1/";
};
export async function cleanupReportTemps() {
  await Files.deleteAsync(root(), { idempotent: true });
}
let initialized: Promise<void> | undefined;
export function initializeReportTemps() {
  return (initialized ??= cleanupReportTemps()
    .then(() => Files.makeDirectoryAsync(root(), { intermediates: true }))
    .catch((e) => {
      initialized = undefined;
      throw e;
    }));
}
export class ReportTransfer {
  private task: ReturnType<typeof Files.createDownloadResumable> | undefined;
  private uri = "";
  private serial = 0;
  async cancel() {
    this.serial++;
    await this.task?.cancelAsync().catch(() => {});
    if (this.uri) await Files.deleteAsync(this.uri, { idempotent: true });
  }
  async share(company: string, jobId: string, current: () => boolean) {
    const serial = ++this.serial;
    const generation = client.generation;
    const endpoint = client.endpoint;
    const valid = () =>
      serial === this.serial &&
      generation === client.generation &&
      endpoint === client.endpoint &&
      current();
    const check = () => {
      if (!valid())
        throw Error("Report access changed. Recheck before sharing.");
    };
    let unregister = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    try {
      check();
      await initializeReportTemps();
      check();
      const path = `/companies/${encodeURIComponent(company)}/reports/exports/${encodeURIComponent(jobId)}`;
      const ready = await client.request<{
        job: ExportJob;
        artifact: ReportArtifact | null;
      }>(path);
      check();
      const artifact = ready.artifact;
      if (
        ready.job.state !== "ready" ||
        !artifact ||
        artifact.length > 16 * 1024 * 1024 ||
        Date.parse(artifact.expiresAt) <= Date.now()
      )
        throw Error("Export unavailable or expired.");
      this.uri = root() + randomUUID() + ".csv";
      this.task = Files.createDownloadResumable(
        endpoint +
          "/api/companies/" +
          encodeURIComponent(company) +
          "/reports/artifacts/" +
          encodeURIComponent(artifact.id),
        this.uri,
        {
          headers: {
            Authorization: "Bearer " + client.token,
            Accept: "text/csv",
          },
          sessionType: Files.FileSystemSessionType.FOREGROUND,
        },
        (progress) => {
          if (progress.totalBytesWritten > 16 * 1024 * 1024) void this.cancel();
        },
      );
      unregister = client.registerCancellation(() => {
        void this.cancel();
      });
      timer = setTimeout(() => {
        void this.cancel();
      }, 120000);
      expiry = setTimeout(
        () => {
          void this.cancel();
        },
        Math.min(120000, Date.parse(artifact.expiresAt) - Date.now()),
      );
      const result = await this.task.downloadAsync();
      check();
      if (!result || result.status !== 200)
        throw Error("Report download unavailable.");
      const info = await Files.getInfoAsync(this.uri);
      check();
      if (!info.exists || info.isDirectory || info.size !== artifact.length)
        throw Error("The report download was incomplete.");
      const final = await client.request<{
        job: ExportJob;
        artifact: ReportArtifact | null;
      }>(path);
      check();
      if (
        final.job.state !== "ready" ||
        final.artifact?.id !== artifact.id ||
        Date.parse(final.artifact.expiresAt) <= Date.now()
      )
        throw Error("Report access changed or export expired.");
      if (!(await Sharing.isAvailableAsync()))
        throw Error("Sharing is unavailable on this device.");
      check();
      await Sharing.shareAsync(this.uri, {
        mimeType: "text/csv",
        UTI: "public.comma-separated-values-text",
        dialogTitle: "Share historical report copy",
      });
    } finally {
      unregister();
      clearTimeout(timer);
      clearTimeout(expiry);
      await this.cancel();
      this.task = undefined;
      this.uri = "";
    }
  }
}
