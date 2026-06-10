// Central opening-hours engine (Chantier horaires étape 1). EVERY consumer of the
// hours (availability, public reservation, owner reservation warning, order gate,
// public restaurant card) goes through here, so the rules live in ONE place.
//
// KEY RULE (T1.Q3): an establishment with ZERO OpeningHour rows is NOT CONFIGURED
// → every check passes (exact current behaviour, no badge, nothing blocked). Once
// configured, the hours rule.
//
// All computations are in the ESTABLISHMENT's local time — Europe/Paris (France
// first) — resolved explicitly via Intl, so they stay correct whatever timezone
// the server process runs in (o2switch prod is Paris; CI builders are UTC).
//
// Weekly ranges: one row per range, dayOfWeek 0(=dimanche)…6, "HH:mm". A range
// whose closeTime < openTime ends the NEXT day (19:00→01:00); "24:00" closes a
// full 00:00-24:00 day. Closure exceptions subtract from the weekly ranges:
// whole covered days, or only [startTime, endTime) on each covered day (partial).

import { prisma } from '@/lib/prisma'

export const HOURS_TZ = 'Europe/Paris'

export type HourRow = { dayOfWeek: number; openTime: string; closeTime: string }
export type ClosureRow = {
  id: string
  type: string
  dateStart: Date
  dateEnd: Date
  startTime: string | null
  endTime: string | null
  reason: string | null
}

export type HoursContext = {
  configured: boolean
  hours: HourRow[]
  closures: ClosureRow[]
}

export type SlotVerdict =
  | { ok: true }
  | { ok: false; code: 'closed' | 'closure' | 'too_late'; closure?: ClosureRow }

// ── Local-time helpers (Europe/Paris via Intl — server-TZ independent) ─────────

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: HOURS_TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  weekday: 'short',
})

/** Local (Europe/Paris) parts of an instant: 'YYYY-MM-DD', minutes since local
 *  midnight, and the local 0-6 weekday (JS getDay convention). */
export function localParts(d: Date): { dateStr: string; minutes: number; dayOfWeek: number } {
  const p: Record<string, string> = {}
  for (const part of partsFmt.formatToParts(d)) p[part.type] = part.value
  return {
    dateStr:   `${p.year}-${p.month}-${p.day}`,
    minutes:   parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10),
    dayOfWeek: WEEKDAYS[p.weekday] ?? 0,
  }
}

export const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(n => parseInt(n, 10))
  return h * 60 + m
}
const pad = (n: number) => String(n).padStart(2, '0')
export const toHHMM = (minutes: number): string => `${pad(Math.floor((minutes % 1440) / 60))}:${pad(minutes % 60)}`

/** "HH:mm" validation. allow24: accept "24:00" (close of a 00:00-24:00 day). */
export function isValidTime(t: string, allow24 = false): boolean {
  if (allow24 && t === '24:00') return true
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t)
}

const dayNum = (dateStr: string): number => Date.parse(`${dateStr}T00:00:00Z`) / 86_400_000
const addDays = (dateStr: string, n: number): string =>
  new Date((dayNum(dateStr) + n) * 86_400_000).toISOString().slice(0, 10)
/** Date-only string of a stored UTC-midnight DateTime (ClosureException dates). */
export const dateOnly = (d: Date): string => d.toISOString().slice(0, 10)

/** UTC instant whose Europe/Paris local time is `dateStr` at `minutes`. Iterative
 *  offset correction (2 passes absorb any DST boundary). */
export function zonedDate(dateStr: string, minutes: number): Date {
  let guess = new Date(Date.parse(`${dateStr}T00:00:00Z`) + minutes * 60_000)
  for (let i = 0; i < 2; i++) {
    const p = localParts(guess)
    const diff = (dayNum(p.dateStr) - dayNum(dateStr)) * 1440 + p.minutes - minutes
    if (diff === 0) break
    guess = new Date(guess.getTime() - diff * 60_000)
  }
  return guess
}

// ── Context loading ─────────────────────────────────────────────────────────────

/** One round-trip for everything the checks need. Only 'closed'-type exceptions
 *  are enforced ('special_hours' is reserved, future). */
