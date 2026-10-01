import { NextResponse } from 'next/server'
import { z } from 'zod'
import { llmComplete, LlmQuotaError, type LlmContent } from '@/lib/llm'
import { callerOperator } from '@/lib/operator-session'
import { rateLimit } from '@/lib/rate-limit'
import { MAX_IMAGE_BYTES } from '@/lib/dish-photo'
import { base64Bytes } from '@/lib/menu-extract'

// ── POST /api/menu/scan-dish — AI dish scan. RESTAURATEUR-ONLY ────────────────
//
// P1-SEC — this route used to reach a paid Sonnet VISION call with NO authentication,
// NO rate limit and NO input bound, and `callerOperator()` was swallowed by
// `.catch(() => undefined)`: an anonymous caller produced `operatorId: undefined`,
// which is exactly the condition that DISABLES the per-operator quota
// (lib/llm/index.ts:176 checks `if (input.operatorId && …)`). Unbounded cost
// amplification on the most expensive task in the gateway. Same class of hole as
// the one already closed on POST /api/reviews/generate-reply (P0-05), fixed here
// with the same building blocks:
//   1. authenticated operator REQUIRED → 401, and role restaurant|admin → 403
//      (the EXACT contract of POST /api/menu — a scan only exists to feed a dish
//      creation, which is already restricted to those two roles),
//   2. rate limit via the shared limiter (anti-burst),
//   3. bounded input — a base64 image is capped at the SAME 8 MB as every other
//      dish photo path,
//   4. operatorId is now a non-optional string → the per-partner LLM quota
//      (LLM_QUOTA_DAILY_CENTS / LLM_QUOTA_MONTHLY_CENTS) finally applies TO THIS ROUTE.
//      Scope of that claim, stated exactly: `dish_scan` is quota'd here, and the
//      `dish_moderation` call behind POST /api/menu (same Sonnet vision cost) is now
//      attributed too. NOT yet: POST /api/menu/photo, POST /api/creators/dishes/photo,
//      POST /api/claims — all three still reach llmComplete with no operatorId. The
//      gateway condition `if (input.operatorId && …)` is closed per call site, one at
//      a time; it is not a global switch.
//
// SCOPE — honest statement: this route receives NO resource id. The real (and only)
// caller, app/[locale]/menu/page.tsx:1645, posts `{ imageBase64, mediaType }` and
// nothing else; the scan CREATES nothing and READS nothing from the database. There
// is therefore no brand/dish/restaurant to own-check here, and no cross-tenant
// surface to close: "foreign resource id" simply does not apply. The route is scoped
// to the CALLING OPERATOR (session → quota attribution + rate-limit bucket), NOT to a
// brand. Brand ownership is enforced downstream, when the scan result is submitted to
// POST /api/menu. No brandId parameter is invented here — adding one the client never
// sends would be dead validation, not security.

const schema = z.object({
  imageBase64: z.string().min(1),
  mediaType:   z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']).default('image/jpeg'),
})

