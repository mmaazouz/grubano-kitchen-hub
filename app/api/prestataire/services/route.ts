import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isPrestataireEnabled, callerPrestataireProfile } from '@/lib/prestataire-account'
import { SERVICE_CATEGORIES, SERVICE_MODALITIES } from '@/lib/service-offering'

export const dynamic = 'force-dynamic'

// ── /api/prestataire/services — the connected prestataire's OWN service listings (P2) ──
// A CLONE of /api/supplier/catalog, adapted to SERVICES. Every operation is scoped to the
// caller's PrestataireProfile, resolved from the SESSION (callerPrestataireProfile) — never
// a client-supplied id — so a prestataire can only ever read/write ITS OWN offerings (no
// IDOR). NO money: a service has NO price and NO stock (title + description + category +
// intervention modality + a free-text « sur devis » indicative rate). Mutations require an
// ACTIVE profile. The WHOLE route 404s when PRESTATAIRE_ENABLED is OFF (the role does not
// exist) — defence in depth, byte-identical to non-existent.

const NOT_FOUND   = NextResponse.json({ error: 'Not found' }, { status: 404 })
const UNAUTH      = NextResponse.json({ error: 'Profil prestataire introuvable' }, { status: 401 })
const NOT_ACTIVE  = NextResponse.json({ error: 'Compte prestataire non activé' }, { status: 403 })
const DUP         = NextResponse.json({ error: 'Un service porte déjà ce titre dans votre liste.' }, { status: 409 })

const offeringSchema = z.object({
  title:          z.string().trim().min(1, 'Titre requis').max(150),
  description:    z.string().max(2000).nullish(),
  category:       z.enum(SERVICE_CATEGORIES).default('other'),
  modality:       z.enum(SERVICE_MODALITIES).default('on_site'),
  indicativeRate: z.string().max(200).nullish(),
  // P8b — optional FORFAIT price in CENTS. null = « sur devis ». When set, the offering becomes
  // orderable + payable upfront (the charge derives from this server value, never the buyer).
  fixedPriceCents: z.number().int().positive().max(100_000_000).nullish(),
  active:         z.boolean().default(true),
})
const updateSchema = offeringSchema.partial().extend({ id: z.string().min(1) })

export async function GET() {
  if (!isPrestataireEnabled()) return NOT_FOUND
  const profile = await callerPrestataireProfile()
  if (!profile) return UNAUTH
  const items = await prisma.serviceOffering.findMany({
    where:   { prestataireProfileId: profile.id },
    orderBy: [{ category: 'asc' }, { title: 'asc' }],
  })
  return NextResponse.json({ items })
}

export async function POST(req: Request) {
  if (!isPrestataireEnabled()) return NOT_FOUND
  try {
    const profile = await callerPrestataireProfile()
    if (!profile) return UNAUTH
    if (profile.status !== 'active') return NOT_ACTIVE

    const data = offeringSchema.parse(await req.json())
    const item = await prisma.serviceOffering.create({
      data: {
        prestataireProfileId: profile.id, // ← from the SESSION, never the body
        title:          data.title,
        description:    data.description?.trim() || null,
        category:       data.category,
        modality:       data.modality,
        indicativeRate: data.indicativeRate?.trim() || null,
        fixedPriceCents: data.fixedPriceCents ?? null,
        active:         data.active,
      },
    })
    return NextResponse.json({ item }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return DUP
    console.error('[POST /api/prestataire/services]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  if (!isPrestataireEnabled()) return NOT_FOUND
  try {
    const profile = await callerPrestataireProfile()
    if (!profile) return UNAUTH
    if (profile.status !== 'active') return NOT_ACTIVE

    const { id, ...rest } = updateSchema.parse(await req.json())

    // Ownership: the offering must belong to the CALLER's profile (never another's).
    const existing = await prisma.serviceOffering.findUnique({
      where: { id }, select: { prestataireProfileId: true },
    })
    if (!existing) return NextResponse.json({ error: 'Service introuvable' }, { status: 404 })
    if (existing.prestataireProfileId !== profile.id) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const data: Prisma.ServiceOfferingUncheckedUpdateInput = {}
    if (rest.title !== undefined)          data.title = rest.title
    if (rest.description !== undefined)    data.description = rest.description?.trim() || null
    if (rest.category !== undefined)       data.category = rest.category
    if (rest.modality !== undefined)       data.modality = rest.modality
    if (rest.indicativeRate !== undefined) data.indicativeRate = rest.indicativeRate?.trim() || null
    if (rest.fixedPriceCents !== undefined) data.fixedPriceCents = rest.fixedPriceCents ?? null
    if (rest.active !== undefined)         data.active = rest.active

    const item = await prisma.serviceOffering.update({ where: { id }, data })
    return NextResponse.json({ item })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return DUP
    console.error('[PATCH /api/prestataire/services]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  if (!isPrestataireEnabled()) return NOT_FOUND
  try {
    const profile = await callerPrestataireProfile()
    if (!profile) return UNAUTH
    if (profile.status !== 'active') return NOT_ACTIVE

    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

    const existing = await prisma.serviceOffering.findUnique({
      where: { id }, select: { prestataireProfileId: true },
    })
    if (!existing) return NextResponse.json({ error: 'Service introuvable' }, { status: 404 })
    if (existing.prestataireProfileId !== profile.id) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    await prisma.serviceOffering.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/prestataire/services]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
