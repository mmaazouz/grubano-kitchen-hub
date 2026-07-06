// Courier COURSE accrual (rail de paie livreur P4.3 ÉTAPE 3 — financement cas B).
//
// This is the ÉTAPE 3 WRITER that finally FEEDS the rail built in ÉTAPE 2: when a
// case-B delivery (Order.deliveryMode = 'grubano_courier') is confirmed delivered, it
// creates ONE CourierEarning of type 'course' for the mission's courier — gross = the
// client's deliveryFee, fee = Grubano's commission (20 %, configurable), net = gross − fee
// = what the courier is owed. computePartnerBalance('logistics') then sums the matured
// rows; payPartner('logistics') disburses them (both gated OFF).
//
// SAFETY MODEL (why nothing accrues in prod today):
//   1. FLAG — LOGISTICS_COURIER_ACCRUAL_ENABLED (default OFF) gates BOTH this accrual AND
//      the pay-time withholding of the deliveryFee, so the two ALWAYS move together (you
//      never withhold without accruing, nor accrue without having withheld).
//   2. DATA — only fires for Order.deliveryMode === 'grubano_courier' (case B). Case A
//      ('restaurant', the DEFAULT and the only value in prod — nothing marks 'grubano_courier'
//      automatically yet, that assignment step is later) → NO accrual, byte-identical.
//   3. DISBURSEMENT — even an accrued earning is not payable until LOGISTICS_PAYOUT_ENABLED
//      is ON (ÉTAPE 2). So no money LEAVES the platform at this step regardless.
//
// CLAWBACK (decided, documented): the courier KEEPS the course pay even if the MEAL is later
// refunded for quality — the delivery was performed, so its fee is earned and there is NO
// clawback of the course on a product refund. (The TIP reversal + any tip clawback is ÉTAPE 6.)
//
// All amounts in integer CENTS. Idempotent (DB @@unique([missionId,type]) + P2002 catch).
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { eurosToCents } from '@/lib/stripe'
import { courierMaturesAt } from '@/lib/courier-earnings'
import { isLogisticsPayoutEnabled } from '@/lib/creator-payout'

/** Grubano's commission on a courier's delivery course, in BASIS POINTS (integer, 0..10000).
 *  Default 2000 = 20 % (decided). Env LOGISTICS_COMMISSION_BPS overrides; an out-of-range /
 *  non-numeric value falls back to 2000. Basis points (not a Float %) keep the fee cent-exact. */
export function courierCommissionBps(): number {
  const v = Number.parseInt(process.env.LOGISTICS_COMMISSION_BPS ?? '', 10)
  return Number.isFinite(v) && v >= 0 && v <= 10000 ? v : 2000
}

/** Courier accrual/withholding kill-switch (P4.3 ÉTAPE 3) — default OFF. Gates BOTH the
 *  pay-time withholding of the case-B deliveryFee (orders/pay) AND this delivery-time
 *  accrual, so they are always consistent. OFF ⇒ a 'grubano_courier' order is byte-identical
 *  case A (fee 100 % resto, no earning). Coupling to LOGISTICS_CONNECT/PAYOUT = check-flags,
 *  ÉTAPE 6. NOT activated here. */
export function isLogisticsCourierAccrualEnabled(): boolean {
  return process.env.LOGISTICS_COURIER_ACCRUAL_ENABLED === 'true'
}

export type CourierAccrualResult =
  | { status: 'created'; earningId: string; grossCents: number; feeCents: number; netCents: number }
  | { status: 'skipped'; reason: string }

/**
 * Idempotently accrue the COURSE earning for a DELIVERED case-B mission. Best-effort +
 * self-guarded, so it is SAFE to call on every deliver attempt (the caller does): a replay
 * is a no-op, and it HEALS a failed first accrual on a retry that now sees the mission
 * already delivered. Reads the mission + its order fresh (never trusts caller input beyond
 * the ids); OWNER-SCOPED (the earning's courierId is the MISSION's courierId, and the
 * requester must match it). NO Stripe, NO payout — a pure DB accrual of an integer-cents
 * obligation. Returns a discriminated result (never throws for a normal skip/replay).
 */
