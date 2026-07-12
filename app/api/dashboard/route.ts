import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { loyaltyCustomerWhereForOperator } from '@/lib/customer-scope'

// Session-dependent (per-operator revenue) — never prerender/cache.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // 🔒 SEC (cross-tenant revenue leak). Legacy dashboard endpoint — like
    // /api/analytics + /api/briefing it had NO auth and NO scoping, so an
    // anonymous caller read the platform-wide CA + loyalty-member count. Now gated
    // to the connected restaurateur and scoped to THEIR OWN brands/customers.
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const { operatorId } = scope

    const today    = new Date(); today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)

    // ── Commandes du jour ────────────────────────────────────────────────────
    const ordersToday = await prisma.loyaltyOrder.findMany({
      where: { brand: { operatorId }, validatedAt: { gte: today, lt: tomorrow } },
      include: { brand: { select: { name: true } } },
    })

    const caJour       = ordersToday.reduce((s, o) => s + o.amount, 0)
    const commandesJour = ordersToday.length

    // ── Clients fidélité (scopés aux clients de l'opérateur) ─────────────────
    const clientsFidelite = await prisma.loyaltyCustomer.count({
      where: await loyaltyCustomerWhereForOperator(operatorId),
    })

    // ── Meilleure marque (CA du jour) ────────────────────────────────────────
    const caParMarque: Record<string, number> = {}
    for (const o of ordersToday) {
      const nom = o.brand.name
      caParMarque[nom] = (caParMarque[nom] ?? 0) + o.amount
    }
    const [meilleurMarque, meilleurCA] = Object.entries(caParMarque)
      .sort((a, b) => b[1] - a[1])[0] ?? ['Gnocchi Bar', 0]

    const totalCA = caJour || 1   // évite division par zéro
    const pctMeilleur = meilleurCA
      ? `${Math.round((meilleurCA / totalCA) * 100)} % du CA`
      : '66 % du CA'

    // ── Évolution J-1 ────────────────────────────────────────────────────────
    const yesterday    = new Date(today); yesterday.setDate(today.getDate() - 1)
    const ordersYday   = await prisma.loyaltyOrder.findMany({
      where: { brand: { operatorId }, validatedAt: { gte: yesterday, lt: today } },
    })
    const caYday        = ordersYday.reduce((s, o) => s + o.amount, 0)
    const evoCaPct      = caYday > 0 ? Math.round(((caJour - caYday) / caYday) * 100) : null

    return NextResponse.json({
      caJour,
      commandesJour,
      clientsFidelite,
      meilleurMarque: meilleurCA > 0 ? meilleurMarque : 'Gnocchi Bar',
      pctMeilleur,
      evoCaPct,
      commandesYday: ordersYday.length,
    })
  } catch (err) {
    // DB non connectée → valeurs par défaut (non bloquant)
    console.error('[api/dashboard]', err)
    return NextResponse.json({
      caJour: 0, commandesJour: 0, clientsFidelite: 0,
      meilleurMarque: 'Gnocchi Bar', pctMeilleur: '66 % du CA',
      evoCaPct: null, commandesYday: 0,
    })
  }
}
