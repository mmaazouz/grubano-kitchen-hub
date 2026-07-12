import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { fetchSiteText, fetchSiteImage, SafeFetchError } from '@/lib/safe-fetch'
import { isLogoPrefillEnabled, extractLogoCandidates, MAX_LOGO_CANDIDATES } from '@/lib/logo-detect'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/restaurants/logo-prefill — AI logo prefill from a website (brique 3, Agent 92) ─
// POST {url}: the SERVER fetches the page SSRF-SAFELY (lib/safe-fetch), parses logo
// candidates (og:image / apple-touch-icon / icon — PURE, no LLM), then fetches the best
// candidate IMAGE through the SAME SSRF guards (lib/safe-fetch.fetchSiteImage: validated
// URL + pinned validated IP + per-hop re-validation + magic-byte sniff + byte cap). Returns
// a PREVIEW (ephemeral base64) for the user to review/CONFIRM. NOTHING is applied here —
// confirmation uploads to OUR storage via /logo-prefill/apply then the existing PATCH route.
// GET reports the flag. Gated by ONBOARDING_AI_LOGO_PREFILL_ENABLED (POST 404s OFF). Errors
// are GENERIC (no SSRF oracle). READ/contenu only — ZERO money surface.

async function callerOperator(): Promise<{ id: string; role: string } | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.operator.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } })
}

function fetchErrorResponse(err: unknown): NextResponse {
  if (err instanceof SafeFetchError) {
    if (err.code === 'too_large') return NextResponse.json({ error: 'Image trop volumineuse.' }, { status: 413 })
    if (err.code === 'timeout')   return NextResponse.json({ error: 'Le site n’a pas répondu à temps.' }, { status: 504 })
    return NextResponse.json({ error: 'Adresse inaccessible. Vérifiez l’URL de votre site public.' }, { status: 400 })
  }
  console.error('[POST /api/restaurants/logo-prefill]', err instanceof Error ? err.message : err)
  return NextResponse.json({ error: 'Adresse inaccessible. Vérifiez l’URL de votre site public.' }, { status: 400 })
}

export async function GET() {
  return NextResponse.json({ enabled: isLogoPrefillEnabled() })
}

const bodySchema = z.object({ url: z.string().min(1).max(2048) })

export async function POST(req: Request) {
  if (!isLogoPrefillEnabled()) return NextResponse.json({ error: 'Indisponible' }, { status: 404 })

  const operator = await callerOperator()
  if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!['restaurant', 'admin'].includes(operator.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Adresse invalide.' }, { status: 400 })

  // 1) Fetch the page SSRF-safely + parse logo candidates.
  let candidates: string[]
  try {
    const html = await fetchSiteText(parsed.data.url)
    candidates = extractLogoCandidates(html, parsed.data.url)
  } catch (err) {
    return fetchErrorResponse(err)
  }

  // 2) Try each candidate through the SAME SSRF guards (fetchSiteImage). A candidate that
  //    resolves to an internal IP / redirects internally / isn't a real raster image is
  //    SKIPPED silently (no oracle) and we move on. First valid raster wins.
  for (const candidate of candidates.slice(0, MAX_LOGO_CANDIDATES)) {
    try {
      const { bytes, mediaType } = await fetchSiteImage(candidate)
      return NextResponse.json({
        preview: { imageBase64: bytes.toString('base64'), mediaType },
      })
    } catch {
      // blocked / bad_content / too_large / timeout for THIS candidate → try the next one.
      continue
    }
  }

  // No usable logo found — neutral 200 (not an error; the user can paste a logo manually).
  return NextResponse.json({ preview: null })
}
