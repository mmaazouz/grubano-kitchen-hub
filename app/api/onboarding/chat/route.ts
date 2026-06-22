import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readOperatorRoles } from '@/lib/operator-roles'
import { llmComplete, LlmQuotaError, LlmDisabledError } from '@/lib/llm'
import { buildActivationChecklist, type ChecklistSignals } from '@/lib/activation-checklist'
import {
  isOnboardingChatEnabled,
  buildOnboardingChatContent,
  formatChecklistContext,
  sanitizeHistory,
  CHAT_LOCALE_NAMES,
  MAX_MESSAGE_CHARS,
  type ChatContextStep,
} from '@/lib/onboarding-chat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/onboarding/chat — constrained AI onboarding help (Agent 97) ───────────────────
// POST: a signed-in restaurateur asks a "how-to" question during onboarding → the SERVER
// builds a GROUNDED, injection-hardened prompt from the FIXED constrained system prompt +
// the partner's OWN activation checklist (owner-scoped, NUMBER-FREE) + a bounded history,
// then calls the LLM GATEWAY (task 'onboarding_help', per-partner quota). It REFUSES legal/
// fiscal/financial advice and NEVER quotes a rate/amount (governance lives in the system
// prompt). NOTHING is persisted (ephemeral, client-held history). GET: reports the flag so
// the client mounts the chat only when ON. Gated by ONBOARDING_AI_CHAT_ENABLED (POST 404s
// OFF; GET enabled:false → space byte-identical). NON-MONEY, read/assist only.

const SUPPORTED_LOCALES = ['fr', 'en', 'es', 'it', 'ar'] as const

async function callerOperator(): Promise<{ id: string; role: string } | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.operator.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } })
}

export async function GET() {
  return NextResponse.json({ enabled: isOnboardingChatEnabled() })
}

const bodySchema = z.object({
  message: z.string().min(1).max(MAX_MESSAGE_CHARS),
  locale:  z.enum(SUPPORTED_LOCALES).optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).max(50).optional(),
})

export async function POST(req: Request) {
  // Flag gate FIRST → OFF = invisible (no auth probe, no DB read, no LLM).
  if (!isOnboardingChatEnabled()) return NextResponse.json({ error: 'Indisponible' }, { status: 404 })

  // Owner-scoped: an authenticated restaurant/admin only. The operator is resolved from the
  // SESSION (email → Operator), never from a client-supplied id → no IDOR, and ONLY this
  // partner's own onboarding context ever reaches the model.
  const operator = await callerOperator()
  if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!['restaurant', 'admin'].includes(operator.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })

  const locale   = parsed.data.locale ?? 'fr'
  const language = CHAT_LOCALE_NAMES[locale] ?? CHAT_LOCALE_NAMES.fr
  const history  = sanitizeHistory(parsed.data.history)

  try {
    // ── Anchoring: build the partner's REAL checklist (owner-scoped, existing fields only) ──
    // Mirrors GET /api/business/activation. v1 ships the 'restaurant' definition; the chat is
    // the restaurateur onboarding helper, so we ground on the restaurant checklist.
    const op = await prisma.operator.findUnique({
      where:  { id: operator.id },
      select: { id: true, role: true, status: true, emailVerifiedAt: true },
    })
    const roles = op ? await readOperatorRoles(op.id, op.role) : []
    const isResto = roles.includes('restaurant') || op?.role === 'restaurant'

    let signals: ChecklistSignals = {
      accountActive: op?.status === 'active',
      hasBrand: false, hasRestaurant: false, menuItemCount: 0,
      isActive: false, stripeConnected: false, stripeStatus: null,
    }
    if (isResto) {
      const [brand, restaurant, menuItemCount] = await Promise.all([
        prisma.brand.findFirst({ where: { operatorId: operator.id }, select: { id: true } }),
        prisma.restaurant.findFirst({
          where:  { operatorId: operator.id, archivedAt: null },
          select: { id: true, isActive: true, stripeAccountStatus: true },
        }),
        prisma.menuItem.count({ where: { brand: { operatorId: operator.id } } }),
      ])
      signals = {
        accountActive:   op?.status === 'active',
        emailVerified:   op?.emailVerifiedAt != null,
        hasBrand:        brand !== null,
        hasRestaurant:   restaurant !== null,
        menuItemCount,
        isActive:        restaurant?.isActive ?? false,
        stripeConnected: restaurant?.stripeAccountStatus === 'active',
        stripeStatus:    restaurant?.stripeAccountStatus ?? null,
      }
    }

    const checklist = buildActivationChecklist('restaurant', signals)
    const ta = await getTranslations({ locale, namespace: 'activation' })
    const steps: ChatContextStep[] = checklist.steps.map((s) => ({
      title:     ta(s.titleKey),
      done:      s.state === 'done',
      isCurrent: s.state === 'current',
    }))
    const doneCount = steps.filter((s) => s.done).length
    const current   = checklist.steps.find((s) => s.state === 'current')
    const checklistContext = formatChecklistContext({
      steps,
      done:  doneCount,
      total: steps.length,
      nextStepTitle: current ? ta(current.titleKey) : null,
    })

    // ── The ONLY LLM path: through the gateway, attributed to this operator (quota). ──
    const content = buildOnboardingChatContent({ language, checklistContext, history, message: parsed.data.message })
    const { text } = await llmComplete({ task: 'onboarding_help', content, operatorId: operator.id })

    return NextResponse.json({ reply: (text || '').trim() })
  } catch (err) {
    if (err instanceof LlmQuotaError)    return NextResponse.json({ error: 'Limite IA atteinte, réessayez plus tard.' }, { status: 429 })
    if (err instanceof LlmDisabledError) return NextResponse.json({ error: 'IA indisponible.' }, { status: 503 })
    console.error('[POST /api/onboarding/chat]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 })
  }
}
