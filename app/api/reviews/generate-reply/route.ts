import { NextResponse } from 'next/server'
import { z } from 'zod'
import { llmComplete, LlmQuotaError } from '@/lib/llm'
import { callerOperator } from '@/lib/operator-session'

const schema = z.object({
  platform:   z.string(),
  authorName: z.string(),
  rating:     z.number().int().min(1).max(5),
  text:       z.string(),
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { platform, authorName, rating, text } = schema.parse(body)

    // Per-partner LLM quota attribution (best-effort; undefined → no quota).
    const operatorId = await callerOperator().then((o) => o?.id).catch(() => undefined)

    const tone = rating <= 2
      ? 'empathetic and apologetic, offering a concrete solution'
      : rating === 3
      ? 'warm and acknowledging the mixed feedback, mentioning improvements'
      : 'enthusiastic and grateful'

    const { text: out } = await llmComplete({
      task: 'review_reply',
      operatorId,
      content: `You are the manager of a dark kitchen called Grubano.
Write a professional reply in French to this ${platform} review (${rating}/5 stars) by ${authorName}:
"${text}"

Tone: ${tone}.
Keep it under 3 sentences. Be genuine, not generic. Sign as "L'équipe Grubano".
Return only the reply text, no quotes, no markdown.`,
    })

    const reply = out.trim()
    return NextResponse.json({ reply })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message }, { status: 400 })
    }
    if (err instanceof LlmQuotaError) {
      return NextResponse.json({ error: 'Limite IA atteinte, réessaie plus tard.' }, { status: 429 })
    }
    return NextResponse.json({ error: 'Erreur lors de la génération' }, { status: 500 })
  }
}
