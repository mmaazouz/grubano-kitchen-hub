import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { z } from 'zod'
import {
  isClaimsEnabled, createClaim, listConsumerClaims, getClaimEligibility, CLAIM_REASONS,
} from '@/lib/claims'
import { processDishImage, ALLOWED_IMAGE_TYPES, type DishImageType } from '@/lib/dish-photo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/claims (P4.5-C1) ─────────────────────────────────────────────────────────
// Consumer-facing. Gated by CLAIMS_ENABLED (OFF → 403 on POST; GET reports
// enabled:false so the UI renders nothing → byte-identical, no UI exposed).
// POST = file a claim on MY paid order (owner-scoped, window + amount validated, one
// active claim per order). Optional photo reuses the moderated Cloudinary chain
// (processDishImage) — food-tuned moderation, so non-food evidence may be refused; the
// photo is OPTIONAL, the client can submit without it. GET = my claims, OR (with
// ?orderId) the eligibility + existing claim for one order (drives the client button).

const createSchema = z.object({
  orderId:              z.string().min(1),
  reason:              z.enum(CLAIM_REASONS),
  description:         z.string().max(1000).optional(),
  requestedAmountCents: z.number().int().positive().optional(),
  imageBase64:         z.string().min(1).optional(),
  mediaType:           z.enum(ALLOWED_IMAGE_TYPES).optional(),
})

export async function POST(req: NextRequest) {
  if (!isClaimsEnabled()) {
    return NextResponse.json({ error: 'Réclamations indisponibles', gated: true }, { status: 403 })
  }
  const token = await getToken({ req })
  if (!token?.sub) return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
  const body = parsed.data

  // Optional evidence photo — reuse the moderated Cloudinary chain. A photo failure is
  // surfaced verbatim (the client can resubmit WITHOUT the photo; it is optional).
  let photoUrl: string | null = null
  if (body.imageBase64) {
    const photo = await processDishImage(body.imageBase64, (body.mediaType ?? 'image/jpeg') as DishImageType)
    if (!photo.ok) return NextResponse.json({ error: photo.error }, { status: photo.status })
    photoUrl = photo.url
  }

  const result = await createClaim({
    consumerId:           token.sub,
    orderId:              body.orderId,
    reason:               body.reason,
    description:          body.description,
    requestedAmountCents: body.requestedAmountCents,
    photoUrl,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ claim: result.claim }, { status: 201 })
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
