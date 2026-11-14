/**
 * Time-zone aware helpers shared by server and client (no dependencies; uses Intl).
 * Instants are stored in UTC. "Dates" are calendar days in the organisation time zone, written
 * as YYYY-MM-DD strings so they never shift between zones.
 */

export const DEFAULT_TIMEZONE = "Asia/Kolkata";
const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(at: Date, tz: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(at)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday!] ?? 0,
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** The calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(at: Date, tz: string): string {
  const p = zonedParts(at, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes since local midnight. */
export function localMinutes(at: Date, tz: string): number {
  const p = zonedParts(at, tz);
  return p.hour * 60 + p.minute;
}

export function isDateString(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isTimeString(s: unknown): s is string {
  return typeof s === "string" && TIME_RE.test(s);
}

/** "HH:MM" → minutes since midnight. */
export function timeToMinutes(hhmm: string): number {
  const m = TIME_RE.exec(hhmm);
  if (!m) throw new Error(`Invalid time: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Offset of `tz` from UTC at an instant, in minutes (e.g. +330 for India). */
export function tzOffsetMinutes(at: Date, tz: string): number {
  const p = zonedParts(at, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The UTC instant of a local wall-clock time (handles DST by re-checking the offset). */
export function zonedTimeToUtc(date: string, hhmm: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const mins = timeToMinutes(hhmm);
  const guess = Date.UTC(y, m - 1, d, Math.floor(mins / 60), mins % 60);
  let at = new Date(guess - tzOffsetMinutes(new Date(guess), tz) * 60_000);
  const corrected = new Date(guess - tzOffsetMinutes(at, tz) * 60_000);
  if (corrected.getTime() !== at.getTime()) at = corrected;
  return at;
}

/** Start of a local calendar day as a UTC instant. */
export function startOfLocalDay(date: string, tz: string): Date {
  return zonedTimeToUtc(date, "00:00", tz);
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive number of days from a to b (b >= a). */
export function daysInclusive(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS) + 1;
}

/** Every date from a to b inclusive. */
export function eachDate(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 0 = Sunday … 6 = Saturday, for a calendar date. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start: `${month}-01`, end };
}

/** Total seconds covered by intervals, counting overlaps once. Open intervals end at `now`. */
export function mergedSeconds(intervals: { start: Date; end: Date | null }[], now: Date = new Date()): number {
  const spans = intervals
    .map((i) => [i.start.getTime(), (i.end ?? now).getTime()] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const [s, e] of spans) {
    if (s > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return Math.floor(total / 1000);
}

/** "7h 05m", "45m", "0m". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const total = Math.max(0, Math.floor(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m`;
}

/** "09:42" in the given time zone (24-hour). */
export function formatClock(at: Date | string | null | undefined, tz: string): string {
  if (!at) return "—";
  const p = zonedParts(typeof at === "string" ? new Date(at) : at, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "Fri, 14 Nov 2026" for a calendar date. */
export function formatLongDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "just now", "5 min ago", "3 h ago", "yesterday", or a date. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  if (h < 48) return "yesterday";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
