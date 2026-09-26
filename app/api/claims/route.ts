import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { z } from 'zod'
import {
  createClaim, listConsumerClaims, getClaimEligibility, ACCEPTED_REASONS,
  autoResolveSmallClaim,
} from '@/lib/claims'
import { claimsSurfaceOpen, claimsIntakeOpen, claimNoticeGate } from '@/lib/claim-flags'
import { ALLOWED_IMAGE_TYPES } from '@/lib/dish-photo'
import { rateLimit } from '@/lib/rate-limit'
import { sendClaimAckEmail } from '@/lib/claim-emails'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/claims (P4.5-C1) ─────────────────────────────────────────────────────────
// D′ L1 — see lib/claim-flags.ts (spec v2 §3).
// Consumer-facing. Gated by the claims SURFACE (spec v2 §3: CLAIMS_SURFACE_ENABLED, or the
// legacy lease when no product flag is set — OFF → 403 {gated:true} on POST; GET reports
// enabled:false so the UI renders nothing → byte-identical, no UI exposed). Filing a NEW claim
// additionally needs the INTAKE (CLAIMS_INTAKE_ENABLED under the product surface): surface open
// and intake closed → POST 403 {gated:false, enabled:true, intakeOpen:false, reason:'intake_closed'}
// (a probe reads it as UNKNOWN, never as CLOSED), and GET ?orderId overlays the eligibility with
// canClaim:false / reason:'intake_closed' — existing claims, history and contest are untouched.
// POST = file a claim on MY paid order (owner-scoped, window validated, one active claim
// per order). The AMOUNT is derived server-side from the order's own line values — the
// client sends at most a line SELECTION, never money. Beta accepts NO evidence photo:
// nothing is uploaded, moderated or stored. GET = my claims, OR (with ?orderId) the
// eligibility + server-derived scope for one order (drives the client button).

// The request carries a DESCRIPTION of what happened, a SCOPE, and — depending on the scope — a line
// SELECTION or an amount.
//
// L7 (T-50) — `scope` is the customer's own statement of what they are claiming, and there is NO
// default where several scopes are possible: a reason like « qualité » with no scope is refused
// (400, `scope_required`) instead of becoming a whole-order claim by silence. `requestedAmountCents`
// is no longer ignored — it is the figure for scope 'amount', validated against the server ceiling
// and refused above it; in every other scope it is refused outright rather than quietly dropped, so
// two things can never claim to set the amount. `imageBase64` stays accepted and ignored: beta has no
// photo requirement, and processing one before ownership was established was a real hole.
const createSchema = z.object({
  orderId:              z.string().min(1),
  // Canonical taxonomy plus the two legacy aliases (wrong_order / not_delivered), so an older
  // client keeps working; the server normalises to the canonical value before storing it. Whether a
  // reason may be FILED at all is lib/claim-reasons' business (restaurant_closed no longer may) —
  // kept out of the parser so an existing row's value stays readable for ever.
  reason:              z.string().refine((r) => ACCEPTED_REASONS.includes(r), 'Motif de réclamation invalide.'),
  description:         z.string().max(1000).optional(),
  scope:               z.enum(['items', 'amount', 'whole']).optional(),
  requestedAmountCents: z.number().int().positive().optional(),
  items:               z.array(z.object({ index: z.number().int(), qty: z.number().int() })).max(50).optional(),
  imageBase64:         z.string().min(1).optional(),            // IGNORED in beta — see below
  mediaType:           z.enum(ALLOWED_IMAGE_TYPES).optional(),
})

export async function POST(req: NextRequest) {
  if (!claimsSurfaceOpen()) {
    return NextResponse.json({ error: 'Réclamations indisponibles', gated: true }, { status: 403 })
  }
  // D′ L1 (S-23): the surface is open but new claims are not taken right now. Not a kill-switch
  // answer (gated:false): the feature exists, the intake is paused. Read BEFORE auth so a probe
  // sees the shape without a session — it carries no data.
  if (!claimsIntakeOpen()) {
    return NextResponse.json({ error: 'Dépôt de réclamation suspendu', gated: false, enabled: true, intakeOpen: false, reason: 'intake_closed' }, { status: 403 })
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
    // L7 — the customer's own statement of scope. No default is supplied here: a missing scope on a
    // reason that offers a choice must reach createClaim as missing, so it can be REFUSED rather
    // than guessed. Supplying 'whole' here would restore exactly the silence L7 removes.
    scope:       body.scope,
    items:       body.items,
    // Authority only in scope 'amount', and only downward (the server ceiling caps it). In 'items'
    // the priced selection is the amount; in 'whole' the ceiling is. createClaim refuses the
    // combinations rather than dropping the field, so a client never believes an amount was used
    // when it was not.
    requestedAmountCents: body.requestedAmountCents,
    photoUrl,
  })
  if (!result.ok) {
    // D′ L6 (spec v2 §7.1): forward the eligibility CODE beside the sentence. The client renders the code in
    // its own locale (REFUSAL_LABEL on the help page) and falls back to `error` when there is none — so a
    // refusal that is not an eligibility rule still reads as a sentence rather than as a bare code.
    return NextResponse.json(
      result.reason ? { error: result.error, reason: result.reason } : { error: result.error },
      { status: result.status },
    )
  }
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
    const c = result.claim as { id: string; consumerId: string; orderId: string; requestedAmountCents: number; selection?: unknown }
    await sendClaimAckEmail({
      claimId:              c.id,
      consumerId:           c.consumerId,
      orderId:              c.orderId,
      requestedAmountCents: c.requestedAmountCents,
      // L7 (T-50) — the snapshot as PERSISTED, read back off the created row rather than rebuilt from
      // the request body. The e-mail then describes what the claim actually holds; if the write stored
      // something different from what the client sent, the customer sees the stored version, which is
      // the one that will be arbitrated. A legacy or absent snapshot renders nothing extra.
      selection:            c.selection,
      // ROUND 13 (H02, R-D7) + D′ L1 (FIN-EMAIL-01): the PRE-MONEY gate read at send time — a surface that
      // closed since the entry gate skips the e-mail.
      claimsOpen:           claimNoticeGate('pre_money'),
    })
    // D′ L2: the former auto_small decision e-mail branch is gone with the machine approval path (S-02).
  }

  // photoAccepted:false is EXPLICIT: beta stores no evidence photo, and the client must
  // not be left believing one was kept.
  return NextResponse.json({ claim: result.claim, photoAccepted }, { status: 201 })
}

export async function GET(req: NextRequest) {
  if (!claimsSurfaceOpen()) return NextResponse.json({ enabled: false })
  const token = await getToken({ req })
  if (!token?.sub) return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })

  const orderId = new URL(req.url).searchParams.get('orderId')
  if (orderId) {
    const eligibility = await getClaimEligibility({ consumerId: token.sub, orderId })
    const intakeOpen = claimsIntakeOpen()
    // D′ L1 (spec v2 §7.1, S-23): the intake overlay is a ROUTE concern — the eligibility engine is unchanged.
    // not_owner stays as is (nothing about this order is disclosed); every other verdict keeps its
    // existingClaim / scope and loses only the right to file.
    const overlaid = intakeOpen || eligibility.reason === 'not_owner'
      ? eligibility
      : { ...eligibility, canClaim: false, reason: 'intake_closed' as const }
    return NextResponse.json({ enabled: true, intakeOpen, eligibility: overlaid })
  }
  const claims = await listConsumerClaims(token.sub)
  return NextResponse.json({ enabled: true, claims })
}
