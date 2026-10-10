import { companyDate, workDeadline, DeadlineChoiceError } from "./workDates";
export function pickerFields(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: companyDate(value, timezone),
    time: get("hour") + ":" + get("minute"),
  };
}
export function pickerInstant(date: string, time: string, timezone: string) {
  try {
    return new Date(workDeadline(date, time || "12:00", timezone).dueAt);
  } catch (e) {
    if (e instanceof DeadlineChoiceError) return new Date(e.candidates[0]);
    throw e;
  }
}
