import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { llmComplete, LlmQuotaError, LlmDisabledError } from '@/lib/llm'
import {
  isMenuPrefillEnabled, isAllowedMenuMedia, ALLOWED_MENU_MEDIA, base64Bytes,
  MAX_MENU_FILE_BYTES, buildMenuExtractContent, parseMenuDraft, type MenuMedia,
} from '@/lib/menu-extract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/menu/scan-card — AI menu prefill (onboarding copilot, brique 1, Agent 89) ─
// POST: a restaurateur uploads a photo/PDF of their card → the LLM GATEWAY (task
// 'menu_extract', per-partner quota) extracts a DRAFT dish list, returned for the user
// to review/edit/CONFIRM. NOTHING is saved here — confirmation creates dishes through
// the EXISTING POST /api/menu (owner-scoped, same validation). GET: reports whether the
// feature is enabled (a global flag → the client mounts the import card only when ON).
// Gated by ONBOARDING_AI_MENU_PREFILL_ENABLED (POST 404s OFF; GET returns enabled:false
// → the menu builder is byte-identical). READ/contenu only — ZERO money surface.

async function callerOperator(): Promise<{ id: string; role: string } | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.operator.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } })
}

export async function GET() {
  return NextResponse.json({ enabled: isMenuPrefillEnabled() })
}

const bodySchema = z.object({
  fileBase64: z.string().min(1),
  mediaType:  z.enum(ALLOWED_MENU_MEDIA),
})

export async function POST(req: Request) {
  // Flag gate FIRST → OFF = invisible (no auth probe, no work).
  if (!isMenuPrefillEnabled()) return NextResponse.json({ error: 'Indisponible' }, { status: 404 })

  // Owner-scoped: an authenticated restaurant/admin only (the brand-level ownership is
  // re-checked at confirmation by POST /api/menu — extraction creates nothing).
  const operator = await callerOperator()
  if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!['restaurant', 'admin'].includes(operator.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success || !isAllowedMenuMedia(parsed.data.mediaType)) {
      return NextResponse.json({ error: 'Fichier invalide (image ou PDF requis).' }, { status: 400 })
    }
    const { fileBase64, mediaType } = parsed.data
    if (base64Bytes(fileBase64) > MAX_MENU_FILE_BYTES) {
      return NextResponse.json({ error: 'Fichier trop volumineux (8 Mo max).' }, { status: 413 })
    }

    // The ONLY LLM path: through the gateway, attributed to this operator (quota).
    const content = buildMenuExtractContent(fileBase64, mediaType as MenuMedia)
    const { text: raw } = await llmComplete({ task: 'menu_extract', content, operatorId: operator.id })

    // Strict-validate the model output into a draft (never throws; malformed → []).
    const draft = parseMenuDraft(raw)
    return NextResponse.json({ draft })
  } catch (err) {
    if (err instanceof LlmQuotaError)    return NextResponse.json({ error: 'Limite IA atteinte, réessayez plus tard.' }, { status: 429 })
    if (err instanceof LlmDisabledError) return NextResponse.json({ error: 'IA indisponible.' }, { status: 503 })
    console.error('[POST /api/menu/scan-card]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Erreur lors de l'analyse de la carte." }, { status: 500 })
  }
}
