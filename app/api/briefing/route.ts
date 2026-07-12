import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { llmComplete, LlmQuotaError } from '@/lib/llm'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'

// Session-dependent (per-establishment) — never prerender/cache.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // 🔒 SEC (cross-tenant PII). This endpoint had NO auth gate (GET with no req)
    // and NO tenant scoping: an ANONYMOUS caller obtained today's reservations —
    // customerName + allergies (RGPD art. 9 health data) — plus stock levels and
    // revenue of EVERY establishment on the platform. Now gated to the connected
    // restaurateur (restaurant/admin) and every query is scoped to THEIR OWN
    // establishments (brand.operatorId for stock/loyalty, ownedIds for bookings).
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const { operatorId, ownedIds } = scope

    const now      = new Date()
    const today    = new Date(now); today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)

    // Gather context from DB — every read fenced to the caller's own tenant.
    const [stockItems, reservations, todayOrders] = await Promise.all([
      prisma.stockItem.findMany({
        where:   { brand: { operatorId } },
        orderBy: { name: 'asc' },
      }),
      prisma.reservation.findMany({
        where:   { restaurantId: { in: ownedIds }, date: { gte: today, lt: tomorrow }, status: { notIn: ['cancelled', 'noshow'] } },
        include: { table: { select: { name: true } } },
        orderBy: { date: 'asc' },
      }),
      prisma.loyaltyOrder.findMany({
        where:   { brand: { operatorId }, validatedAt: { gte: today, lt: tomorrow } },
        include: { brand: { select: { name: true } } },
      }),
    ])

    // Low stock items
    const lowStock = stockItems.filter(i => i.quantity <= i.minThreshold * 1.2 && i.minThreshold > 0)

    // Build context string for Claude
    const todayDate     = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(now)
    const caToday       = todayOrders.reduce((s, o) => s + o.amount, 0)
    const reservCount   = reservations.length
    const guestCount    = reservations.reduce((s, r) => s + r.guests, 0)
    const lowStockList  = lowStock.map(i => `${i.name}: ${i.quantity}${i.unit} (seuil: ${i.minThreshold}${i.unit})`).join(', ')
    const resaList      = reservations
      .slice(0, 5)
      .map(r => `${new Date(r.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} ${r.customerName} (${r.guests} pers.) – ${r.table.name}`)
      .join('\n')

    const prompt = `Tu es l'assistant IA d'un restaurant dark kitchen. Aujourd'hui c'est ${todayDate}.

Données du jour :
- CA validé aujourd'hui : €${caToday.toFixed(2)} (${todayOrders.length} commandes)
- Réservations ce soir : ${reservCount} (${guestCount} couverts)${resaList ? `\n${resaList}` : ''}
- Stocks sous le seuil : ${lowStockList || 'aucun'}

Génère un briefing matinal en français avec :
1. Une phrase d'accueil concise (1 phrase)
2. Les 3 priorités du jour (numérotées)
3. Un conseil actionnable basé sur les données

Sois concis, direct et professionnel. Maximum 120 mots au total.`

    // Per-partner LLM quota attribution — the authenticated caller (scope above).
    const { text } = await llmComplete({ task: 'briefing', content: prompt, operatorId })
    const briefing = text.trim()

    return NextResponse.json({
      briefing,
      lowStock: lowStock.map(i => ({
        name:         i.name,
        quantity:     i.quantity,
        unit:         i.unit,
        minThreshold: i.minThreshold,
      })),
      reservations: reservations.slice(0, 5).map(r => ({
        time:         new Date(r.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        customerName: r.customerName,
        guests:       r.guests,
        table:        r.table.name,
        status:       r.status,
        allergies:    r.allergies,
      })),
      kpis: {
        caToday:      Math.round(caToday * 100) / 100,
        ordersToday:  todayOrders.length,
        reservations: reservCount,
        guests:       guestCount,
      },
      generatedAt: now.toISOString(),
    })
  } catch (err) {
    if (err instanceof LlmQuotaError) {
      return NextResponse.json({ error: 'Limite IA atteinte, réessaie plus tard.' }, { status: 429 })
    }
    console.error('briefing error:', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
