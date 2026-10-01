import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { processDishImage, ALLOWED_IMAGE_TYPES } from '@/lib/dish-photo'

// Reads the session on EVERY method (the GET included, since it became owner-scoped)
// → never statically prerendered. Same declaration as the sibling menu routes
// (app/api/menu/categories, app/api/menu/[id]/availability, app/api/menu/scan-card).
export const dynamic = 'force-dynamic'

// ── Validation ────────────────────────────────────────────────────────────────

// Nullable optional fields use .nullish() (accepts undefined AND null), NOT
// .optional() (undefined only). The "Manuel" form posts these fields as `null`
// when left blank (newItem() seeds calories: null) — with .optional() that null
// was rejected by Zod → HTTP 400 → the dish was NEVER written to the DB and the
// client swallowed the error. The columns are nullable in Prisma, so null is a
// valid stored value here.
const createSchema = z.object({
  brandId:     z.string().min(1),
  name:        z.string().min(1).max(100),
  description: z.string().max(500).nullish(),
  price:       z.number().positive(),
  comparePrice:z.number().positive().nullish(),
  // Trim the stored category name: prevents " Boissons " from creating a near-duplicate
  // of "Boissons". The server persists exactly the category sent for THIS dish (each
  // request is independent — no remanent state); the "sticky category" bug is the
  // client default logic (Agent 13), not the server.
  category:    z.string().trim().min(1).max(50),
  calories:    z.number().int().positive().nullish(),
  allergens:   z.array(z.string()).default([]),
  labels:      z.array(z.string()).default([]),
  photos:      z.array(z.string()).default([]),
  options:     z.array(z.record(z.unknown())).default([]),
  available:   z.boolean().default(true),
  isPopular:   z.boolean().default(false),
  prepTime:    z.number().int().positive().nullish(),
  // Optional inline photo. When present the server moderates + uploads it and
  // sets photos=[url] at creation (atomic — never a photoless dish on failure).
  imageBase64: z.string().optional(),
  mediaType:   z.enum(ALLOWED_IMAGE_TYPES).optional(),
})

/** Resolve the calling operator from the session — null on any failure. */
async function callerOperator() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true },
  })
}

const updateSchema = createSchema.partial().extend({ id: z.string() })

// ── GET /api/menu?brandId=&category= ──────────────────────────────────────────
// CONTRACT (retained): PARTNER DASHBOARD endpoint — NOT a public catalogue.
// The consumer catalogue is GET /api/restaurants/:id (it applies its own explicit
// `select`, `available: true` and `archivedAt: null` filters); NO consumer code
// path calls /api/menu — its single caller in the repo is the operator screen
// app/[locale]/menu/page.tsx. CLAUDE.md documents this route as `session` for ALL
// methods and does NOT list it among the public routes.
// Until now the GET had NO auth at all (POST/PUT/DELETE were hardened in WP-SEC-02,
// the GET was simply forgotten): a bare `GET /api/menu` returned EVERY MenuItem of
// EVERY operator — full rows, unavailable dishes and unpublished/archived
// establishments included. This aligns the GET on the SAME gate as the mutations:
//   401 anonymous → 403 wrong role → owner-scope, cross-tenant = 404 (never 403,
//   so a foreign brand's existence is never confirmed — same rule as PUT/DELETE).
// Deliberately NOT changed (the partner legitimately needs them on his own screen):
// no restrictive `select`, no `available: true` filter — the dashboard must keep
// showing its out-of-stock dishes and timestamps. Auth + ownership alone close the
// leak, so the legitimate caller's response is byte-identical.
//
// CACHING — the payload became TENANT-PRIVATE the day this gate landed: the same URL
// (`?brandId=…`) now yields different bytes per caller. `dynamic = 'force-dynamic'`
// above settles the Next side; the explicit `Cache-Control: private, no-store` on the
// 200 settles the SHARED caches in front of the app (LiteSpeed/Apache on o2switch, any
// CDN), which key on the URL alone and would otherwise be free to hand operator A's
// card to operator B. The client already sends `cache: 'no-store'`
// (app/[locale]/menu/page.tsx) — that only covers the browser, not the hops between.

