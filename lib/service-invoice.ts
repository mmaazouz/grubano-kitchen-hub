// lib/service-invoice.ts — issue + resolve a SERVICE-MISSION invoice (P6, Agent 79).
//
// Idempotent + gapless, mirroring lib/invoice.issueInvoice's MECHANISM but for a SEPARATE
// series (PRS-YYYY-NNNNN via the dedicated ServiceInvoiceCounter — the resto GRB- counter +
// Invoice + lib/invoice.ts are UNTOUCHED). MONEY-ADJACENT but ZERO money movement: it stores
// the agreed amount + a number, it charges NOTHING (no Stripe / charge / payout / Connect).
// One invoice per mission (serviceMissionId @unique). LAZY: it is invoked for a mission already
// in status 'done' (the caller enforces that); it NEVER changes the P3 mission state.
import { prisma } from '@/lib/prisma'
import { callerOperator } from '@/lib/operator-session'
import { callerPrestataireProfile } from '@/lib/prestataire-account'
import { computeServiceEconomics, type ServiceEconomics } from '@/lib/service-pricing'

export type IssuedServiceInvoice = {
  id: string; serviceMissionId: string; number: string
  restaurantOperatorId: string; prestataireProfileId: string
  amountCents: number; status: string; issuedAt: Date
  alreadyExisted: boolean
}

/** Issue ONE invoice for `serviceMissionId` — IDEMPOTENT and gapless. Everything happens in ONE
 *  transaction: an existing invoice is returned as-is (no duplicate, no number burned); otherwise
 *  the DEDICATED prestataire year counter is atomically incremented (row lock — never a naive
 *  MAX+1 race) and the invoice is created with that PRS-YYYY-NNNNN number. A failure rolls back
 *  BOTH → the legal sequence stays continuous. NO money moves. */
export async function issueServiceInvoice(opts: {
  serviceMissionId:     string
  restaurantOperatorId: string
  prestataireProfileId: string
  amountCents:          number
}): Promise<IssuedServiceInvoice> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.serviceInvoice.findUnique({ where: { serviceMissionId: opts.serviceMissionId } })
    if (existing) return { ...existing, alreadyExisted: true }

    // Legal numbering by ISSUANCE year — DEDICATED prestataire series (PRS-), incremented
    // inside this transaction (never MAX+1). The resto GRB- InvoiceCounter is never touched.
    const year = new Date().getFullYear()
    await tx.serviceInvoiceCounter.upsert({ where: { year }, create: { year, seq: 0 }, update: {} })
    const counter = await tx.serviceInvoiceCounter.update({ where: { year }, data: { seq: { increment: 1 } } })
    const number = `PRS-${year}-${String(counter.seq).padStart(5, '0')}`

    const created = await tx.serviceInvoice.create({
      data: {
        serviceMissionId:     opts.serviceMissionId,
        restaurantOperatorId: opts.restaurantOperatorId,
        prestataireProfileId: opts.prestataireProfileId,
        number,
        amountCents:          Math.max(0, Math.round(opts.amountCents)),
        status:               'issued',
      },
    })
    return { ...created, alreadyExisted: false }
  })
}

// ── Owner-scoped resolution for the invoice routes ───────────────────────────
// Resolves the mission, AUTHORIZES the caller (a PARTY to the mission — the resto operator or
// the prestataire — or admin), requires the mission be 'done' with an agreed amount, then
// lazily ensures the invoice exists. Returns the invoice + the PURE 5% economics + the
// issuer/recipient identities for the document. NO money moves. Used by both the JSON + PDF
// routes (the flag gate is applied by the routes BEFORE calling this).

export type InvoiceContext =
  | { ok: false; status: number; error: string }
  | {
      ok: true
      invoice: IssuedServiceInvoice
      economics: ServiceEconomics
      // The 5 % split is CONFIDENTIAL to the prestataire side. revealSplit is the SERVER-SIDE gate:
      // true only for the issuing prestataire (or admin); FALSE for the billed restaurant, which
      // must never see Grubano's margin / the prestataire's net (it only owes the agreed total).
      revealSplit: boolean
      issuer: { name: string; city: string; siren: string }
      recipient: { name: string }
      serviceLabel: string
    }

export async function resolveInvoiceForCaller(serviceMissionId: string): Promise<InvoiceContext> {
  const operator = await callerOperator()
  if (!operator) return { ok: false, status: 401, error: 'Non autorisé' }

  const mission = await prisma.serviceMission.findUnique({
    where: { id: serviceMissionId },
    select: {
      id: true, status: true, quoteAmountCents: true, restaurantOperatorId: true, prestataireProfileId: true,
      restaurantOperator: { select: { name: true } },
      prestataireProfile: { select: { companyName: true, city: true, siren: true } },
      serviceOffering:    { select: { title: true } },
    },
  })
  if (!mission) return { ok: false, status: 404, error: 'Mission introuvable' }

  // Authorize: a PARTY to the mission (the billed resto operator OR the issuing prestataire) or admin.
  // Track WHICH party — the commission split is confidential to the prestataire side, so the BILLED
  // RESTAURANT is authorized to see/download its invoice but NOT the split (revealSplit stays false).
  const isAdmin = operator.role === 'admin'
  const isResto = mission.restaurantOperatorId === operator.id
  let isPrestataire = false
  if (!isAdmin && !isResto) {
    const profile = await callerPrestataireProfile()
    isPrestataire = !!profile && profile.id === mission.prestataireProfileId
  }
  if (!isAdmin && !isResto && !isPrestataire) return { ok: false, status: 403, error: 'Accès refusé' }
  const revealSplit = isAdmin || isPrestataire

  if (mission.status !== 'done') return { ok: false, status: 409, error: 'La mission doit être réalisée pour être facturée' }
  if (mission.quoteAmountCents == null) return { ok: false, status: 409, error: 'Aucun montant convenu pour cette mission' }

  const invoice = await issueServiceInvoice({
    serviceMissionId:     mission.id,
    restaurantOperatorId: mission.restaurantOperatorId,
    prestataireProfileId: mission.prestataireProfileId,
    amountCents:          mission.quoteAmountCents,
  })
  const economics = computeServiceEconomics(invoice.amountCents)

  return {
    ok: true,
    invoice,
    economics,
    revealSplit,
    issuer:    { name: mission.prestataireProfile.companyName, city: mission.prestataireProfile.city ?? '', siren: mission.prestataireProfile.siren ?? '' },
    recipient: { name: mission.restaurantOperator.name },
    serviceLabel: mission.serviceOffering?.title ?? '',
  }
}
