import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { MAX_FRANCHISE_ROYALTY_RATE } from '@/lib/franchise-royalty'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

// ── /api/brands/[id] — owner-scoped brand edit / delete ───────────────────────
// Every method requires a valid session AND ownership: the operator id always
// comes from the session, NEVER the body, and a partner may only touch a brand
// whose operatorId matches their own (admins may touch any). Same pattern as
// app/api/menu/[id]/availability/route.ts (Agent 12).

/** Authorize the caller against the target brand. Returns `{ operator, brand }`
 *  on success, or `{ error: NextResponse }` to return immediately. */
async function authorize(brandId: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: 'Non autorisé' }, { status: 401 }) }
  }
  const operator = await prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!operator) {
    return { error: NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 401 }) }
  }
  const brand = await prisma.brand.findUnique({
    where:  { id: brandId },
    select: {
      id: true, operatorId: true, name: true, emoji: true, cuisineType: true, tagline: true, status: true,
      // B4 — franchise conditions (owner-editable below).
      openToFranchise: true, royaltyPct: true, setupFee: true, franchiseZones: true, franchiseStatus: true,
    },
  })
  if (!brand) {
    return { error: NextResponse.json({ error: 'Marque introuvable' }, { status: 404 }) }
  }
  const isOwner = brand.operatorId === operator.id
  const isAdmin = operator.role === 'admin'
  if (!isOwner && !isAdmin) {
    return { error: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) }
  }
  return { operator, brand }
}

// ── GET — single brand editable fields (for the dashboard edit form) ──────────
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize(params.id)
  if ('error' in auth) return auth.error
  const { brand } = auth
  return NextResponse.json({
    brand: {
      id:          brand.id,
      name:        brand.name,
      emoji:       brand.emoji,
      cuisineType: brand.cuisineType,
      tagline:     brand.tagline,
      status:      brand.status,
      // B4 — franchise conditions (fraction royaltyPct; null = 6% default applies).
      openToFranchise: brand.openToFranchise,
      royaltyPct:      brand.royaltyPct,
      setupFee:        brand.setupFee,
      franchiseZones:  Array.isArray(brand.franchiseZones) ? brand.franchiseZones : [],
      franchiseStatus: brand.franchiseStatus,
    },
  })
}

// ── PATCH — edit name / emoji / cuisineType / tagline ─────────────────────────
const patchSchema = z
  .object({
    name:        z.string().min(1).max(80).optional(),
    emoji:       z.string().min(1).max(8).optional(),
    cuisineType: z.string().max(60).optional().nullable(),
    tagline:     z.string().max(140).optional().nullable(),
    // ── B4 — franchise conditions (owner-editable) ───────────────────────────
    // royaltyPct is a FRACTION (0.06 = 6%), bounded [0, MAX]. setupFee in €.
    // franchiseZones = array of city/zone strings. franchiseStatus is an enum.
    openToFranchise: z.boolean().optional(),
    royaltyPct:      z.number().min(0).max(MAX_FRANCHISE_ROYALTY_RATE).nullable().optional(),
    setupFee:        z.number().min(0).max(1_000_000).nullable().optional(),
    franchiseZones:  z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    franchiseStatus: z.enum(['none', 'open', 'full']).optional(),
  })
  // `operatorId`, `status`, etc. are intentionally absent — they can never be
  // changed through this route. zod strips any extra body key by default.

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize(params.id)
  if ('error' in auth) return auth.error

  const json = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Données invalides' },
      { status: 400 },
    )
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 })
  }

  const brand = await prisma.brand.update({
    where: { id: params.id }, // ownership already proven by authorize()
    data:  parsed.data,
    select: {
      id: true, name: true, emoji: true, cuisineType: true, tagline: true, status: true,
      openToFranchise: true, royaltyPct: true, setupFee: true, franchiseZones: true, franchiseStatus: true,
    },
  })
  return NextResponse.json({ ok: true, brand })
}

// ── DELETE — remove a brand, with safety guards ───────────────────────────────
// Soft-guards (return 409, never a hard 500):
//   - the brand still has menu items (live products),
//   - it's the operator's LAST brand while their restaurant is live (isActive),
//   - any other FK-bound data (orders, adoptions, promotions…) → caught as
//     'has_related_data' so the partner gets a clear message, not a crash.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize(params.id)
  if ('error' in auth) return auth.error
  const { operator } = auth

  const [menuCount, brandCount, restaurant] = await Promise.all([
    prisma.menuItem.count({ where: { brandId: params.id } }),
    prisma.brand.count({ where: { operatorId: operator.id } }),
    prisma.restaurant.findFirst({ where: { operatorId: operator.id }, select: { isActive: true } }),
  ])

  if (menuCount > 0) {
    return NextResponse.json(
      { ok: false, reason: 'has_menu_items', count: menuCount, error: 'La marque contient encore des plats.' },
      { status: 409 },
    )
  }
  if (brandCount <= 1 && restaurant?.isActive) {
    return NextResponse.json(
      { ok: false, reason: 'last_brand_active_restaurant', error: 'Impossible de supprimer la dernière marque d’un restaurant en ligne.' },
      { status: 409 },
    )
  }

  try {
    await prisma.brand.delete({ where: { id: params.id } })
  } catch (err) {
    // FK constraint (orders / adoptions / promotions / stock referencing it).
    console.error('[DELETE /api/brands/:id]', err)
    return NextResponse.json(
      { ok: false, reason: 'has_related_data', error: 'La marque a des données liées et ne peut pas être supprimée.' },
      { status: 409 },
    )
  }
  return NextResponse.json({ ok: true })
}
