import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { resolveCodePromo } from '@/lib/promotions'
import { z } from 'zod'

// ── POST /api/eat/promos/validate (P1-PROMO) ──────────────────────────────────
// NON-authoritative PREVIEW only. The cart calls this to show the customer the
// discount a typed promo CODE would yield. The REAL discount is recomputed +
// applied SERVER-side in POST /api/orders at checkout (the client never sends a
// discount amount, and this preview is never trusted there).
//
// Session is OPTIONAL: a guest can preview a code (the per-user redeemed-check is
// simply skipped without a session). With a session, an already-redeemed code
// returns { valid:false } so the preview matches what checkout will do.

const itemSchema = z.object({
  itemId: z.string(),
  price:  z.number().positive(),
  qty:    z.number().int().min(1),
  // The cart sends `options` for composite lines (size/extras); we only read
  // options[0].parentDishId to reduce a composite id to its raw MenuItem id —
  // tolerate any extra keys.
  options: z.array(z.record(z.unknown())).default([]),
})

const bodySchema = z.object({
  code:         z.string().trim().min(1).max(40),
  restaurantId: z.string(),
  // Optional: when present, the discount is computed on the real basket (the only
  // way percent / second_item / threshold_reward yield a meaningful preview).
  // Absent → resolveCodePromo returns null (no basket to discount).
  items:        z.array(itemSchema).min(1).optional(),
  fulfillmentType: z.enum(['delivery', 'pickup']).default('delivery'),
})

export async function POST(req: NextRequest) {
  try {
    const token = await getToken({ req })          // OPTIONAL — guests may preview
    const body = await req.json()
    const data = bodySchema.parse(body)

    // Reduce composite cart line ids (`dishId::sig`) to the RAW MenuItem id — the
    // SAME reduction the order-creation promo block applies, so the preview math
    // matches checkout exactly.
    const rawLines = (data.items ?? []).map((item) => {
      const parent = item.options?.[0]?.parentDishId
      const rawId = typeof parent === 'string' && parent.length > 0
        ? parent
        : item.itemId.split('::')[0]
      return { rawId, price: item.price, qty: item.qty }
    })

    const resolved = await resolveCodePromo(
      data.restaurantId,
      data.code,
      token?.sub ?? undefined,
      rawLines.length > 0
        ? { items: rawLines, channel: data.fulfillmentType === 'pickup' ? 'pickup' : 'delivery' }
        : undefined,
    )

    if (!resolved) {
      return NextResponse.json({ valid: false })
    }
    return NextResponse.json({
      valid:       true,
      type:        resolved.type,
      discountEur: resolved.discountEur,
      label:       resolved.label,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ valid: false, error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/eat/promos/validate]', err)
    return NextResponse.json({ valid: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
