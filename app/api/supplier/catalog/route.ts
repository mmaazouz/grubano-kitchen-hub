import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { callerSupplierProfile } from '@/lib/supplier-account'
import { maybeRunSupplierCoherenceCheck } from '@/lib/supplier-coherence'
import { CATALOG_UNITS, eurosToCents, normalizeAllergens } from '@/lib/supplier-catalog'
import { isSupplierEnabled } from '@/lib/supplier-account'

export const dynamic = 'force-dynamic'

// ── /api/supplier/catalog — the connected supplier's OWN catalogue (Slice 1) ──
// Every operation is scoped to the caller's SupplierProfile, resolved from the
// SESSION (callerSupplierProfile) — never a client-supplied id — so a supplier can
// only ever read/write its own items. Prices arrive in EUROS and are stored in
// integer CENTS (lib/supplier-catalog). Mutations require an ACTIVE profile.
// Distinct from the operator's private /api/suppliers directory.

const itemSchema = z.object({
  name:        z.string().trim().min(1, 'Nom requis').max(150),
  description: z.string().max(1000).nullish(),
  category:    z.string().trim().min(1).max(60).default('autre'),
  priceEur:    z.number().min(0).max(100000),
  unit:        z.enum(CATALOG_UNITS),
  packSize:    z.string().max(80).nullish(),
  available:   z.boolean().default(true),
  allergens:   z.array(z.string()).default([]),
})
const updateSchema = itemSchema.partial().extend({ id: z.string().min(1) })

const UNAUTH = NextResponse.json({ error: 'Profil fournisseur introuvable' }, { status: 401 })
const NOT_ACTIVE = NextResponse.json({ error: 'Compte fournisseur non activé' }, { status: 403 })

export async function GET() {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isSupplierEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const profile = await callerSupplierProfile()
  if (!profile) return UNAUTH
  const items = await prisma.supplierCatalogItem.findMany({
    where:   { supplierProfileId: profile.id },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })
  return NextResponse.json({ items })
}

export async function POST(req: Request) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isSupplierEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const profile = await callerSupplierProfile()
    if (!profile) return UNAUTH
    if (profile.status !== 'active') return NOT_ACTIVE

    const data = itemSchema.parse(await req.json())
    const item = await prisma.supplierCatalogItem.create({
      data: {
        supplierProfileId: profile.id, // ← from the SESSION, never the body
        name:        data.name,
        description: data.description ?? null,
        category:    data.category,
        priceCents:  eurosToCents(data.priceEur) ?? 0,
        unit:        data.unit,
        packSize:    data.packSize ?? null,
        available:   data.available,
        allergens:   normalizeAllergens(data.allergens),
      },
    })
    // Lean signup étape 2 (Agent 111): adding a catalogue item may complete the "ready to
    // publish" transition (offer filled + ≥1 item) → run the DEPLACED coherence check once.
    // Best-effort + idempotent + quota-safe: never throws, runs vetSupplier at most once,
    // only flips the marketplace-visibility flag (never status/auth/money).
    await maybeRunSupplierCoherenceCheck(profile.id)
    return NextResponse.json({ item }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'Un produit porte déjà ce nom dans ton catalogue.' }, { status: 409 })
    }
    console.error('[POST /api/supplier/catalog]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isSupplierEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const profile = await callerSupplierProfile()
    if (!profile) return UNAUTH
    if (profile.status !== 'active') return NOT_ACTIVE

    const { id, ...rest } = updateSchema.parse(await req.json())

    // Ownership: the item must belong to the CALLER's profile (never another's).
    const existing = await prisma.supplierCatalogItem.findUnique({
      where: { id }, select: { supplierProfileId: true },
    })
    if (!existing) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })
    if (existing.supplierProfileId !== profile.id) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const data: Prisma.SupplierCatalogItemUncheckedUpdateInput = {}
    if (rest.name !== undefined)        data.name = rest.name
    if (rest.description !== undefined) data.description = rest.description ?? null
    if (rest.category !== undefined)    data.category = rest.category
    if (rest.priceEur !== undefined)    data.priceCents = eurosToCents(rest.priceEur) ?? 0
    if (rest.unit !== undefined)        data.unit = rest.unit
    if (rest.packSize !== undefined)    data.packSize = rest.packSize ?? null
    if (rest.available !== undefined)   data.available = rest.available
    if (rest.allergens !== undefined)   data.allergens = normalizeAllergens(rest.allergens)

    const item = await prisma.supplierCatalogItem.update({ where: { id }, data })
    return NextResponse.json({ item })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'Un produit porte déjà ce nom dans ton catalogue.' }, { status: 409 })
    }
    console.error('[PUT /api/supplier/catalog]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isSupplierEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const profile = await callerSupplierProfile()
    if (!profile) return UNAUTH
    if (profile.status !== 'active') return NOT_ACTIVE

    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

    const existing = await prisma.supplierCatalogItem.findUnique({
      where: { id }, select: { supplierProfileId: true },
    })
    if (!existing) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })
    if (existing.supplierProfileId !== profile.id) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    await prisma.supplierCatalogItem.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/supplier/catalog]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
