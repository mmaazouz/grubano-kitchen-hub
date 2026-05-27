import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  imageBase64: z.string().min(1),
  mediaType:   z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']).default('image/jpeg'),
})

const claude = new Anthropic()

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { imageBase64, mediaType } = schema.parse(body)

    const msg = await claude.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
          },
          {
            type: 'text',
            text: 'Analyze this dish photo. Return ONLY valid JSON (no markdown, no extra text) with this exact structure: {"name":"dish name in French","description":"appetizing 1-2 sentences in French","ingredients":["ingredient1","ingredient2"],"allergens":["only from: Gluten,Lactose,Oeuf,Soja,Arachide,Fruits a coque,Poisson,Crustaces,Mollusques,Celeri,Moutarde,Sesame,Sulfites,Lupin"],"calories_min":number,"calories_max":number,"category":"one of: Entrées,Plats,Desserts,Boissons","suggested_labels":["from: Veggie,Halal,Sans gluten,Épicé"]}',
          },
        ],
      }],
    })

    const raw   = (msg.content[0] as { text: string }).text
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
