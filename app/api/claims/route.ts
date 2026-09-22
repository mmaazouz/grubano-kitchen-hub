import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { z } from 'zod'
import {
  isClaimsEnabled, createClaim, listConsumerClaims, getClaimEligibility, ACCEPTED_REASONS,
  autoResolveSmallClaim,
} from '@/lib/claims'
import { ALLOWED_IMAGE_TYPES } from '@/lib/dish-photo'
import { rateLimit } from '@/lib/rate-limit'
import { sendClaimAckEmail } from '@/lib/claim-emails'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/claims (P4.5-C1) ─────────────────────────────────────────────────────────
// Consumer-facing. Gated by CLAIMS_ENABLED (OFF → 403 on POST; GET reports
// enabled:false so the UI renders nothing → byte-identical, no UI exposed).
// POST = file a claim on MY paid order (owner-scoped, window validated, one active claim
// per order). The AMOUNT is derived server-side from the order's own line values — the
// client sends at most a line SELECTION, never money. Beta accepts NO evidence photo:
// nothing is uploaded, moderated or stored. GET = my claims, OR (with ?orderId) the
// eligibility + server-derived scope for one order (drives the client button).

// The request carries a DESCRIPTION of what happened and, optionally, a line SELECTION.
// It carries NO money: `requestedAmountCents` is accepted by the parser for backward
// compatibility and then DELIBERATELY IGNORED (see below) so an old client cannot widen
// financial authority. `imageBase64` is likewise accepted and ignored — beta has no photo
// requirement, and processing one before ownership was established was a real hole.
const createSchema = z.object({
  orderId:              z.string().min(1),
  // Canonical taxonomy plus the two legacy aliases (wrong_order / not_delivered), so an older
  // client keeps working; the server normalises to the canonical value before storing it.
  reason:              z.string().refine((r) => ACCEPTED_REASONS.includes(r), 'Motif de réclamation invalide.'),
  description:         z.string().max(1000).optional(),
  requestedAmountCents: z.number().int().positive().optional(), // IGNORED — see below
  items:               z.array(z.object({ index: z.number().int(), qty: z.number().int() })).max(50).optional(),
  imageBase64:         z.string().min(1).optional(),            // IGNORED in beta — see below
  mediaType:           z.enum(ALLOWED_IMAGE_TYPES).optional(),
})

export async function POST(req: NextRequest) {
  if (!isClaimsEnabled()) {
    return NextResponse.json({ error: 'Réclamations indisponibles', gated: true }, { status: 403 })
  }
  const token = await getToken({ req })
  if (!token?.sub) return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })

  // ABUSE — throttle BEFORE any parsing or DB work. Fail-open by design (lib/rate-limit).
  const limited = rateLimit(req, 'claims:create', { limitDefault: 5, windowDefault: 300 })
  if (limited) return limited

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
  const body = parsed.data

  // ── AUTHORIZATION ORDER (Claims batch 1, baseline P1) ───────────────────────────
  // The photo used to be uploaded to Cloudinary AND moderated by the LLM chain BEFORE
  // createClaim ran its ownership check, so ANY authenticated user could burn upload +
  // moderation budget on ANY orderId. In beta there is no photo requirement at all, so
  // the expensive path is REMOVED rather than merely reordered: nothing is uploaded,
  // moderated or stored, and the client is told so instead of silently believing its
  // evidence was kept. Ownership is established inside createClaim before any write.
  const photoAccepted = false
  const photoUrl: string | null = null

  const result = await createClaim({
    consumerId:  token.sub,
    orderId:     body.orderId,
    reason:      body.reason,
    description: body.description,
    // NOTE: body.requestedAmountCents is intentionally NOT forwarded. The amount is
    // derived server-side from the order's own line values (lib/claim-scope).
    items:       body.items,
    // A requested amount is a REDUCTION REQUEST, never authority: the server ceiling still caps
    // it. Dropping it entirely silently inflated every claim from the shipped client (which
    // sends an amount and no selection) to the whole order — the P0 this batch's audit caught.
    requestedAmountCents: body.requestedAmountCents,
    photoUrl,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  // C2 auto-resolution — INERT BY CONSTRUCTION under D′ (L2, S-13): autoResolveSmallClaim returns
  // { state:'not_eligible' } unconditionally, so no product flag can reach a machine approval through this
  // route. The call is kept so the pin « the route consults it and it approves nothing » stays testable.
  // (Pinned by tests/claims-dprime-l2-approve-decision-only.test.ts: the function is inert, the route sends no
  // decision e-mail from it, and no machine writer of status='approved' exists.)
  const auto = await autoResolveSmallClaim(result.claim as { id: string; consumerId: string; requestedAmountCents: number; status: string; reason?: string | null })
  void auto

  // ── T43 (vague 3) — accusé de réception au CLIENT, post-succès, BEST-EFFORT ──
  // Additif : la création/l'auto-résolution ci-dessus sont INTOUCHÉES ; un échec
  // d'email ne casse jamais le 201 (les senders sont intégralement try/catch'és
  // et idempotents — dedupeKey claim:<id>).
  {
    const c = result.claim as { id: string; consumerId: string; orderId: string; requestedAmountCents: number }
    await sendClaimAckEmail({
      claimId:              c.id,
      consumerId:           c.consumerId,
      orderId:              c.orderId,
      requestedAmountCents: c.requestedAmountCents,
      // ROUND 13 (H02, R-D7): the lease read at send time — one that closed since the entry gate skips the e-mail.
      claimsOpen:           isClaimsEnabled(),
    })
    // D′ L2: the former auto_small decision e-mail branch is gone with the machine approval path (S-02).
  }

  // photoAccepted:false is EXPLICIT: beta stores no evidence photo, and the client must
  // not be left believing one was kept.
  return NextResponse.json({ claim: result.claim, photoAccepted }, { status: 201 })
}

export async function GET(req: NextRequest) {
  if (!isClaimsEnabled()) return NextResponse.json({ enabled: false })
  const token = await getToken({ req })
  if (!token?.sub) return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })

  const orderId = new URL(req.url).searchParams.get('orderId')
  if (orderId) {
    const eligibility = await getClaimEligibility({ consumerId: token.sub, orderId })
    return NextResponse.json({ enabled: true, eligibility })
  }
  const claims = await listConsumerClaims(token.sub)
  return NextResponse.json({ enabled: true, claims })
}