export async function accrueCourierCourseEarning(
  missionId: string,
  requesterCourierId: string,
  now: Date = new Date(),
): Promise<CourierAccrualResult> {
  // GATE 1 — flag OFF ⇒ inert (no DB touch at all).
  if (!isLogisticsCourierAccrualEnabled()) return { status: 'skipped', reason: 'rail_disabled' }

  const mission = await prisma.mission.findUnique({
    where:  { id: missionId },
    select: { id: true, status: true, courierId: true, orderId: true },
  })
  if (!mission) return { status: 'skipped', reason: 'mission_not_found' }
  // The transition must ALREADY have landed on 'delivered' (the caller runs us after it).
  if (mission.status !== 'delivered') return { status: 'skipped', reason: 'not_delivered' }
  // OWNER-SCOPE — the earning belongs to the mission's courier, and the requester must be
  // that courier (the route resolved it from the session). Never a client-supplied id.
  if (!mission.courierId || mission.courierId !== requesterCourierId) return { status: 'skipped', reason: 'not_owner' }
  // A B2C course needs a linked consumer Order (its deliveryFee). An autonomous B2B mission
  // (orderId null) has no consumer deliveryFee to split here → nothing to accrue.
  if (!mission.orderId) return { status: 'skipped', reason: 'no_order' }

  const order = await prisma.order.findUnique({
    where:  { id: mission.orderId },
    select: { deliveryMode: true, deliveryFee: true },
  })
  if (!order) return { status: 'skipped', reason: 'order_not_found' }
  // GATE 2 — DATA: only case B accrues. Case A ('restaurant', default/prod) → no earning.
  if (order.deliveryMode !== 'grubano_courier') return { status: 'skipped', reason: 'not_case_b' }

  // ── Amounts — integer CENTS, EXPLICIT commission rounding ─────────────────────────────
  const grossCents = eurosToCents(order.deliveryFee)               // client deliveryFee → cents
  const feeCents   = Math.round((grossCents * courierCommissionBps()) / 10000) // Grubano commission
  const netCents   = grossCents - feeCents                         // owed to the courier
  // ASSERTION (revue ÉTAPE 2) — the invariant computePartnerBalance relies on. courierCommissionBps
  // is clamped to [0,10000] so fee ∈ [0,gross] and net ∈ [0,gross]; assert it before writing.
  if (
    grossCents < 0 || feeCents < 0 || feeCents > grossCents ||
    netCents !== grossCents - feeCents
  ) {
    throw new Error(
      `courier course accrual invariant violated: gross=${grossCents} fee=${feeCents} net=${netCents} (mission ${missionId})`,
    )
  }

  // ── Idempotent create — DB @@unique([missionId,type]); a replay hits P2002 → no-op ───────
  try {
    const row = await prisma.courierEarning.create({
      data: {
        courierId: mission.courierId, missionId, orderId: mission.orderId, type: 'course',
        grossCents, feeCents, netCents,
        status: 'pending', maturesAt: courierMaturesAt(now),
      },
      select: { id: true },
    })
    return { status: 'created', earningId: row.id, grossCents, feeCents, netCents }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { status: 'skipped', reason: 'already_accrued' } // replay / concurrent — idempotent
    }
    throw err
  }
}

