import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { llmComplete, LlmQuotaError } from '@/lib/llm'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'

export const dynamic = 'force-dynamic'

const schema = z.object({
  text:    z.string().min(1).max(2000),
  brandId: z.string().optional(),
})

type ParsedItem = { name: string; quantity: number; unit: string }

async function parseWithClaude(text: string, operatorId?: string): Promise<ParsedItem[]> {
  const { text: raw } = await llmComplete({
    task:    'stock_parse',
    operatorId,
    content: `Parse this restaurant stock update text and return ONLY valid JSON array (no markdown, no extra text).
Each item: {"name":"ingredient name in lowercase French","quantity":number,"unit":"kg|g|L|mL|u"}.
Use unit "u" for pieces/boxes. If quantity is 0 or "finished/vide/terminé", use 0.
Text: "${text}"`,
  })
  const clean = raw.replace(/```json\n?|\n?```/g, '').trim()
  return JSON.parse(clean) as ParsedItem[]
}

function forecast(items: ParsedItem[]) {
  const DAILY_USE: Record<string, number> = { kg: 0.7, L: 0.5, g: 500, mL: 300, u: 5 }
  return items.map(i => {
    const daily    = DAILY_USE[i.unit] ?? 1
    const daysLeft = i.quantity > 0 ? Math.floor(i.quantity / daily) : 0
    return {
      name:       i.name,
      unit:       i.unit,
      daysLeft,
      runoutDate: new Date(Date.now() + daysLeft * 86_400_000).toISOString().split('T')[0],
      status:     daysLeft <= 1 ? 'critique' : daysLeft <= 3 ? 'bas' : 'ok',
    }
  })
}

export async function POST(req: Request) {
  try {
    // 🔒 SEC. Previously auth was best-effort (LLM-quota only): an anonymous caller
    // could parse text AND — with a client-supplied brandId — create/UPDATE stock on
    // ANY operator's brand (unauth cross-tenant write / IDOR). Now gated to the
    // connected restaurateur, and any write is fenced to a brand they OWN (same rule
    // as POST /api/stocks). The LLM call itself is also no longer free to anon.
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const operatorId = scope.operatorId

    const body          = await req.json()
    const { text, brandId } = schema.parse(body)

    let parsed: ParsedItem[]
    try {
      parsed = await parseWithClaude(text, operatorId)
    } catch (e) {
      if (e instanceof LlmQuotaError) {
        return NextResponse.json({ error: 'Limite IA atteinte, réessaie plus tard.' }, { status: 429 })
      }
      return NextResponse.json(
        { error: 'Impossible d\'analyser ce texte. Exemple : "poulet 3 kg, riz 5 kg, sauce tomate terminée"' },
        { status: 422 },
      )
    }

    if (!parsed.length) {
      return NextResponse.json(
        { error: 'Aucun stock détecté. Exemple : "poulet 3 kg, riz 5 kg, sauce tomate 2 L"' },
        { status: 422 },
      )
    }

    if (!brandId) {
      return NextResponse.json({
        preview:       true,
        updated_items: parsed.map(p => ({ ...p, status: 'preview' })),
        message:       `${parsed.length} produit(s) détecté(s). Fournissez un brandId pour sauvegarder.`,
      })
    }

    // The target brand MUST belong to the caller (blocks cross-tenant stock writes).
    const ownedBrand = await prisma.brand.findFirst({
      where:  { id: brandId, operatorId },
      select: { id: true },
    })
    if (!ownedBrand) {
      return NextResponse.json({ error: 'Marque non autorisée' }, { status: 403 })
    }

    const updatedItems: Array<ParsedItem & { action: string }> = []

    for (const item of parsed) {
      const existing = await prisma.stockItem.findFirst({
        where: { brandId, name: { contains: item.name } },
      })

      if (existing) {
        await prisma.stockItem.update({
          where: { id: existing.id },
          data:  { quantity: item.quantity, unit: item.unit },
        })
        updatedItems.push({ ...item, action: 'updated' })
      } else {
        await prisma.stockItem.create({
          data: { brandId, name: item.name, quantity: item.quantity, unit: item.unit },
        })
        updatedItems.push({ ...item, action: 'created' })
      }
    }

    return NextResponse.json({
      updated_items:      updatedItems,
      forecast_next_7_days: forecast(updatedItems),
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
