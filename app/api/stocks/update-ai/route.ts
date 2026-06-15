import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { llmComplete } from '@/lib/llm'

const schema = z.object({
  text:    z.string().min(1).max(2000),
  brandId: z.string().optional(),
})

type ParsedItem = { name: string; quantity: number; unit: string }

async function parseWithClaude(text: string): Promise<ParsedItem[]> {
  const { text: raw } = await llmComplete({
    task:    'stock_parse',
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
    const body          = await req.json()
    const { text, brandId } = schema.parse(body)

    let parsed: ParsedItem[]
    try {
      parsed = await parseWithClaude(text)
    } catch {
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
