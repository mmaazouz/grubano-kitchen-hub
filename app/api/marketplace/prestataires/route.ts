import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { callerOperator } from '@/lib/operator-session'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { asStringArray, filterPrestataires } from '@/lib/service-offering'

export const dynamic = 'force-dynamic'

// ── GET /api/marketplace/prestataires — SERVICES discovery (resto side, P2) ───
// A CLONE of /api/marketplace/suppliers, adapted to SERVICES. A restaurateur browses the
// directory: ACTIVE prestataires that have ≥1 ACTIVE service offering, each WITH its active
// offerings. Operator-gated (restaurant/admin) — never another tenant's data, no IDOR.
// Optional ?category + ?zone filters (pure lib/service-offering, single-sourced with the
// page + tests). 404s when PRESTATAIRE_ENABLED is OFF (the role does not exist). NO money:
// no quote / order / price — services are « sur devis ».

export async function GET(req: Request) {
  try {
    if (!isPrestataireEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const operator = await callerOperator()
    if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const rows = await prisma.prestataireProfile.findMany({
      where: {
        status:           'active',
        serviceOfferings: { some: { active: true } }, // only directories with ≥1 live service
      },
      select: {
        id: true, companyName: true, city: true,
        serviceCategories: true, coverageZones: true, modality: true, indicativeRate: true,
        serviceOfferings: {
          where:   { active: true },
          select:  { id: true, title: true, description: true, category: true, modality: true, indicativeRate: true },
          orderBy: [{ category: 'asc' }, { title: 'asc' }],
        },
      },
      orderBy: { companyName: 'asc' },
    })

    // serviceCategories / coverageZones are Json columns → normalize to string[] for the
    // pure filter + the client.
    const prestataires = rows.map((p) => ({
      ...p,
      serviceCategories: asStringArray(p.serviceCategories),
      coverageZones:     asStringArray(p.coverageZones),
    }))

    const url = new URL(req.url)
    const filtered = filterPrestataires(prestataires, {
      category: url.searchParams.get('category'),
      zone:     url.searchParams.get('zone'),
    })

    return NextResponse.json({ prestataires: filtered })
  } catch (err) {
    console.error('[GET /api/marketplace/prestataires]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
