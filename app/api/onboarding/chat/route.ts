import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readOperatorRoles } from '@/lib/operator-roles'
import { getAffiliateByOperator } from '@/lib/affiliate-account'
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

// ── /api/onboarding/chat — constrained AI onboarding help (Agent 97; cohorts Agent 101) ─
// POST: a signed-in partner asks a "how-to" question during onboarding → the SERVER builds a
// GROUNDED, injection-hardened prompt from the FIXED constrained system prompt + the partner's
// OWN activation checklist (owner-scoped, NUMBER-FREE) + a bounded history, then calls the LLM
// GATEWAY (task 'onboarding_help', per-partner quota). It REFUSES legal/fiscal/financial advice
// and NEVER quotes a rate/amount (governance lives in the FIXED system prompt). NOTHING is
// persisted (ephemeral, client-held history). GET: reports the flag so the client mounts the
// chat only when ON. Gated by ONBOARDING_AI_CHAT_ENABLED (POST 404s OFF). NON-MONEY.
//
// ROLE-AWARE ANCHORING (Agent 101): the chat serves restaurant + affiliate + creator. The
// anchoring is the ONLY role-dependent part — the surface passes its role and we ground on
// THAT role's checklist (reusing the same role-aware activation logic as GET /api/business/
// activation). The FIXED system prompt + formatChecklistContext are UNCHANGED and role-agnostic
// (the checklist context stays NUMBER-FREE for every cohort → no rate can leak). Owner-scoped:
// signals are read from the SESSION operator's OWN entities only, and the anchor role is honored
// only when the session operator actually holds it. The restaurant path is unchanged.

const SUPPORTED_LOCALES = ['fr', 'en', 'es', 'it', 'ar'] as const
// Anchor roles are CHECKLIST identifiers (the param the surface sends) — Agent 106 adds the
// supplier/prestataire/franchisor cohorts next to restaurant/affiliate/creator.
const ANCHOR_ROLES = ['restaurant', 'affiliate', 'creator', 'supplier', 'prestataire', 'franchisor'] as const
type AnchorRole = (typeof ANCHOR_ROLES)[number]
// Map a checklist anchor param to the actual OperatorRole STRING that grants it. Identity for
// every role EXCEPT 'franchisor', whose held role string is 'franchise' (the def/param is named
// 'franchisor' but readOperatorRoles never returns 'franchisor'). Used for BOTH the gate and the
// owner-scoped anchor check, so a user is only anchored on a role they actually hold.
const HELD_ROLE_FOR: Record<AnchorRole, string> = {
  restaurant:  'restaurant',
  affiliate:   'affiliate',
  creator:     'creator',
  supplier:    'supplier',
  prestataire: 'prestataire',
  franchisor:  'franchise',
}
// Roles allowed to use the onboarding chat at all (LLM-abuse gate). Owner-scoping of the
// CONTEXT is enforced separately by the per-role reads below (a user only ever sees their own).
// NB: the franchisor cohort is admitted via its held role string 'franchise' (not 'franchisor').
const CHAT_ROLES = ['restaurant', 'admin', 'affiliate', 'creator', 'supplier', 'prestataire', 'franchise']

async function callerOperator(): Promise<{ id: string; role: string; email: string } | null> {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return null
  const op = await prisma.operator.findUnique({ where: { email }, select: { id: true, role: true } })
  return op ? { id: op.id, role: op.role, email } : null
}

export async function GET() {
  return NextResponse.json({ enabled: isOnboardingChatEnabled() })
}

const bodySchema = z.object({
  message: z.string().min(1).max(MAX_MESSAGE_CHARS),
  locale:  z.enum(SUPPORTED_LOCALES).optional(),
  role:    z.enum(ANCHOR_ROLES).optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).max(50).optional(),
})

/** DAC7 self-declaration complete enough to withdraw (read-only mirror of the affiliate withdraw
 *  rail's own check — replicated so that rail stays byte-identical; no money, no Stripe). */
function affiliateFiscalComplete(op: {
  registeredAddress: string | null; taxId: string | null
  taxIdCountry: string | null; sellerType: string | null; dateOfBirth: Date | null
}): boolean {
  if (!op.registeredAddress || !op.taxId || !op.taxIdCountry || !op.sellerType) return false
  if (op.sellerType === 'individual' && !op.dateOfBirth) return false
  return true
}

