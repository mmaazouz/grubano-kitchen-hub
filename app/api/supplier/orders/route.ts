import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { callerSupplierProfile } from '@/lib/supplier-account'
import { isSupplierEnabled } from '@/lib/supplier-account'

export const dynamic = 'force-dynamic'

// ── GET /api/supplier/orders — incoming B2B orders (supplier side, Slice 2) ───
// The connected supplier reads the SupplyOrders placed TO them, scoped to their
// SupplierProfile (from the session — never a client id), so a supplier only ever
// sees its own incoming orders. READ-ONLY here (status flow = Slice 3).

export async function GET() {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isSupplierEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const profile = await callerSupplierProfile()
  if (!profile) return NextResponse.json({ error: 'Profil fournisseur introuvable' }, { status: 401 })

  const orders = await prisma.supplyOrder.findMany({
    where:   { supplierProfileId: profile.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, status: true, totalCents: true, notes: true, desiredDate: true, createdAt: true,
      operator: { select: { name: true, city: true } }, // the buyer (restaurateur)
      lines: {
        select: { nameSnapshot: true, unitSnapshot: true, quantity: true, unitPriceCents: true, lineTotalCents: true },
      },
    },
  })

  return NextResponse.json({ orders })
}
