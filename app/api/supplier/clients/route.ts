import { NextResponse } from 'next/server'
import { callerSupplierProfile } from '@/lib/supplier-account'
import { aggregateSupplierClients } from '@/lib/supplier-clients'

export const dynamic = 'force-dynamic'

// ── GET /api/supplier/clients — the supplier's client directory (B4, READ-ONLY) ──
// A "client" is a restaurant (buyer Operator) that has ordered from this supplier.
// Aggregated from the caller's own SupplyOrders (scoped to their SupplierProfile,
// resolved from the SESSION — never a client-supplied id → no IDOR). CENTS only,
// display-only downstream. Pure read: no money is moved, nothing is written.

export async function GET() {
  const profile = await callerSupplierProfile()
  if (!profile) return NextResponse.json({ error: 'Profil fournisseur introuvable' }, { status: 401 })

  const clients = await aggregateSupplierClients(profile.id)
  return NextResponse.json({ clients })
}
