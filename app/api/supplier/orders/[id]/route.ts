import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { callerSupplierProfile } from '@/lib/supplier-account'
import { canTransition } from '@/lib/marketplace'
import { isSupplierEnabled } from '@/lib/supplier-account'

export const dynamic = 'force-dynamic'

// ── PATCH /api/supplier/orders/[id] — advance an order's status (Slice 3) ─────
// The SUPPLIER moves one of ITS OWN orders along the state machine (lib/marketplace):
// placed → confirmed | declined, confirmed → preparing, preparing → delivered.
// Scoped to callerSupplierProfile + ownership (the order must belong to the caller).
// Only VALID transitions are accepted (409 otherwise). NO financial side-effects.

const bodySchema = z.object({ status: z.string().min(1) })

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isSupplierEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const profile = await callerSupplierProfile()
    if (!profile) return NextResponse.json({ error: 'Profil fournisseur introuvable' }, { status: 401 })

    const { status } = bodySchema.parse(await req.json())

    const order = await prisma.supplyOrder.findUnique({
      where: { id: params.id }, select: { supplierProfileId: true, status: true },
    })
    if (!order) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })
    if (order.supplierProfileId !== profile.id) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
    if (!canTransition('supplier', order.status, status)) {
      return NextResponse.json({ error: 'Transition invalide' }, { status: 409 })
    }

    const updated = await prisma.supplyOrder.update({
      where: { id: params.id }, data: { status }, select: { id: true, status: true },
    })
    return NextResponse.json({ ok: true, order: updated })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Données invalides' }, { status: 400 })
    }
    console.error('[PATCH /api/supplier/orders/[id]]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
