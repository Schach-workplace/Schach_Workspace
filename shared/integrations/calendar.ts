/** Minimal deadline events. No descriptions, attendee invitations or external send. */
export interface CalendarDeadline {
  id: string;
  title: string;
  deadlineMode?: string;
  dueDate: string;
  dueAt?: string;
}
const escapeText = (text: string) =>
  text
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
// RFC5545 content lines are <=75 octets; continuation space counts as one.
function fold(line: string) {
  let out = "",
    size = 0;
  for (const char of line) {
    const point = char.codePointAt(0)!;
    const bytes =
      point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (size + bytes > 75) {
      out += "\r\n ";
      size = 1;
    }
    out += char;
    size += bytes;
  }
  return out;
}
function instant(value: string) {
  // Require explicit offset to avoid exporting a device-dependent wall time.
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value))
    throw Error("A valid absolute deadline is required.");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw Error("A valid absolute deadline is required.");
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
function allDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw Error("A valid calendar date is required.");
  const d = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value)
    throw Error("A valid calendar date is required.");
  return d;
}
export function calendarExport(
  companyId: string,
  tasks: readonly CalendarDeadline[],
  generatedAt = new Date(),
) {
  if (!companyId || tasks.length > 10000)
    throw Error("Choose a company and a smaller calendar range.");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Workspace//Authorized deadlines//EN",
    "CALSCALE:GREGORIAN",
  ];
  const stamp = instant(generatedAt.toISOString());
  const seen = new Set<string>();
  for (const t of tasks) {
    if (!t.id || seen.has(t.id))
      throw Error("Each exported commitment must have a distinct identifier.");
    seen.add(t.id);
    const dates: string[] = [];
    if (t.deadlineMode === "timed") {
      if (/\.\d*[1-9]\d*(?:Z|[+-]\d{2}:\d{2})$/.test(t.dueAt ?? ""))
        throw Error(
          "Calendar export cannot preserve fractional-second deadlines.",
        );
      dates.push("DTSTART:" + instant(t.dueAt ?? ""));
    } else {
      const d = allDay(t.dueDate);
      dates.push("DTSTART;VALUE=DATE:" + t.dueDate.replaceAll("-", ""));
      d.setUTCDate(d.getUTCDate() + 1);
      dates.push(
        "DTEND;VALUE=DATE:" + d.toISOString().slice(0, 10).replaceAll("-", ""),
      );
    }
    lines.push(
      "BEGIN:VEVENT",
      "UID:" +
        encodeURIComponent(JSON.stringify([companyId, t.id])) +
        "@workspace.invalid",
      "DTSTAMP:" + stamp,
      ...dates,
      "SUMMARY:" + escapeText(t.title),
      "CLASS:PRIVATE",
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
