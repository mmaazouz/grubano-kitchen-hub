// ── Availability — pure constants + helpers (P4, Agent 77) ────────────────────
// SIMPLE DECLARATIVE availability for a prestataire: declared working weekdays + a free-text
// note + leave periods. NO bookable slots / NO appointment booking / NO conflict detection
// (a future maybe, per Mohammed). PURE (no I/O) → unit-tested. SHARED by the availability
// route, the calendar page, the public fiche and the tests, so the rules are single-sourced.
// 100% OFF the money path.

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type Weekday = (typeof WEEKDAYS)[number]

export function isWeekday(v: string): v is Weekday {
  return (WEEKDAYS as readonly string[]).includes(v)
}

/** Normalize a Json column / arbitrary input to a CANONICAL, de-duplicated, ordered weekday[].
 *  Non-strings and unknown values are dropped; the result follows WEEKDAYS order. */
export function normalizeWeekdays(v: unknown): Weekday[] {
  const arr = Array.isArray(v) ? v : []
  const set = new Set(arr.filter((x): x is string => typeof x === 'string').filter(isWeekday))
  return WEEKDAYS.filter((d) => set.has(d))
}

/** True iff [start, end] is a valid declared period (both real dates, end on/after start). PURE. */
export function isValidPeriod(start: Date, end: Date): boolean {
  return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end.getTime() >= start.getTime()
}