export async function loadHoursContext(restaurantId: string): Promise<HoursContext> {
  const [hours, closures] = await Promise.all([
    prisma.openingHour.findMany({
      where:   { restaurantId },
      select:  { dayOfWeek: true, openTime: true, closeTime: true },
      orderBy: [{ dayOfWeek: 'asc' }, { openTime: 'asc' }],
    }),
    prisma.closureException.findMany({
      where:  { restaurantId, type: 'closed' },
      select: { id: true, type: true, dateStart: true, dateEnd: true, startTime: true, endTime: true, reason: true },
      orderBy: { dateStart: 'asc' },
    }),
  ])
  return { configured: hours.length > 0, hours, closures }
}

export async function isConfigured(restaurantId: string): Promise<boolean> {
  return (await prisma.openingHour.count({ where: { restaurantId } })) > 0
}

// ── Core checks (pure, context-based — no DB) ───────────────────────────────────

/** The weekly range containing local `minutes` on `dayOfWeek`, if any. closeAbs is
 *  the close expressed in minutes from THAT DAY's midnight (may exceed 1440 for an
 *  overnight range; for the after-midnight spill of the PREVIOUS day's range it is
 *  the small "this morning" value). */
function windowAt(ctx: HoursContext, dayOfWeek: number, minutes: number): { closeAbs: number } | null {
  for (const h of ctx.hours) {
    if (h.dayOfWeek !== dayOfWeek) continue
    const open = toMin(h.openTime), close = toMin(h.closeTime)
    if (close > open) {
      if (minutes >= open && minutes < close) return { closeAbs: close }
    } else if (close < open) {
      // Overnight range: tonight's part.
      if (minutes >= open) return { closeAbs: close + 1440 }
    }
  }
  // After-midnight spill of an overnight range that STARTED yesterday.
  const prev = (dayOfWeek + 6) % 7
  for (const h of ctx.hours) {
    if (h.dayOfWeek !== prev) continue
    const open = toMin(h.openTime), close = toMin(h.closeTime)
    if (close < open && minutes < close) return { closeAbs: close }
  }
  return null
}

function closureBlocksAt(c: ClosureRow, dateStr: string, minutes: number): boolean {
  if (dateOnly(c.dateStart) > dateStr || dateStr > dateOnly(c.dateEnd)) return false
  if (c.startTime && c.endTime) return minutes >= toMin(c.startTime) && minutes < toMin(c.endTime)
  return true // whole-day closure
}

/** Is the establishment open at this instant? Not configured → always true. */
export function isOpenAtCtx(ctx: HoursContext, d: Date): boolean {
  if (!ctx.configured) return true
  const { dateStr, minutes, dayOfWeek } = localParts(d)
  if (!windowAt(ctx, dayOfWeek, minutes)) return false
  return !ctx.closures.some(c => closureBlocksAt(c, dateStr, minutes))
}

export async function isOpenAt(restaurantId: string, d: Date): Promise<boolean> {
  return isOpenAtCtx(await loadHoursContext(restaurantId), d)
}

/** Reservation-slot rule (T3.Q2): the start must fall INSIDE an open range, not be
 *  blocked by an exception, and start ≤ close − duration (the guest eats entirely
 *  within the hours). Not configured → always ok. */
export function slotFitsCtx(ctx: HoursContext, start: Date, durationMin: number): SlotVerdict {
  if (!ctx.configured) return { ok: true }
  const { dateStr, minutes, dayOfWeek } = localParts(start)
  const w = windowAt(ctx, dayOfWeek, minutes)
  if (!w) return { ok: false, code: 'closed' }
  const blocking = ctx.closures.find(c => closureBlocksAt(c, dateStr, minutes))
  if (blocking) return { ok: false, code: 'closure', closure: blocking }
  if (minutes + durationMin > w.closeAbs) return { ok: false, code: 'too_late' }
  return { ok: true }
}

