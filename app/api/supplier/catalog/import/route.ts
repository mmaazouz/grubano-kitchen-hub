import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { callerSupplierProfile } from '@/lib/supplier-account'
import { parseCatalogCsv } from '@/lib/supplier-catalog'

export const dynamic = 'force-dynamic'

// ── POST /api/supplier/catalog/import — bulk CSV import (Slice 1) ──────────────
// Body: { csv: string } (the file content; the client reads the file → text). The
// CSV is parsed (lib/supplier-catalog.parseCatalogCsv): valid rows are created in
// ONE createMany scoped to the caller's profile; INVALID rows are REPORTED (line +
// reason), never silently dropped. Items whose name already exists in the
// supplier's catalogue are SKIPPED (skipDuplicates) — never overwritten. Requires
// an ACTIVE supplier profile (scoped from the session).

const bodySchema = z.object({ csv: z.string().min(1).max(1_000_000) })

export async function POST(req: Request) {
  try {
    const profile = await callerSupplierProfile()
    if (!profile) return NextResponse.json({ error: 'Profil fournisseur introuvable' }, { status: 401 })
    if (profile.status !== 'active') return NextResponse.json({ error: 'Compte fournisseur non activé' }, { status: 403 })

    const { csv } = bodySchema.parse(await req.json())
    const { valid, errors } = parseCatalogCsv(csv)

    let created = 0
    if (valid.length) {
      const res = await prisma.supplierCatalogItem.createMany({
        data: valid.map((v) => ({
          supplierProfileId: profile.id,
          name:        v.name,
          description: v.description ?? null,
          category:    v.category,
          priceCents:  v.priceCents,
          unit:        v.unit,
          packSize:    v.packSize ?? null,
          available:   v.available,
          allergens:   v.allergens,
        })),
        skipDuplicates: true, // existing names are kept, never overwritten
      })
      created = res.count
    }

    return NextResponse.json({
      created,
      attempted: valid.length,
      skipped:   valid.length - created, // valid rows whose name already existed
      invalid:   errors.length,
      errors,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Fichier CSV invalide' }, { status: 400 })
    }
    console.error('[POST /api/supplier/catalog/import]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
