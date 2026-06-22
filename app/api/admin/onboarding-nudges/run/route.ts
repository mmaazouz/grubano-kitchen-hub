import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { getTranslations } from 'next-intl/server'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildActivationChecklist, type ChecklistSignals } from '@/lib/activation-checklist'
import { deriveOnboardingProgress, type OnboardingProgress } from '@/lib/onboarding-progress'
import {
  isOnboardingNudgeEnabled, decideNudgeLevel, resolveNudgeLocale,
  mintUnsubscribeToken, NUDGE_AGE_MS,
} from '@/lib/onboarding-nudge'
import { sendTransactional } from '@/lib/transactional-emails'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/onboarding-nudges/run — anti-abandon nudge emails (Agent 95; cohorts Agent 102) ─
// A cron/admin batch that emails partners whose ONBOARDING is INCOMPLETE a reminder, at a FIXED
// cadence (J+1 / J+3 / J+7, max 3), in their language, with a deep link to the next step + a
// one-click unsubscribe. SENSITIVE (real emails) → ÉLEVÉE.
//   GATE 1: ONBOARDING_NUDGE_ENABLED kill-switch (default OFF) → 403, NO send, NO write.
//   GATE 2: INTERNAL_CRON_TOKEN via x-internal-token, OR an admin session.
// Agent 102 generalises the cron to THREE cohorts — restaurant + affiliate + creator — tracked
// PER ROLE (OnboardingNudge.role; @@unique([operatorId,role,level])), so a single operator can be
// nudged independently for each onboarding. Per (entity, role), best-effort + isolated: build the
// role's checklist (REUSED engine) → decide the due level → CLAIM it (role-keyed = no double-send,
// re-run/concurrent-safe) → only then SEND. STOP conditions (complete / unsubscribed / ≥3) live in
// decideNudgeLevel. Unsubscribe is GLOBAL (Operator.onboardingNudgeUnsub stops ALL roles). The
// restaurant cohort is EQUIVALENT to Agent 95. READS onboarding state; WRITES only nudge state — ZERO money.

const BATCH_CAP = 500
type NudgeRole = 'restaurant' | 'affiliate' | 'creator'
const DEFAULT_PATH: Record<NudgeRole, string> = {
  restaurant: '/dashboard',
  affiliate:  '/affiliate/dashboard',
  creator:    '/creators/dashboard',
}

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL || 'https://app.grubano.com').replace(/\/$/, '')
}

/** DAC7 self-declaration complete enough to withdraw (read-only mirror; no money, no Stripe). */
function affiliateFiscalComplete(op: {
  registeredAddress: string | null; taxId: string | null
  taxIdCountry: string | null; sellerType: string | null; dateOfBirth: Date | null
}): boolean {
  if (!op.registeredAddress || !op.taxId || !op.taxIdCountry || !op.sellerType) return false
  if (op.sellerType === 'individual' && !op.dateOfBirth) return false
  return true
}

interface NudgeCandidate {
  operatorId:      string
  email:           string
  name:            string
  locale:          string | null
  roleCreatedAtMs: number
}

/**
 * Claim-before-send + send for ONE (operator, role) candidate. PER-ROLE send-once: the claim is
 * OnboardingNudge.create({operatorId, role, level}) guarded by @@unique([operatorId,role,level])
 * → a re-run or a concurrent run hits P2002 and SKIPS, so a (operator, role, level) is emailed AT
 * MOST ONCE. STOP conditions (complete / ≥3 / cadence) are in decideNudgeLevel; the GLOBAL unsubscribe
 * is enforced by the caller (only non-unsubscribed operators are passed in). The restaurant email is
 * byte-identical to Agent 95 (same keys); affiliate/creator use the role-generic copy.
 */
async function processCandidate(c: NudgeCandidate, role: NudgeRole, progress: OnboardingProgress, now: number): Promise<'sent' | 'skipped'> {
  const sentLevels = (await prisma.onboardingNudge.findMany({
    where: { operatorId: c.operatorId, role }, select: { level: true },
  })).map((r) => r.level)

  const level = decideNudgeLevel({
    nowMs: now, createdAtMs: c.roleCreatedAtMs,
    sentLevels, unsubscribed: false, isComplete: progress.isComplete,
  })
  if (!level) return 'skipped'

  // CLAIM (operator, role, level) BEFORE sending — atomic via the composite @@unique; a re-run or
  // concurrent run hits P2002 → skip → emailed at most once PER ROLE.
  try {
    await prisma.onboardingNudge.create({ data: { operatorId: c.operatorId, role, level } })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'skipped'
    throw err
  }

  const locale = resolveNudgeLocale(c.locale)
  const t      = await getTranslations({ locale, namespace: 'onboardingNudge' })
  const steps  = Math.max(0, progress.total - progress.done)
  const resumePath = progress.nextStep?.ctaHref ?? DEFAULT_PATH[role]
  const resumeUrl  = `${baseUrl()}/${locale}${resumePath}`
  const unsubUrl   = `${baseUrl()}/api/onboarding/unsubscribe?token=${encodeURIComponent(mintUnsubscribeToken(c.operatorId))}`
  // Restaurant keeps the EXISTING keys (byte-identical email); affiliate/creator use the
  // role-generic copy (onboardingNudge.generic.*) — no "restaurant" wording, no money figure.
  const g = role === 'restaurant' ? '' : 'generic.'

  await sendTransactional({
    to:      c.email,
    subject: t(`${g}subject`, { steps }),
    trigger: 'onboarding_nudge',
    html:    renderNudgeHtml({
      title:       t(`${g}title`),
      greeting:    t('greeting', { name: c.name }),
      body:        t(`${g}body`, { steps }),
      resumeCta:   t(`${g}resumeCta`),
      unsubPrefix: t('unsubPrefix'),
      unsubLink:   t('unsubLink'),
      resumeUrl, unsubUrl, rtl: locale === 'ar',
    }),
  })
  return 'sent'
}