/** The closure blocking this instant (for the consumer "Fermé — {reason}" card). */
export function currentClosureCtx(ctx: HoursContext, d: Date): ClosureRow | null {
  const { dateStr, minutes } = localParts(d)
  return ctx.closures.find(c => closureBlocksAt(c, dateStr, minutes)) ?? null
}

// ── Next opening ────────────────────────────────────────────────────────────────

export type NextOpening = { date: Date; dateStr: string; time: string }

/** First instant ≥ from where the establishment is open, scanning up to 60 days.
 *  Candidates per local day = each weekly range start + each partial-closure end
 *  (an exception ending mid-day re-opens the range it cut). null when not
 *  configured or nothing opens within the horizon. */
export function nextOpeningCtx(ctx: HoursContext, from: Date): NextOpening | null {
  if (!ctx.configured) return null
  if (isOpenAtCtx(ctx, from)) return { date: from, dateStr: localParts(from).dateStr, time: toHHMM(localParts(from).minutes) }

  const fromParts = localParts(from)
  for (let offset = 0; offset <= 60; offset++) {
    const dateStr = addDays(fromParts.dateStr, offset)
    const dayOfWeek = (fromParts.dayOfWeek + offset) % 7
    const candidates = new Set<number>()
    for (const h of ctx.hours) if (h.dayOfWeek === dayOfWeek) candidates.add(toMin(h.openTime))
    for (const c of ctx.closures) {
      if (c.startTime && c.endTime && dateOnly(c.dateStart) <= dateStr && dateStr <= dateOnly(c.dateEnd)) {
        candidates.add(toMin(c.endTime))
      }
    }
    for (const m of Array.from(candidates).sort((a, b) => a - b)) {
      if (offset === 0 && m <= fromParts.minutes) continue
      const candidate = zonedDate(dateStr, m)
      if (isOpenAtCtx(ctx, candidate)) return { date: candidate, dateStr, time: toHHMM(m) }
    }
  }
  return null
}

/** French label for a next opening, relative to `from`: "à 19h00" (same local
 *  day), "demain à 19h00", else "le 16/08 à 19h00". */
export function nextOpeningLabelFr(next: NextOpening, from: Date): string {
  const at = next.time.replace(':', 'h')
  const fromStr = localParts(from).dateStr
  if (next.dateStr === fromStr) return `à ${at}`
  if (next.dateStr === addDays(fromStr, 1)) return `demain à ${at}`
  const [, mm, dd] = next.dateStr.split('-')
  return `le ${dd}/${mm} à ${at}`
}

// ── Public summary (consumer card / badge — Agent 13) ───────────────────────────

export type PublicHours = {
  hoursConfigured: boolean
  // null when not configured (no badge — current behaviour).
  isOpenNow: boolean | null
  nextOpening: { dateStr: string; time: string; label: string } | null
  weeklyHours: Array<{ dayOfWeek: number; ranges: Array<{ open: string; close: string }> }>
  currentClosure: { reason: string | null; until: string } | null
}

/** Everything the consumer card needs — nothing private. */
export async function publicHoursSummary(restaurantId: string, now = new Date()): Promise<PublicHours> {
  const ctx = await loadHoursContext(restaurantId)
  if (!ctx.configured) {
    return { hoursConfigured: false, isOpenNow: null, nextOpening: null, weeklyHours: [], currentClosure: null }
  }
  const open = isOpenAtCtx(ctx, now)
  const next = open ? null : nextOpeningCtx(ctx, now)
  const closure = open ? null : currentClosureCtx(ctx, now)
  const weekly: PublicHours['weeklyHours'] = []
  for (let d = 0; d < 7; d++) {
    weekly.push({
      dayOfWeek: d,
      ranges: ctx.hours.filter(h => h.dayOfWeek === d).map(h => ({ open: h.openTime, close: h.closeTime })),
    })
  }
  return {
    hoursConfigured: true,
    isOpenNow:       open,
    nextOpening:     next ? { dateStr: next.dateStr, time: next.time, label: nextOpeningLabelFr(next, now) } : null,
    weeklyHours:     weekly,
    currentClosure:  closure ? { reason: closure.reason, until: dateOnly(closure.dateEnd) } : null,
  }
}