/**
 * Build the NUMBER-FREE anchoring context for the surface's role, owner-scoped (the SESSION
 * operator's OWN entities only). Reuses the role-aware activation logic (buildActivationChecklist
 * + the same per-role signal reads as GET /api/business/activation) and the SHARED, role-agnostic
 * formatChecklistContext. READ-ONLY: no write, no Stripe sync, no money; the affiliate/creator
 * payout rails are never touched. The 'restaurant' branch is the unchanged Agent 97 gather.
 */
async function buildAnchorContext(
  anchorRole: AnchorRole,
  operator: { id: string; email: string },
  roles: string[],
  locale: string,
): Promise<string> {
  const op = await prisma.operator.findUnique({
    where:  { id: operator.id },
    select: { id: true, role: true, status: true, emailVerifiedAt: true },
  })
  const accountActive = op?.status === 'active'

  let checklist
  if (anchorRole === 'affiliate') {
    const affiliate = await getAffiliateByOperator(operator.id)
    const payoutOp  = await prisma.operator.findUnique({
      where:  { id: operator.id },
      select: { affiliatePayoutStatus: true, registeredAddress: true, taxId: true, taxIdCountry: true, sellerType: true, dateOfBirth: true },
    })
    checklist = buildActivationChecklist('affiliate', {
      accountActive,
      hasBrand: false, hasRestaurant: false, menuItemCount: 0, isActive: false, stripeConnected: false,
      affiliateActive:        affiliate?.status === 'active',
      affiliateWithdrawReady: payoutOp?.affiliatePayoutStatus === 'active' && affiliateFiscalComplete({
        registeredAddress: payoutOp?.registeredAddress ?? null,
        taxId:             payoutOp?.taxId ?? null,
        taxIdCountry:      payoutOp?.taxIdCountry ?? null,
        sellerType:        payoutOp?.sellerType ?? null,
        dateOfBirth:       payoutOp?.dateOfBirth ?? null,
      }),
    })
  } else if (anchorRole === 'creator') {
    const creator = await prisma.creator.findUnique({
      where:  { email: operator.email },
      select: { id: true, bio: true, payoutStatus: true },
    })
    checklist = buildActivationChecklist('creator', {
      accountActive,
      hasBrand: false, hasRestaurant: false, menuItemCount: 0, isActive: false, stripeConnected: false,
      creatorProfileComplete: !!creator?.bio && creator.bio.trim().length > 0,
      creatorPayoutReady:     creator?.payoutStatus === 'active',
    })
  } else if (anchorRole === 'supplier') {
    // Supplier (Agent 103) — EMAIL-keyed, same read-only signals as supplierActivation.
    const profile = await prisma.supplierProfile.findUnique({
      where:  { email: operator.email },
      select: { verificationStatus: true, payoutStatus: true, _count: { select: { catalogItems: true } } },
    })
    checklist = buildActivationChecklist('supplier', {
      accountActive,
      hasBrand: false, hasRestaurant: false, menuItemCount: 0, isActive: false, stripeConnected: false,
      supplierCompanyVerified: profile?.verificationStatus === 'verified',
      supplierCatalogueReady:  (profile?._count?.catalogItems ?? 0) >= 1,
      supplierPayoutReady:     profile?.payoutStatus === 'active',
    })
  } else if (anchorRole === 'prestataire') {
    // Prestataire (Agent 104) — EMAIL-keyed, same read-only signals as prestataireActivation.
    const profile = await prisma.prestataireProfile.findUnique({
      where:  { email: operator.email },
      select: { serviceCategories: true, verificationStatus: true, payoutStatus: true },
    })
    const cats = profile?.serviceCategories
    checklist = buildActivationChecklist('prestataire', {
      accountActive,
      hasBrand: false, hasRestaurant: false, menuItemCount: 0, isActive: false, stripeConnected: false,
      prestataireProfileComplete: Array.isArray(cats) && cats.length > 0,
      prestataireCompanyVerified: profile?.verificationStatus === 'verified',
      prestatairePayoutReady:     profile?.payoutStatus === 'active',
    })
  } else if (anchorRole === 'franchisor') {
    // Franchisor (Agent 105) — OPERATOR-keyed (role string 'franchise'), same read-only signals as
    // franchisorActivation: account-level KYB + a franchisable Brand + the stored franchise payout
    // status. NO royalty amount is read; the franchise money rail is untouched.
    const [fop, openBrandCount] = await Promise.all([
      prisma.operator.findUnique({ where: { id: operator.id }, select: { kybStatus: true, franchisePayoutStatus: true } }),
      prisma.brand.count({ where: { operatorId: operator.id, openToFranchise: true } }),
    ])
    checklist = buildActivationChecklist('franchisor', {
      accountActive,
      hasBrand: false, hasRestaurant: false, menuItemCount: 0, isActive: false, stripeConnected: false,
      franchisorCompanyVerified:     fop?.kybStatus === 'verified',
      franchisorFranchiseConfigured: openBrandCount >= 1,
      franchisorPayoutReady:         fop?.franchisePayoutStatus === 'active',
    })
  } else {
    // ── restaurant — the unchanged Agent 97 gather (owner-scoped, existing fields only) ──
    const isResto = roles.includes('restaurant') || op?.role === 'restaurant'
    let signals: ChecklistSignals = {
      accountActive,
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
        accountActive,
        emailVerified:   op?.emailVerifiedAt != null,
        hasBrand:        brand !== null,
        hasRestaurant:   restaurant !== null,
        menuItemCount,
        isActive:        restaurant?.isActive ?? false,
        stripeConnected: restaurant?.stripeAccountStatus === 'active',
        stripeStatus:    restaurant?.stripeAccountStatus ?? null,
      }
    }
    checklist = buildActivationChecklist('restaurant', signals)
  }

  // SHARED, role-agnostic: resolve step titles (under the 'activation' namespace) and format the
  // NUMBER-FREE context (titles + done/current marks + next step). Identical for every cohort.
  const ta = await getTranslations({ locale, namespace: 'activation' })
  const steps: ChatContextStep[] = checklist.steps.map((s) => ({
    title:     ta(s.titleKey),
    done:      s.state === 'done',
    isCurrent: s.state === 'current',
  }))
  const current = checklist.steps.find((s) => s.state === 'current')
  return formatChecklistContext({
    steps,
    done:  steps.filter((s) => s.done).length,
    total: steps.length,
    nextStepTitle: current ? ta(current.titleKey) : null,
  })
}

