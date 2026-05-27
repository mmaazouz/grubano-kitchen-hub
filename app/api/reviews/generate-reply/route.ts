import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  platform:   z.string(),
  authorName: z.string(),
  rating:     z.number().int().min(1).max(5),
  text:       z.string(),
})

const claude = new Anthropic()

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { platform, authorName, rating, text } = schema.parse(body)

    const tone = rating <= 2
      ? 'empathetic and apologetic, offering a concrete solution'
      : rating === 3
      ? 'warm and acknowledging the mixed feedback, mentioning improvements'
      : 'enthusiastic and grateful'

    const msg = await claude.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `You are the manager of a dark kitchen called Grubano.
Write a professional reply in French to this ${platform} review (${rating}/5 stars) by ${authorName}:
"${text}"

Tone: ${tone}.
Keep it under 3 sentences. Be genuine, not generic. Sign as "L'équipe Grubano".
Return only the reply text, no quotes, no markdown.`,
      }],
    })

    const reply = (msg.content[0] as { text: string }).text.trim()
    return NextResponse.json({ reply })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Erreur lors de la génération' }, { status: 500 })
  }
}