/** Unscoped-read ceiling (admin, no brandId): the page size such a call falls back to
 *  when it asks for no explicit window. Owner-scoped reads are NOT capped by default —
 *  a partner must always see his ENTIRE card, so his response stays byte-identical. */
const UNSCOPED_DEFAULT_TAKE = 500
/** Hard ceiling for an explicit `?take=` — a client cannot raise the bound. */
const MAX_TAKE = 500

/** Positive int from a query param, else null (absent / empty / NaN / ≤ 0). */
function intParam(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

export async function GET(req: Request) {
  try {
    const operator = await callerOperator()
    if (!operator) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const brandId  = searchParams.get('brandId')
    const category = searchParams.get('category')

    const where: Record<string, unknown> = {}
    if (category) where.category = category

    if (brandId) {
      // Ownership check on the requested brand (same findFirst as POST). 404 —
      // NOT 403 and NOT an empty list — on a foreign brand, mirroring PUT/DELETE:
      // an unknown brandId and a foreign one become indistinguishable, so the
      // route stops being an existence oracle.
      const brand = await prisma.brand.findFirst({
        where: operator.role === 'admin'
          ? { id: brandId }
          : { id: brandId, operatorId: operator.id },
        select: { id: true },
      })
      if (!brand) {
        return NextResponse.json({ error: 'Marque introuvable' }, { status: 404 })
      }
      where.brandId = brandId
    } else if (operator.role !== 'admin') {
      // No brandId → bound to the caller's OWN brands. Without this the query was
      // `where: {}` with no take/skip: a single call dumped the whole platform
      // catalogue. Menu ownership is via Brand.operatorId (a MenuItem has no
      // restaurantId — same rule as the mutations). Admin keeps the unscoped read.
      where.brand = { operatorId: operator.id }
    }

    // Bound the read. The cross-tenant leak is closed above, but the ADMIN branch
    // still reaches `where: {}` — i.e. every MenuItem row of every operator, full
    // rows (Json allergens/labels/photos/options included), materialised in one
    // Passenger process. `take`/`skip` are now accepted from any caller and clamped
    // to MAX_TAKE (a client cannot widen the window), and an UNSCOPED read that asks
    // for nothing falls back to a first page instead of the whole table.
    // Deliberately NOT defaulted on the owner-scoped branch: silently truncating a
    // partner's own card would be a worse regression than the risk being closed, and
    // that branch is bounded by one operator's catalogue anyway. Net effect for the
    // single real caller (app/[locale]/menu/page.tsx — always a brandId it owns, never
    // take/skip): NO take, NO skip, response byte-identical.
    const isUnscoped = !brandId && operator.role === 'admin'
    const takeParam  = intParam(searchParams.get('take'))
    const skipParam  = intParam(searchParams.get('skip'))
    const take       = takeParam !== null
      ? Math.min(takeParam, MAX_TAKE)
      : (isUnscoped ? UNSCOPED_DEFAULT_TAKE : undefined)

    const items = await prisma.menuItem.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      ...(take !== undefined ? { take } : {}),
      ...(skipParam !== null ? { skip: skipParam } : {}),
    })

    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── POST /api/menu ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    // Owner-scope the creation: only an authenticated restaurant/admin can add a
    // dish, and only to a brand they own. The brandId comes from the body but is
    // VERIFIED against the session operator — never trusted blindly.
    const operator = await callerOperator()
    if (!operator) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const body = await req.json()
    const { imageBase64, mediaType, ...data } = createSchema.parse(body)

    const brand = await prisma.brand.findFirst({
      where: operator.role === 'admin'
        ? { id: data.brandId }
        : { id: data.brandId, operatorId: operator.id },
      select: { id: true },
    })
    if (!brand) {
      return NextResponse.json({ error: 'Marque introuvable ou non autorisée' }, { status: 400 })
    }

    // Optional inline photo. Run the full chain (moderate → upload → square)
    // BEFORE creating the dish; on ANY failure return the error and DO NOT create
    // a photoless dish silently. On success photos = [square Cloudinary URL].
    //
    // P1-SEC (cost governance) — `operator.id` is now handed down the chain. The
    // moderation step is `dish_moderation`: a SONNET VISION call, the SAME unit cost
    // as the `dish_scan` this route's sibling gates. lib/llm/index.ts only enforces
    // the per-partner quota `if (input.operatorId && …)`, so without this argument the
    // exact hole just closed on POST /api/menu/scan-dish stayed wide open one file
    // away: an operator 429'd on scan-dish could loop on POST /api/menu with an
    // `imageBase64` and keep billing Sonnet calls that were neither blocked NOR even
    // counted (LlmUsage was written with operatorId null, and lib/llm/quota.ts
    // aggregates `where: { operatorId }`). This route has no rate limit either, so
    // the quota is the ONLY cost layer here — hence it must actually apply.
    // The id comes from the SESSION-resolved operator above, never from the body.
    let photos = data.photos
    let warnings: string[] = []
    if (imageBase64) {
      const result = await processDishImage(imageBase64, mediaType ?? 'image/jpeg', operator.id)
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, ...(result.moderation ? { moderation: result.moderation } : {}) },
          { status: result.status },
        )
      }
      photos   = [result.url]
      warnings = result.warnings
    }

    const item = await prisma.menuItem.create({
      data: { ...data, photos } as unknown as Prisma.MenuItemUncheckedCreateInput,
    })

    return NextResponse.json({ item, warnings }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    // FK / record-not-found at the DB level → a client data problem, surface a
    // clean 400 instead of an opaque 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2003' || err.code === 'P2025')) {
      return NextResponse.json({ error: 'Marque invalide — plat non créé.' }, { status: 400 })
    }
    console.error('[POST /api/menu]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── PUT /api/menu ─────────────────────────────────────────────────────────────

export async function PUT(req: Request) {
  try {
    // Owner-scope the update: only the authenticated restaurant/admin that OWNS the
    // dish's brand may edit it — previously this route had NO auth, so any caller
    // could mutate any menu item by id (IDOR). Menu ownership is via Brand.operatorId
    // (mirrors POST above; NOT establishment-scope — a MenuItem has no restaurantId).
    const operator = await callerOperator()
    if (!operator) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const body = await req.json()
    const { id, ...data } = updateSchema.parse(body)

    // 404 (not 403) cross-tenant: a foreign dish's existence is not confirmed.
    const existing = await prisma.menuItem.findUnique({
      where:  { id },
      select: { id: true, brand: { select: { operatorId: true } } },
    })
    if (!existing || (operator.role !== 'admin' && existing.brand.operatorId !== operator.id)) {
      return NextResponse.json({ error: 'Plat introuvable' }, { status: 404 })
    }

    const item = await prisma.menuItem.update({
      where: { id },
      data:  data as unknown as Prisma.MenuItemUncheckedUpdateInput,
    })

    return NextResponse.json({ item })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── DELETE /api/menu?id= ──────────────────────────────────────────────────────

export async function DELETE(req: Request) {
  try {
    // Owner-scope the delete (same IDOR fix as PUT: this route had NO auth).
    const operator = await callerOperator()
    if (!operator) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

    // 404 (not 403) cross-tenant: a foreign dish's existence is not confirmed.
    const existing = await prisma.menuItem.findUnique({
      where:  { id },
      select: { id: true, brand: { select: { operatorId: true } } },
    })
    if (!existing || (operator.role !== 'admin' && existing.brand.operatorId !== operator.id)) {
      return NextResponse.json({ error: 'Plat introuvable' }, { status: 404 })
    }

    await prisma.menuItem.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