export async function POST(req: Request) {
  // 1. Kill-switch — default OFF → the whole cron is a no-op (no candidates read, no send).
  if (!isOnboardingNudgeEnabled()) {
    return NextResponse.json({ ok: true, gated: true, considered: 0, sent: 0 })
  }

  // 2. Auth — cron secret OR admin session.
  const internalToken    = req.headers.get('x-internal-token')
  const internalExpected = (process.env.INTERNAL_CRON_TOKEN ?? '').trim()
  const isInternal =
    internalExpected.length > 0 && typeof internalToken === 'string' && internalToken === internalExpected
  if (!isInternal) {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    const admin = await prisma.operator.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || admin.role !== 'admin') return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  try {
    const now      = Date.now()
    const earliest = new Date(now - NUDGE_AGE_MS[1]) // never even consider an entity younger than level-1's age

    let sent = 0, skipped = 0, considered = 0

    // ── Cohort 1 — RESTAURANT (EQUIVALENT to Agent 95) ──────────────────────────────────
    // Candidates: restaurateurs old enough, NOT unsubscribed. Completion + level/cadence are
    // decided per account below (the cheap filters narrow the set first).
    const candidates = await prisma.operator.findMany({
      where:   { role: 'restaurant', onboardingNudgeUnsub: false, createdAt: { lte: earliest } },
      select:  { id: true, email: true, name: true, locale: true, createdAt: true, status: true, emailVerifiedAt: true },
      orderBy: { createdAt: 'asc' },
      take:    BATCH_CAP,
    })
    considered += candidates.length
    for (const op of candidates) {
      try {
        // Onboarding state via the REUSED engine (signals = existing fields only).
        const [brand, restaurant, menuItemCount] = await Promise.all([
          prisma.brand.findFirst({ where: { operatorId: op.id }, select: { id: true } }),
          prisma.restaurant.findFirst({ where: { operatorId: op.id, archivedAt: null }, select: { isActive: true, stripeAccountStatus: true } }),
          prisma.menuItem.count({ where: { brand: { operatorId: op.id } } }),
        ])
        const signals: ChecklistSignals = {
          accountActive:   op.status === 'active',
          emailVerified:   op.emailVerifiedAt !== null,
          hasBrand:        brand !== null,
          hasRestaurant:   restaurant !== null,
          menuItemCount,
          isActive:        restaurant?.isActive ?? false,
          stripeConnected: restaurant?.stripeAccountStatus === 'active',
          stripeStatus:    restaurant?.stripeAccountStatus ?? null,
        }
        const progress = deriveOnboardingProgress(buildActivationChecklist('restaurant', signals))
        const r = await processCandidate(
          { operatorId: op.id, email: op.email, name: op.name, locale: op.locale, roleCreatedAtMs: op.createdAt.getTime() },
          'restaurant', progress, now,
        )
        if (r === 'sent') sent++; else skipped++
      } catch (err) {
        skipped++
        console.error('[onboarding-nudge] restaurant account failed', op.id, err instanceof Error ? err.message : err)
      }
    }

    // ── Cohort 2 — AFFILIATE ────────────────────────────────────────────────────────────
    // Affiliates old enough, joined to their NON-unsubscribed operator (the unsub filter + the
    // claim/locale all key off the operator). Cadence = Affiliate.createdAt (when they became an
    // affiliate). Signals are read-only mirrors of the EXISTING Affiliate entity + the operator's
    // stored payout/fiscal fields (no Stripe sync, no money).
    const affiliates = await prisma.affiliate.findMany({
      where:   { createdAt: { lte: earliest } },
      select:  { operatorId: true, createdAt: true, status: true },
      orderBy: { createdAt: 'asc' },
      take:    BATCH_CAP,
    })
    const affOps = affiliates.length
      ? await prisma.operator.findMany({
          where:  { id: { in: affiliates.map((a) => a.operatorId) }, onboardingNudgeUnsub: false },
          select: { id: true, email: true, name: true, locale: true, status: true, affiliatePayoutStatus: true, registeredAddress: true, taxId: true, taxIdCountry: true, sellerType: true, dateOfBirth: true },
        })
      : []
    const affOpById = new Map(affOps.map((o) => [o.id, o]))
    considered += affiliates.length
    for (const a of affiliates) {
      const op = affOpById.get(a.operatorId)
      if (!op) { skipped++; continue } // no operator OR unsubscribed (filtered out) → skip, no send
      try {
        const signals: ChecklistSignals = {
          accountActive: op.status === 'active',
          hasBrand: false, hasRestaurant: false, menuItemCount: 0, isActive: false, stripeConnected: false,
          affiliateActive:        a.status === 'active',
          affiliateWithdrawReady: op.affiliatePayoutStatus === 'active' && affiliateFiscalComplete(op),
        }
        const progress = deriveOnboardingProgress(buildActivationChecklist('affiliate', signals))
        const r = await processCandidate(
          { operatorId: op.id, email: op.email, name: op.name, locale: op.locale, roleCreatedAtMs: a.createdAt.getTime() },
          'affiliate', progress, now,
        )
        if (r === 'sent') sent++; else skipped++
      } catch (err) {
        skipped++
        console.error('[onboarding-nudge] affiliate failed', a.operatorId, err instanceof Error ? err.message : err)
      }
    }

    // ── Cohort 3 — CREATOR (email-keyed) ────────────────────────────────────────────────
    // Creators old enough, joined to their NON-unsubscribed operator by SHARED EMAIL (the login
    // identity that carries unsub + locale + the claim key). A creator with no operator is
    // unreachable for unsub → skipped. Cadence = Creator.createdAt. Signals from the EXISTING
    // Creator entity (bio / payoutStatus), read-only.
    const creators = await prisma.creator.findMany({
      where:   { createdAt: { lte: earliest } },
      select:  { email: true, createdAt: true, bio: true, payoutStatus: true },
      orderBy: { createdAt: 'asc' },
      take:    BATCH_CAP,
    })
    const creatorOps = creators.length
      ? await prisma.operator.findMany({
          where:  { email: { in: creators.map((c) => c.email) }, onboardingNudgeUnsub: false },
          select: { id: true, email: true, name: true, locale: true, status: true },
        })
      : []
    const opByEmail = new Map(creatorOps.map((o) => [o.email, o]))
    considered += creators.length
    for (const cr of creators) {
      const op = opByEmail.get(cr.email)
      if (!op) { skipped++; continue } // no login operator OR unsubscribed → skip, no send
      try {
        const signals: ChecklistSignals = {
          accountActive: op.status === 'active',
          hasBrand: false, hasRestaurant: false, menuItemCount: 0, isActive: false, stripeConnected: false,
          creatorProfileComplete: !!cr.bio && cr.bio.trim().length > 0,
          creatorPayoutReady:     cr.payoutStatus === 'active',
        }
        const progress = deriveOnboardingProgress(buildActivationChecklist('creator', signals))
        const r = await processCandidate(
          { operatorId: op.id, email: op.email, name: op.name, locale: op.locale, roleCreatedAtMs: cr.createdAt.getTime() },
          'creator', progress, now,
        )
        if (r === 'sent') sent++; else skipped++
      } catch (err) {
        skipped++
        console.error('[onboarding-nudge] creator failed', cr.email, err instanceof Error ? err.message : err)
      }
    }

    return NextResponse.json({ ok: true, considered, sent, skipped })
  } catch (err) {
    console.error('[onboarding-nudges run]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// Localized HTML — sober shell mirroring lib/transactional-emails (orange accent, navy text,
// 480px column), with dir="rtl" for Arabic. Strings are resolved by the caller (role-appropriate
// keys); this is a pure presentational renderer.
function renderNudgeHtml(p: {
  title: string; greeting: string; body: string; resumeCta: string
  unsubPrefix: string; unsubLink: string; resumeUrl: string; unsubUrl: string; rtl: boolean
}): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const dir = p.rtl ? 'rtl' : 'ltr'
  return `
    <div dir="${dir}" style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a2e;text-align:${p.rtl ? 'right' : 'left'}">
      <h2 style="color:#F97316">${esc(p.title)}</h2>
      <p>${esc(p.greeting)}</p>
      <p>${esc(p.body)}</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${p.resumeUrl}" style="background:#F97316;color:#fff;text-decoration:none;
           padding:14px 28px;border-radius:12px;font-weight:600;display:inline-block">
           ${esc(p.resumeCta)}
        </a>
      </p>
      <p style="font-size:12px;color:#9ca3af;margin-top:28px">
        ${esc(p.unsubPrefix)} <a href="${p.unsubUrl}" style="color:#9ca3af">${esc(p.unsubLink)}</a>.
      </p>
    </div>`
}
