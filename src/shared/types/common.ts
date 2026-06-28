// Primitive shared types used across main, preload and renderer.

export type Id = string

/** ISO-8601 timestamp string, e.g. "2026-05-29T08:00:00.000Z". */
export type ISODate = string

export interface Timestamped {
  createdAt: ISODate
  updatedAt: ISODate
}

/** Works in both the Electron main process (Node) and the renderer (browser). */
export function newId(prefix = ''): Id {
  const uuid = globalThis.crypto?.randomUUID?.()
  const core = uuid ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
  return prefix ? `${prefix}_${core}` : core
}

export function nowISO(): ISODate {
  return new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Daily-task "date or custom title" helpers. A daily-task card's title field holds EITHER a
// UTC-midnight ISO date (shown as "YYYY.MM.DD") OR an arbitrary custom string. Shared because the
// main-process rollover stamps the next day's date too. A date is recognised ONLY in the exact
// shape DoodleCalendar emits (Date.UTC(...).toISOString()), so a custom title can never be
// mistaken for a date.
// ---------------------------------------------------------------------------

const DAILY_DATE_RE = /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/

/** True when `v` is a UTC-midnight ISO date string (a picked day), not a custom title. */
export function isDailyDate(v: unknown): v is ISODate {
  return typeof v === 'string' && DAILY_DATE_RE.test(v)
}

/** 'YYYY-MM-DD' for a date value (used as a calendar day key), else null for a custom title. */
export function dailyDayKey(v: unknown): string | null {
  return isDailyDate(v) ? v.slice(0, 10) : null
}

/** Display a date value as "YYYY.MM.DD"; a custom title is returned unchanged. */
export function formatDailyDate(v: unknown): string {
  if (isDailyDate(v)) return v.slice(0, 10).replace(/-/g, '.')
  return typeof v === 'string' ? v : ''
}

/** Today as a UTC-midnight ISO, derived from the LOCAL calendar day (matches DoodleCalendar). */
export function todayUTCMidnightISO(): ISODate {
  const n = new Date()
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())).toISOString()
}

/** Add `n` whole days to a UTC-midnight ISO date, staying at UTC midnight. */
export function addDaysUTCISO(iso: ISODate, n: number): ISODate {
  const d = new Date(iso)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n)).toISOString()
}
