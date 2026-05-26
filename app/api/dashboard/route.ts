import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const today    = new Date(); today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)

    // ── Commandes du jour ────────────────────────────────────────────────────
    const ordersToday = await prisma.loyaltyOrder.findMany({
      where: { validatedAt: { gte: today, lt: tomorrow } },
      include: { brand: { select: { name: true } } },
    })

    const caJour       = ordersToday.reduce((s, o) => s + o.amount, 0)
    const commandesJour = ordersToday.length

    // ── Clients fidélité ─────────────────────────────────────────────────────
    const clientsFidelite = await prisma.loyaltyCustomer.count()

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
      where: { validatedAt: { gte: yesterday, lt: today } },
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
