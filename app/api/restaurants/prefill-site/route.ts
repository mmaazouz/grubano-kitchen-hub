import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { llmComplete, LlmQuotaError, LlmDisabledError } from '@/lib/llm'
import { fetchSiteText, SafeFetchError } from '@/lib/safe-fetch'
import { isSitePrefillEnabled, buildSiteExtractContent, parseSiteDraft } from '@/lib/site-extract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/restaurants/prefill-site — AI profile prefill from a website (brique 2, Agent 91) ─
// POST: a restaurateur supplies their website URL → the SERVER fetches it SSRF-SAFELY
// (lib/safe-fetch) → the LLM GATEWAY (task 'site_extract', per-partner quota) extracts a
// NON-LEGAL marketing DRAFT (name/description/cuisine), returned for the user to review/
// edit/CONFIRM. NOTHING is saved here — confirmation updates the profile through the
// EXISTING PATCH /api/restaurants/[id] (owner-scoped, same validation). GET: reports the
// flag (the client mounts the import card only when ON). Gated by
// ONBOARDING_AI_SITE_PREFILL_ENABLED (POST 404s OFF; GET enabled:false → profile screen
// byte-identical). READ/contenu only — ZERO money surface.

async function callerOperator(): Promise<{ id: string; role: string } | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.operator.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } })
}

export async function GET() {
  return NextResponse.json({ enabled: isSitePrefillEnabled() })
}

const bodySchema = z.object({ url: z.string().min(1).max(2048) })

export async function POST(req: Request) {
  // Flag gate FIRST → OFF = invisible (no auth probe, no fetch, no LLM).
  if (!isSitePrefillEnabled()) return NextResponse.json({ error: 'Indisponible' }, { status: 404 })

  // Owner-scoped: an authenticated restaurant/admin only (the specific restaurant's
  // ownership is re-checked at confirmation by PATCH /api/restaurants/[id] — extraction
  // writes nothing).
  const operator = await callerOperator()
  if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!['restaurant', 'admin'].includes(operator.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Adresse invalide.' }, { status: 400 })
  }

  // 1) SSRF-safe fetch. On ANY failure → a GENERIC message (no SSRF oracle): the user
  //    never learns whether the host was internal, unreachable, or simply malformed.
  let siteText: string
  try {
    siteText = await fetchSiteText(parsed.data.url)
  } catch (err) {
    if (err instanceof SafeFetchError) {
      if (err.code === 'too_large') return NextResponse.json({ error: 'Page trop volumineuse.' }, { status: 413 })
      if (err.code === 'timeout')   return NextResponse.json({ error: 'Le site n’a pas répondu à temps.' }, { status: 504 })
      // invalid_url | blocked | bad_content | fetch_failed → ONE generic 400 (no oracle)
      return NextResponse.json({ error: 'Adresse inaccessible. Vérifiez l’URL de votre site public.' }, { status: 400 })
    }
    console.error('[POST /api/restaurants/prefill-site] fetch', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Adresse inaccessible. Vérifiez l’URL de votre site public.' }, { status: 400 })
  }

  // 2) Extraction — the ONLY LLM path: through the gateway, attributed to this operator (quota).
  try {
    const content = buildSiteExtractContent(siteText)
    const { text: raw } = await llmComplete({ task: 'site_extract', content, operatorId: operator.id })
    const draft = parseSiteDraft(raw) // strict NON-LEGAL shape; never throws → empty on failure
    return NextResponse.json({ draft })
  } catch (err) {
    if (err instanceof LlmQuotaError)    return NextResponse.json({ error: 'Limite IA atteinte, réessayez plus tard.' }, { status: 429 })
    if (err instanceof LlmDisabledError) return NextResponse.json({ error: 'IA indisponible.' }, { status: 503 })
    console.error('[POST /api/restaurants/prefill-site] extract', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Erreur lors de l'analyse du site." }, { status: 500 })
  }
}
