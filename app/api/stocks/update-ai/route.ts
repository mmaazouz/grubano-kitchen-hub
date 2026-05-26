import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  text:    z.string().min(1).max(2000),
  brandId: z.string().optional(),
})

// ── Simple NLP parser (no LLM required — can upgrade later) ──────────────────
// Parses lines like "poulet 3 kg", "sauce tomate: 2L", "riz 5kg restant"
function parseStockText(text: string): Array<{ name: string; quantity: number; unit: string }> {
  const lines = text.split(/[\n,;]+/).map(l => l.trim()).filter(Boolean)
  const results: Array<{ name: string; quantity: number; unit: string }> = []

  const unitMap: Record<string, string> = {
    kg: 'kg', kilo: 'kg', kilos: 'kg',
    g:  'g',  gr: 'g', gram: 'g', grammes: 'g',
    l:  'L',  litre: 'L', litres: 'L',
    ml: 'mL', millilitre: 'mL',
    u:  'u',  unite: 'u', unites: 'u', piece: 'u', pieces: 'u', boite: 'u', boites: 'u',
  }

  for (const line of lines) {
    // Match: optional number + name + number + unit  OR  name + number + unit
    const m = line.match(
      /^(?:\d+[.,]?\d*\s*)?(.+?)\s*[:\-–]?\s*(\d+[.,]?\d*)\s*([a-zA-Zé]+)/i,
    )
    if (m) {
      const name = m[1].replace(/[:\-–]/g, '').trim().toLowerCase()
      const qty  = parseFloat(m[2].replace(',', '.'))
      const raw  = m[3].toLowerCase()
      const unit = unitMap[raw] ?? raw

      if (name && !isNaN(qty)) {
        results.push({ name, quantity: qty, unit })
      }
    }
  }

  return results
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { text, brandId } = schema.parse(body)

    const parsed = parseStockText(text)

    if (!parsed.length) {
      return NextResponse.json(
        { error: 'Aucun stock détecté. Exemple : "poulet 3 kg, riz 5 kg, sauce tomate 2 L"' },
        { status: 422 },
      )
    }

    if (!brandId) {
      // Return parsed preview without writing to DB
      return NextResponse.json({
        preview:       true,
        updated_items: parsed.map(p => ({ ...p, status: 'preview' })),
        message:       `${parsed.length} produit(s) détecté(s). Fournissez un brandId pour sauvegarder.`,
      })
    }

    const updatedItems: Array<{ name: string; quantity: number; unit: string; action: string }> = []

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

    // Simple 7-day forecast (mock — can be replaced with real AI later)
    const forecast_next_7_days = updated_items_to_forecast(updatedItems)

    return NextResponse.json({ updated_items: updatedItems, forecast_next_7_days })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

function updated_items_to_forecast(items: Array<{ name: string; quantity: number; unit: string }>) {
  // Simple linear depletion estimate: assume 0.7kg/day usage for kg items
  const DAILY_USE: Record<string, number> = { kg: 0.7, L: 0.5, g: 500, mL: 300, u: 5 }
  return items.map(i => {
    const daily = DAILY_USE[i.unit] ?? 1
    const daysLeft = Math.floor(i.quantity / daily)
    return {
      name:      i.name,
      unit:      i.unit,
      daysLeft,
      runoutDate: new Date(Date.now() + daysLeft * 86_400_000).toISOString().split('T')[0],
    }
  })
}
