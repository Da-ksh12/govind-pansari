// Dates an admin types (no date-picker library is installed): "25-12-2026", "25/12/2026", "25.12.2026" or "2026-12-25", always read as INDIA time
// (IST, UTC+5:30, no daylight saving). A start date means the start of that day, an end date means the end of that day, so "ends 30-11-2026" is
// live all through the 30th. Pure, so tests/unit covers it.

const IST_OFFSET_MINUTES = 330;
const DAY_MS = 86_400_000;

/** Parses a typed date into an ISO instant (UTC), or null when it is not a real calendar date between 2000 and 2100. */
export function parseDateInput(text: string, edge: 'start' | 'end'): string | null {
  const t = text.trim();
  let day: number;
  let month: number;
  let year: number;
  let m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) {
    day = Number(m[1]);
    month = Number(m[2]);
    year = Number(m[3]);
  } else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) {
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
  } else {
    return null;
  }
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  const [h, min, s] = edge === 'start' ? [0, 0, 0] : [23, 59, 59];
  const utc = Date.UTC(year, month - 1, day, h, min, s) - IST_OFFSET_MINUTES * 60_000;
  return new Date(utc).toISOString();
}

const istParts = (iso: string) => {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + IST_OFFSET_MINUTES * 60_000);
  return { day: d.getUTCDate(), month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
};

const pad = (n: number) => String(n).padStart(2, '0');

/** An ISO instant as the date an admin would type, in India time: "25-12-2026". Empty string for null / invalid. */
export function formatDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const p = istParts(iso);
  return p ? `${pad(p.day)}-${pad(p.month)}-${p.year}` : '';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "5 Nov 2026" in India time. */
export function formatDateLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const p = istParts(iso);
  return p ? `${p.day} ${MONTHS[p.month - 1]} ${p.year}` : '';
}

/** The date `days` days after `nowMs`, as typed text ("30-11-2026") — for "+30 days" shortcut chips. */
export function dateInputAfterDays(nowMs: number, days: number): string {
  return formatDateInput(new Date(nowMs + days * DAY_MS).toISOString());
}

export type WindowState = 'hidden' | 'scheduled' | 'live' | 'ended';

/** What customers get to see right now: hidden by the switch, waiting for its start, live, or past its end. */
export function describeWindow(startIso: string | null, endIso: string | null, isActive: boolean, nowMs: number): { state: WindowState; label: string } {
  if (!isActive) return { state: 'hidden', label: 'Hidden' };
  const start = startIso ? new Date(startIso).getTime() : Number.NEGATIVE_INFINITY;
  const end = endIso ? new Date(endIso).getTime() : Number.POSITIVE_INFINITY;
  if (start > nowMs) return { state: 'scheduled', label: `Starts ${formatDateLabel(startIso)}` };
  if (end < nowMs) return { state: 'ended', label: `Ended ${formatDateLabel(endIso)}` };
  return { state: 'live', label: endIso ? `Live · ends ${formatDateLabel(endIso)}` : 'Live' };
}
