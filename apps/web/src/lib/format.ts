/**
 * Formatting helpers.
 *
 * House rules (see docs/DECISIONS.md, ADR-016):
 * - One numeral system everywhere: Western/Latin digits, in Arabic and English.
 *   `ar-EG-u-nu-latn` keeps Arabic month/weekday names but Latin digits, so a
 *   date and a duration never disagree inside the same card.
 * - Every date is stored in UTC and rendered in the user's timezone
 *   (defaults to Africa/Cairo).
 */

export const DEFAULT_TIMEZONE = "Africa/Cairo";

let timezone = DEFAULT_TIMEZONE;

export function setAppTimezone(next: string | null | undefined): void {
  if (next) timezone = next;
}

export function getAppTimezone(): string {
  return timezone;
}

export function numericLocale(lang: string | undefined): string {
  return lang?.startsWith("en") ? "en-GB" : "ar-EG-u-nu-latn";
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatNumber(
  value: number,
  lang: string | undefined,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(numericLocale(lang), options).format(value);
}

/** `$15.50` in both languages — currency symbols stay explicit. */
export function formatUsd(value: number, lang: string | undefined, digits = 2): string {
  return `$${formatNumber(value, lang, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function formatDate(
  value: string | number | Date | null | undefined,
  lang: string | undefined,
  style: "long" | "medium" | "short" = "medium",
): string {
  const date = toDate(value);
  if (!date) return "—";

  const options: Intl.DateTimeFormatOptions =
    style === "long"
      ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
      : style === "short"
        ? { day: "2-digit", month: "2-digit", year: "numeric" }
        : { day: "numeric", month: "short", year: "numeric" };

  return new Intl.DateTimeFormat(numericLocale(lang), { ...options, timeZone: timezone }).format(
    date,
  );
}

export function formatDateTime(
  value: string | number | Date | null | undefined,
  lang: string | undefined,
): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(numericLocale(lang), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(date);
}

export function formatTime(
  value: string | number | Date | null | undefined,
  lang: string | undefined,
): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(numericLocale(lang), {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(date);
}

export function formatMonthYear(
  value: string | number | Date | null | undefined,
  lang: string | undefined,
): string {
  const date = toDate(value) ?? new Date();
  return new Intl.DateTimeFormat(numericLocale(lang), {
    month: "long",
    year: "numeric",
    timeZone: timezone,
  }).format(date);
}

export function formatWeekdayNarrow(
  value: string | number | Date | null | undefined,
  lang: string | undefined,
): string {
  const date = toDate(value) ?? new Date();
  return new Intl.DateTimeFormat(numericLocale(lang), {
    weekday: "narrow",
    timeZone: timezone,
  }).format(date);
}

/** Relative time in words: "قبل ٣ ساعات" / "3 hours ago". */
export function formatRelativeTime(
  value: string | number | Date | null | undefined,
  lang: string | undefined,
): string {
  const date = toDate(value);
  if (!date) return "—";

  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);
  const formatter = new Intl.RelativeTimeFormat(numericLocale(lang), { numeric: "auto" });

  if (abs < 60) return formatter.format(diffSeconds, "second");
  if (abs < 3600) return formatter.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86_400) return formatter.format(Math.round(diffSeconds / 3600), "hour");
  if (abs < 604_800) return formatter.format(Math.round(diffSeconds / 86_400), "day");
  if (abs < 2_419_200) return formatter.format(Math.round(diffSeconds / 604_800), "week");
  if (abs < 31_536_000) return formatter.format(Math.round(diffSeconds / 2_419_200), "month");
  return formatter.format(Math.round(diffSeconds / 31_536_000), "year");
}

/** `01:05` / `1:02:03` — used for audio position and durations. */
export function clockFromSeconds(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) {
    return "—";
  }
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function clockFromMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  return clockFromSeconds(ms / 1000);
}

export function formatPercent(ratio: number, lang: string | undefined, digits = 0): string {
  return new Intl.NumberFormat(numericLocale(lang), {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(ratio);
}

export function truncateMiddle(value: string, max = 34): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
