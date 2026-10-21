// Every date/time the app shows or groups by is the shop's local time in Bangkok, never the
// server's clock: Vercel runs in UTC, so formatting without an explicit timeZone shows bills 7
// hours early. Kept free of "@/" imports and "server-only" so `node --test` can load it directly.

export const BANGKOK_TZ = "Asia/Bangkok";

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateString(utcMs: number): string {
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Midnight of a YYYY-MM-DD date, as a UTC timestamp of that calendar date (no zone shift). */
function dateToUtcMidnight(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Today's date in Bangkok as YYYY-MM-DD. */
export function bangkokToday(now: Date = new Date()): string {
  return toDateString(now.getTime() + BANGKOK_OFFSET_MS);
}

export function isValidDateString(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return toDateString(ms) === s;
}

export function shiftDate(date: string, days: number): string {
  return toDateString(dateToUtcMidnight(date) + days * DAY_MS);
}

/** The Bangkok calendar day as a UTC [start, end) range for .gte()/.lt() queries. */
export function bangkokDayRange(date: string): { start: string; end: string } {
  const start = dateToUtcMidnight(date) - BANGKOK_OFFSET_MS;
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + DAY_MS).toISOString(),
  };
}

const MONTH_RE = /^(\d{4})-(\d{2})$/;

/** The Bangkok calendar month (YYYY-MM) as a UTC [start, end) range, or null if malformed. */
export function bangkokMonthRange(month: string): { start: string; end: string } | null {
  const m = MONTH_RE.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return {
    start: new Date(Date.UTC(year, monthIndex, 1) - BANGKOK_OFFSET_MS).toISOString(),
    end: new Date(Date.UTC(year, monthIndex + 1, 1) - BANGKOK_OFFSET_MS).toISOString(),
  };
}

/** YYYY-MM of an instant in Bangkok. */
export function bangkokMonth(iso: string): string {
  return toDateString(new Date(iso).getTime() + BANGKOK_OFFSET_MS).slice(0, 7);
}

const timeFormat = new Intl.DateTimeFormat("th-TH", {
  timeZone: BANGKOK_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFormats = {
  medium: new Intl.DateTimeFormat("th-TH", { timeZone: BANGKOK_TZ, dateStyle: "medium" }),
  long: new Intl.DateTimeFormat("th-TH", { timeZone: BANGKOK_TZ, dateStyle: "long" }),
  full: new Intl.DateTimeFormat("th-TH", {
    timeZone: BANGKOK_TZ,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }),
};

const dateTimeFormats = {
  medium: new Intl.DateTimeFormat("th-TH", {
    timeZone: BANGKOK_TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }),
  long: new Intl.DateTimeFormat("th-TH", {
    timeZone: BANGKOK_TZ,
    dateStyle: "long",
    timeStyle: "short",
  }),
};

const weekdayFormat = new Intl.DateTimeFormat("th-TH", {
  timeZone: BANGKOK_TZ,
  weekday: "short",
});

/** HH:MM (24h) in Bangkok. */
export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

export function formatDate(iso: string, style: "medium" | "long" | "full" = "medium"): string {
  return dateFormats[style].format(new Date(iso));
}

export function formatDateTime(iso: string, style: "medium" | "long" = "medium"): string {
  return dateTimeFormats[style].format(new Date(iso));
}

/** e.g. "วันนี้ · อ. 20 ต.ค. 2569", "เมื่อวาน · จ. 19 ต.ค. 2569", "พฤ. 15 ต.ค. 2569". */
export function formatDayLabel(date: string, today: string): string {
  // Noon Bangkok keeps the formatted calendar date stable whatever the zone math.
  const noon = new Date(dateToUtcMidnight(date) - BANGKOK_OFFSET_MS + DAY_MS / 2);
  const label = `${weekdayFormat.format(noon)} ${dateFormats.medium.format(noon)}`;
  if (date === today) return `วันนี้ · ${label}`;
  if (date === shiftDate(today, -1)) return `เมื่อวาน · ${label}`;
  return label;
}
