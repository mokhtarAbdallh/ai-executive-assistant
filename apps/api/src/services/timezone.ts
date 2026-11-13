/** Time-zone helpers without a date library (AGENTS.md: store UTC, show user time). */

export const DEFAULT_TIMEZONE = "Africa/Cairo";

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Offset of `timeZone` from UTC at `instant`, in ms (Cairo summer → +3h). */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Converts a wall-clock date/time in `timeZone` ("2026-11-20", "14:30") to the
 * UTC instant. Returns null for an invalid date or time.
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const naive = new Date(`${date}T${time}:00Z`);
  if (Number.isNaN(naive.getTime())) return null;
  // Two passes handle a DST change between the naive guess and the real instant.
  let utc = new Date(naive.getTime() - offsetMs(naive, timeZone));
  const second = offsetMs(utc, timeZone);
  utc = new Date(naive.getTime() - second);
  return utc;
}

/** "الخميس، 20 نوفمبر 2026، 2:30 م" in the user's zone and language. */
export function formatInZone(instant: Date, timeZone: string, language: "ar" | "en"): string {
  return new Intl.DateTimeFormat(language === "ar" ? "ar-EG" : "en-GB", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

/** Local calendar date "YYYY-MM-DD" and time "HH:mm" of `instant` in `timeZone`. */
export function localDateTime(instant: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}
