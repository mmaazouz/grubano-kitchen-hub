// Courier earnings maturation (rail de paie livreur P4.3 ÉTAPE 2 — plomberie).
//
// The logistics analogue of lib/creator-earnings, kept deliberately SIMPLE: a
// CourierEarning row carries its OWN target date (maturesAt, stamped at creation in
// ÉTAPE 3), so maturation is a pure "has the window elapsed?" check — no order join,
// no refund read (delivery earnings are accrued only on a delivered+paid mission, so
// the never-paid / self-referral cases of the creator engine do not apply here; a
// clawback on a post-payout refund is a LATER decision, audit point 6).
//
//   pending → matured   once now ≥ maturesAt (window = COURIER_MATURATION_DAYS,
//                       calque of the creator 7-day hold, env-overridable).
//   matured → paid      set at payout time (a later step — reporting only; the
//                       balance's anti-double-pay nets the Payout sum, not this status).
//
// ⚠️ ÉTAPE 2 = INERT. Nothing writes CourierEarning yet, so matureCourierEarnings scans
// an EMPTY table and is a no-op. This module is defined + unit-tested now so the rail is
// ready; it is NOT wired to a cron here (that is a later step). Amounts live on the row
// in integer CENTS — this module only touches STATUS/dates, never money.
import { prisma } from '@/lib/prisma'

/** Maturation window in DAYS — calque of the creator MATURATION_DAYS (7). Configurable
 *  via env COURIER_MATURATION_DAYS (positive integer); falls back to 7. Read per call so
 *  a test / ops change takes effect without a reload. */
export function courierMaturationDays(): number {
  const v = Number.parseInt(process.env.COURIER_MATURATION_DAYS ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : 7
}

/** The window in milliseconds. */
export function courierMaturationMs(): number {
  return courierMaturationDays() * 24 * 60 * 60 * 1000
}

/** PURE — the target maturation date for an earning generated at `base` (the delivered/
 *  accrual instant). Used by the ÉTAPE 3 writer to stamp CourierEarning.maturesAt. */
export function courierMaturesAt(base: Date): Date {
  return new Date(base.getTime() + courierMaturationMs())
}

export type CourierMaturityInput = {
  createdAt: Date
  /** The row's target date; null falls back to createdAt + the configured window. */
  maturesAt: Date | null
  now:       Date
}

export type CourierMaturityVerdict =
  | { status: 'pending'; reason: 'too_young' }
  | { status: 'matured'; reason: 'ok' }

/** PURE maturation rule (fully unit-tested, no I/O). A row matures once the window has
 *  elapsed: prefer its explicit maturesAt; fall back to createdAt + the configured window
 *  when it is null (defensive — the writer always sets maturesAt). */
export function evaluateCourierEarningMaturity(i: CourierMaturityInput): CourierMaturityVerdict {
  const threshold = i.maturesAt ?? new Date(i.createdAt.getTime() + courierMaturationMs())
  return i.now.getTime() >= threshold.getTime()
    ? { status: 'matured', reason: 'ok' }
    : { status: 'pending', reason: 'too_young' }
}

export type CourierMaturationSummary = {
  scanned: number
  matured: number
  pending: number
}

/** Batch maturation pass over every PENDING CourierEarning. IDEMPOTENT: a promoted row
 *  leaves 'pending', so a re-run scans only what is left and a no-change run is a no-op
 *  (the guarded updateMany where status:'pending' also makes concurrent runs safe). READS
 *  nothing but the row's own dates — no order/ledger join. Money is never touched. */
export async function matureCourierEarnings(now: Date = new Date()): Promise<CourierMaturationSummary> {
  const rows = await prisma.courierEarning.findMany({
    where:  { status: 'pending' },
    select: { id: true, createdAt: true, maturesAt: true },
  })
  const summary: CourierMaturationSummary = { scanned: rows.length, matured: 0, pending: 0 }
  for (const row of rows) {
    const verdict = evaluateCourierEarningMaturity({ createdAt: row.createdAt, maturesAt: row.maturesAt, now })
    if (verdict.status === 'pending') { summary.pending++; continue }
    await prisma.courierEarning.updateMany({
      where: { id: row.id, status: 'pending' },
      data:  { status: 'matured' },
    })
    summary.matured++
  }
  return summary
}
