import { NextResponse } from 'next/server'
import { z } from 'zod'
import { llmComplete, LlmQuotaError } from '@/lib/llm'
import { callerOperator } from '@/lib/operator-session'
import { rateLimit } from '@/lib/rate-limit'

// ── POST /api/reviews/generate-reply ──────────────────────────────────────────
// Drafts a reply to a customer review with the LLM. RESTAURATEUR-ONLY.
//
// P0-05 — this route used to reach a paid Sonnet call with NO authentication, NO
// rate limit and NO input bound, and `callerOperator()` was swallowed by
// `.catch(() => undefined)`: an anonymous caller produced `operatorId: undefined`,
// which is exactly the condition that DISABLES the per-operator quota
// (lib/llm/index.ts checks `if (input.operatorId && …)`). Unbounded cost
// amplification. All four holes are closed below, in this order:
//   1. rate limit (cheapest check first, before any DB or session work),
//   2. authenticated operator REQUIRED → 401 (never anonymous past this point),
//   3. bounded input via .max() on every free-text field,
//   4. operatorId is now a non-optional string → the quota always applies.

// A customer review is a short piece of prose. The LLM gateway hard-caps input at
// 120 000 chars, which is three orders of magnitude more than any real review and
// is what made this route a cost-amplification vector. 2 000 chars covers the
// longest reviews on Google/TripAdvisor/UberEats (their own limits sit between
// 1 000 and 4 000) with margin, while keeping a single call cheap and bounded.
const MAX_REVIEW_CHARS = 2000

const schema = z.object({
  platform:   z.string().min(1).max(40),
  authorName: z.string().min(1).max(120),
  rating:     z.number().int().min(1).max(5),
  text:       z.string().min(1).max(MAX_REVIEW_CHARS),
})

export async function POST(req: Request) {
  try {
    // 1. Rate limit — before the session lookup, so a flood costs us nothing.
    const limited = rateLimit(req, 'reviews_generate_reply', { limitDefault: 20, windowDefault: 60 })
    if (limited) return limited

    // 2. Authenticated operator REQUIRED. This is a back-office feature for the
    //    restaurateur answering their own reviews — there is no anonymous use
    //    case. No `.catch(() => undefined)`: a resolution failure is a refusal,
    //    never a silent downgrade to an unattributed (unquota'd) call.
    const operator = await callerOperator()
    if (!operator) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const operatorId = operator.id

    const body = await req.json()
    const { platform, authorName, rating, text } = schema.parse(body)

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
