import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { llmComplete, LlmQuotaError } from '@/lib/llm'
import { callerOperator } from '@/lib/operator-session'

export async function GET() {
  try {
    const now      = new Date()
    const today    = new Date(now); today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)

    // Gather context from DB
    const [stockItems, reservations, todayOrders] = await Promise.all([
      prisma.stockItem.findMany({ orderBy: { name: 'asc' } }),
      prisma.reservation.findMany({
        where:   { date: { gte: today, lt: tomorrow }, status: { notIn: ['cancelled', 'noshow'] } },
        include: { table: { select: { name: true } } },
        orderBy: { date: 'asc' },
      }),
      prisma.loyaltyOrder.findMany({
        where:   { validatedAt: { gte: today, lt: tomorrow } },
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

    // Per-partner LLM quota attribution (best-effort; undefined → no quota).
    const operatorId = await callerOperator().then((o) => o?.id).catch(() => undefined)
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
