import { NextResponse } from 'next/server'
import { z } from 'zod'
import { llmComplete, type LlmContent } from '@/lib/llm'

const schema = z.object({
  imageBase64: z.string().min(1),
  mediaType:   z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']).default('image/jpeg'),
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { imageBase64, mediaType } = schema.parse(body)

    const content: LlmContent = [
      {
        type:   'image',
        source: { type: 'base64', media_type: mediaType, data: imageBase64 },
      },
      {
        type: 'text',
        text: 'Analyze this dish photo. Return ONLY valid JSON (no markdown, no extra text) with this exact structure: {"name":"dish name in French","description":"appetizing 1-2 sentences in French","ingredients":["ingredient1","ingredient2"],"allergens":["only from: Gluten,Lactose,Oeuf,Soja,Arachide,Fruits a coque,Poisson,Crustaces,Mollusques,Celeri,Moutarde,Sesame,Sulfites,Lupin"],"calories_min":number,"calories_max":number,"category":"one of: Entrées,Plats,Desserts,Boissons","suggested_labels":["from: Veggie,Halal,Sans gluten,Épicé"]}',
      },
    ]
    const { text: raw } = await llmComplete({ task: 'dish_scan', content })
    const clean = raw.replace(/```json\n?|\n?```/g, '').trim()
    const json  = JSON.parse(clean)

    return NextResponse.json(json)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message }, { status: 400 })
    }
    console.error('scan-dish:', err)
    return NextResponse.json({ error: "Erreur lors de l'analyse" }, { status: 500 })
  }
}
