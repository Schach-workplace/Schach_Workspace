export function companyDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(date + "T00:00:00Z");
  return (
    Number.isFinite(value.getTime()) &&
    value.toISOString().slice(0, 10) === date
  );
}
export function shiftDate(date: string, days: number): string {
  if (!validDate(date)) throw Error("Choose a valid deadline date.");
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export class DeadlineChoiceError extends Error {
  constructor(public candidates: string[]) {
    super("This local time occurs twice. Choose the intended offset.");
  }
}
export function workDeadline(
  date: string,
  time: string,
  timezone: string,
  selectedInstant?: string,
) {
  if (!validDate(date)) throw Error("Choose a valid deadline date.");
  if (!time)
    return {
      dueDate: date,
      deadlineMode: "all_day" as const,
      dueAt: "",
      dueTimezone: "",
    };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw Error("Enter a time as HH:mm, such as 16:00.");
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const anchor = Date.parse(date + "T" + time + ":00Z");
  const candidates: string[] = [];
  for (let offset = -15 * 60; offset <= 15 * 60; offset += 15) {
    const at = new Date(anchor + offset * 60000);
    const parts = fmt.formatToParts(at);
    const get = (type: string) => parts.find((p) => p.type === type)!.value;
    if (
      `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}` ===
      date + "T" + time
    )
      candidates.push(at.toISOString());
  }
  if (!candidates.length)
    throw Error(
      "This local time does not exist in the company timezone. Choose another time.",
    );
  if (selectedInstant && !candidates.includes(selectedInstant))
    throw Error("Select an offset for this deadline.");
  if (candidates.length > 1 && !selectedInstant)
    throw new DeadlineChoiceError(candidates);
  return {
    dueDate: date,
    deadlineMode: "timed" as const,
    dueAt: selectedInstant || candidates[0],
    dueTimezone: timezone,
  };
}