// ── Courier TIP reversal (P4.3 ÉTAPE 6 — corrige le bug D-1 « tip retenu jamais reversé ») ─
//
// The consumer's courier tip is CHARGED + HELD by the platform at /pay (TIPS_ENABLED, in the
// application_fee — ÉTAPE 3 recorded it as a 'courier_tip' ledger obligation). ÉTAPE 6 finally
// REVERSES it to the courier: when a mission is DELIVERED, a 100 % CourierEarning of type 'tip'
// is accrued (gross = tip, fee = 0, net = tip — NO commission on a tip, decided). It then matures
// + pays out through the SAME rail as the course (payPartner logistics).
//
// GATING: the CHARGING stays governed by TIPS_ENABLED (unchanged); the REVERSAL (this accrual +
// its payout) is governed by LOGISTICS_PAYOUT_ENABLED. check-flags enforces TIPS ⇒ LOGISTICS_
// PAYOUT ⇒ LOGISTICS_CONNECT, so a tip can never be charged without a live reversal rail (D-1).
// OFF ⇒ inert (no DB touch). A tip needs a Grubano courier (the Mission's courierId) + a linked
// Order carrying a tip; it is INDEPENDENT of the case-A/B deliveryFee routing (a tip is the
// customer's gratuity to whoever delivered, not part of the fee split).
export async function accrueCourierTipEarning(
  missionId: string,
  requesterCourierId: string,
  now: Date = new Date(),
): Promise<CourierAccrualResult> {
  // GATE — the reversal rail. OFF ⇒ inert (no DB touch), the tip stays HELD until go-live.
  if (!isLogisticsPayoutEnabled()) return { status: 'skipped', reason: 'rail_disabled' }

  const mission = await prisma.mission.findUnique({
    where:  { id: missionId },
    select: { id: true, status: true, courierId: true, orderId: true },
  })
  if (!mission) return { status: 'skipped', reason: 'mission_not_found' }
  if (mission.status !== 'delivered') return { status: 'skipped', reason: 'not_delivered' }
  // OWNER-SCOPE — the tip belongs to the mission's courier; the requester must be that courier.
  if (!mission.courierId || mission.courierId !== requesterCourierId) return { status: 'skipped', reason: 'not_owner' }
  if (!mission.orderId) return { status: 'skipped', reason: 'no_order' }

  // The HELD tip on the linked order (integer cents; > 0 only if TIPS_ENABLED was on at /pay).
  const order = await prisma.order.findUnique({
    where:  { id: mission.orderId },
    select: { tipCents: true },
  })
  if (!order) return { status: 'skipped', reason: 'order_not_found' }
  const tipCents = order.tipCents ?? 0
  if (tipCents <= 0) return { status: 'skipped', reason: 'no_tip' }

  // 100 % to the courier — NO commission on a tip (decided). gross = net = tip, fee = 0.
  const grossCents = tipCents
  const feeCents   = 0
  const netCents   = tipCents
  if (grossCents < 0 || netCents !== grossCents - feeCents) {
    throw new Error(`courier tip accrual invariant violated: gross=${grossCents} fee=${feeCents} net=${netCents} (mission ${missionId})`)
  }

  // Idempotent — DB @@unique([missionId, type]); 'tip' is a DISTINCT type from 'course', so a
  // mission can carry ONE course + ONE tip. A replay hits P2002 → no-op.
  try {
    const row = await prisma.courierEarning.create({
      data: {
        courierId: mission.courierId, missionId, orderId: mission.orderId, type: 'tip',
        grossCents, feeCents, netCents,
        status: 'pending', maturesAt: courierMaturesAt(now),
      },
      select: { id: true },
    })
    return { status: 'created', earningId: row.id, grossCents, feeCents, netCents }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { status: 'skipped', reason: 'already_accrued' }
    }
    throw err
  }
}

export type CourierTipClawbackResult =
  | { status: 'clawed'; count: number }
  | { status: 'noop';   reason: string }

/**
 * Claw back a courier's TIP earning when the linked order is TOTALLY refunded / cancelled
 * (P4.3 ÉTAPE 6). DECIDED: the COURSE stays acquired (the delivery was performed) — this ONLY
 * touches the 'tip' rows and NEVER the 'course'. A pending|matured tip → 'cancelled' (leaves the
 * balance, since computePartnerBalance sums only matured|paid). A tip ALREADY 'paid' is NOT
 * auto-reversed (the money already reached the courier's account); it is LOGGED for manual
 * reconciliation — a courier keeps a tip they were already paid on a later refund (documented,
 * customer-friendly, and rare given the maturation delay). Idempotent (a re-run flips 0 rows).
 * Best-effort — the caller (webhook) must never fail a refund over the tip clawback.
 */
export async function clawbackCourierTip(orderId: string): Promise<CourierTipClawbackResult> {
  const tips = await prisma.courierEarning.findMany({
    where:  { orderId, type: 'tip' },
    select: { id: true, status: true },
  })
  if (tips.length === 0) return { status: 'noop', reason: 'no_tip' }

  const alreadyPaid = tips.filter(t => t.status === 'paid')
  if (alreadyPaid.length > 0) {
    console.warn(`[courier tip clawback] order ${orderId}: ${alreadyPaid.length} tip earning(s) already PAID — kept (manual reconciliation): ${alreadyPaid.map(t => t.id).join(',')}`)
  }

  // Cancel only the not-yet-paid tips; NEVER the course. Guarded status → idempotent.
  const res = await prisma.courierEarning.updateMany({
    where: { orderId, type: 'tip', status: { in: ['pending', 'matured'] } },
    data:  { status: 'cancelled' },
  })
  return res.count > 0 ? { status: 'clawed', count: res.count } : { status: 'noop', reason: 'nothing_to_claw' }
}
