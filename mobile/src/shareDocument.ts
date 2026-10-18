import * as Sharing from "expo-sharing";
import { Directory, File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
export async function shareDocument(
  name: string,
  text: string,
  current: () => boolean,
  options: { mimeType: string; UTI: string; dialogTitle: string } = {
    mimeType: "text/calendar",
    UTI: "com.apple.ical.ics",
    dialogTitle: "Share authorized deadlines",
  },
) {
  if (!(await Sharing.isAvailableAsync()))
    throw Error("Sharing is unavailable on this device.");
  if (!current())
    throw Error("Company access changed. Review the current export again.");
  const directory = new Directory(
    Paths.cache,
    "calendar-export-" + randomUUID(),
  );
  try {
    directory.create();
    const file = new File(directory, name);
    file.create();
    file.write(text);
    await Sharing.shareAsync(file.uri, options);
  } finally {
    try {
      if (directory.exists) directory.delete();
    } catch {
      /* OS-reclaimable private cache, never mask original result. */
    }
  }
}