export async function POST(req: Request) {
  try {
    // 1. Authenticated operator REQUIRED. This is a back-office tool used by the
    //    restaurateur while composing their own menu — there is no anonymous use
    //    case. No `.catch(() => undefined)`: a resolution failure is a refusal,
    //    never a silent downgrade to an unattributed (unquota'd) call.
    const operator = await callerOperator()
    if (!operator) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
    const operatorId = operator.id

    // 2. Anti-burst throttle, AFTER the auth gate on purpose — but for the ordering
    //    reason ONLY: it keeps already-rejected anonymous traffic from writing into a
    //    bucket at all. That ordering does NOT, on its own, stop two callers from
    //    sharing a budget, so the bucket is sub-keyed by the authenticated operator:
    //    `menu_scan_dish:<last-hop-ip>:<operatorId>` (lib/rate-limit.ts consume(),
    //    the same `extraKey` mechanism GET /api/loyalty/wallet uses). Two partners
    //    behind one NAT / co-working / dark-kitchen egress — or every partner at once
    //    if the proxy chain strips x-forwarded-for and lib/rate-limit falls back to
    //    its shared 'unknown' bucket, which matters since RATE_LIMIT_ENABLED is
    //    already true on staging — no longer eat each other's 10 scans/minute.
    //    Honest limit of the burst layer: an authenticated abuser who rotates IPs
    //    still mints fresh buckets; the per-operator LLM quota below is the cost layer
    //    that survives that, and it is the one that cannot be rotated around.
    //    Defaults are deliberately tight: ONE scan is a Sonnet VISION call (the most
    //    expensive task in the gateway, TASKS.dish_scan) and a human uploads a photo,
    //    waits for the analysis, then reviews it — a real operator never exceeds a
    //    handful per minute. Tunable via RATE_LIMIT_MENU_SCAN_DISH_MAX /
    //    RATE_LIMIT_MENU_SCAN_DISH_WINDOW_SEC; NO-OP while RATE_LIMIT_ENABLED is OFF.
    const limited = rateLimit(req, 'menu_scan_dish', {
      extraKey:      operatorId,
      limitDefault:  10,
      windowDefault: 60,
    })
    if (limited) return limited

    // 2b. Cheap header pre-check, BEFORE req.json(). App Router route handlers have no
    //     equivalent of the Pages API `bodyParser.sizeLimit`, so `await req.json()`
    //     buffers AND parses the whole body first: the 8 MB bound in step 3 protects
    //     the LLM bill but not the Node heap, where a 200 MB base64 string would
    //     already be resident (twice) by the time it is refused. Content-Length is
    //     advisory — absent on a chunked request, and a client may lie — so this is a
    //     short-circuit, never the authoritative bound: step 3 stays in place and
    //     every honest payload behaves exactly as before. Margin 1.4× ≈ base64's +33 %
    //     plus the JSON envelope, so a legitimate 8 MB image is never caught here.
    const declaredBytes = Number(req.headers.get('content-length') || 0)
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_IMAGE_BYTES * 1.4) {
      return NextResponse.json({ error: 'Image trop lourde (8 Mo maximum).' }, { status: 413 })
    }

    const body = await req.json()
    const { imageBase64, mediaType } = schema.parse(body)

    // 3. Input bound. The gateway's MAX_INPUT_CHARS backstop only truncates TEXT —
    //    image blocks pass through untouched (lib/llm/index.ts:131-136), so without
    //    this check a 50 MB base64 blob went straight to the vision model. Reuses the
    //    dish-photo cap (8 MB decoded) so every dish-image path in the app shares one
    //    limit, and the cheap size estimate from lib/menu-extract so an oversized
    //    payload is refused without allocating its DECODED buffer (the encoded string
    //    itself is already resident by now — that is what step 2b short-circuits).
    //    AUTHORITATIVE bound: reached for every request that gets past 2b.
    if (base64Bytes(imageBase64) > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: 'Image trop lourde (8 Mo maximum).' }, { status: 413 })
    }

    const content: LlmContent = [
      {
        type:   'image',
        source: { type: 'base64', media_type: mediaType, data: imageBase64 },
      },
      {
        type: 'text',
        text: 'Analyze this dish photo. Return ONLY valid JSON (no markdown, no extra text) with this exact structure: {"name":"dish name in French","description":"appetizing 1-2 sentences in French","ingredients":["ingredient1","ingredient2"],"allergens":["only from: Gluten,Lactose,Oeuf,Soja,Arachide,Fruits a coque,Poisson,Crustaces,Mollusques,Celeri,Moutarde,Sesame,Sulfites,Lupin"],"calories_min":number,"calories_max":number,"category":"one of: Entrées,Plats,Desserts,Boissons","suggested_labels":["from: Veggie,Halal,Sans gluten,Épicé"]}',
      },
    ]
    // 4. operatorId is a plain string now (never undefined) → llmComplete ALWAYS runs
    //    the per-partner quota check before spending anything.
    const { text: raw } = await llmComplete({ task: 'dish_scan', content, operatorId })
    const clean = raw.replace(/```json\n?|\n?```/g, '').trim()
    const json  = JSON.parse(clean)

    return NextResponse.json(json)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message }, { status: 400 })
    }
    if (err instanceof LlmQuotaError) {
      return NextResponse.json({ error: 'Limite IA atteinte, réessaie plus tard.' }, { status: 429 })
    }
    console.error('scan-dish:', err)
    return NextResponse.json({ error: "Erreur lors de l'analyse" }, { status: 500 })
  }
}