export async function POST(req: Request) {
  // Flag gate FIRST → OFF = invisible (no auth probe, no DB read, no LLM).
  if (!isOnboardingChatEnabled()) return NextResponse.json({ error: 'Indisponible' }, { status: 404 })

  // Owner-scoped: an authenticated partner. The operator is resolved from the SESSION (email →
  // Operator), never from a client-supplied id → no IDOR, and ONLY this partner's own onboarding
  // context ever reaches the model.
  const operator = await callerOperator()
  if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  // The chat serves the onboarding cohorts (restaurant/affiliate/creator) + admin. Gate on the
  // ROLE SET (primary + cumulative), so a multi-role partner on any of their dashboards is allowed.
  const roles = await readOperatorRoles(operator.id, operator.role)
  if (!roles.some((r) => CHAT_ROLES.includes(r))) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })

  const locale   = parsed.data.locale ?? 'fr'
  const language = CHAT_LOCALE_NAMES[locale] ?? CHAT_LOCALE_NAMES.fr
  const history  = sanitizeHistory(parsed.data.history)

  // Anchor on the SURFACE's role — but only when the session operator ACTUALLY holds it
  // (owner-scoped by role); otherwise fall back to restaurant. No ?role → restaurant (the
  // EstablishmentHub usage is byte-identical). The held-role check uses HELD_ROLE_FOR so the
  // 'franchisor' param is validated against the real role string 'franchise'.
  const requested  = parsed.data.role
  const anchorRole: AnchorRole = requested && roles.includes(HELD_ROLE_FOR[requested]) ? requested : 'restaurant'

  try {
    const checklistContext = await buildAnchorContext(anchorRole, { id: operator.id, email: operator.email }, roles, locale)

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
