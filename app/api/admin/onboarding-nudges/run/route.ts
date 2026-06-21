import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { getTranslations } from 'next-intl/server'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildActivationChecklist, type ChecklistSignals } from '@/lib/activation-checklist'
import { deriveOnboardingProgress } from '@/lib/onboarding-progress'
import {
  isOnboardingNudgeEnabled, decideNudgeLevel, resolveNudgeLocale,
  mintUnsubscribeToken, NUDGE_AGE_MS,
} from '@/lib/onboarding-nudge'
import { sendTransactional } from '@/lib/transactional-emails'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/onboarding-nudges/run — anti-abandon nudge emails (Agent 95) ──────
// A cron/admin batch that emails restaurateurs whose ONBOARDING is INCOMPLETE a reminder,
// at a FIXED cadence (J+1 / J+3 / J+7, max 3), in their language, with a deep link to the
// next step + a one-click unsubscribe. SENSITIVE (real emails) → ÉLEVÉE.
//   GATE 1: ONBOARDING_NUDGE_ENABLED kill-switch (default OFF) → 403, NO send, NO write.
//   GATE 2: INTERNAL_CRON_TOKEN via x-internal-token, OR an admin session (mirror of the
//           other admin/*/run crons).
// Per account (best-effort, isolated): build the checklist (REUSED engine) → decide the due
// level → CLAIM it via OnboardingNudge.create (@@unique([operatorId,level]) = no double-send,
// re-run/concurrent-safe) → only then SEND. STOP conditions (complete / unsubscribed / ≥3)
// are enforced in decideNudgeLevel. READS onboarding state; WRITES only nudge state — ZERO money.

const BATCH_CAP = 500

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL || 'https://app.grubano.com').replace(/\/$/, '')
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
    const earliest = new Date(now - NUDGE_AGE_MS[1]) // never even consider an account younger than level-1's age

    // Candidates: restaurateurs old enough, NOT unsubscribed. Completion + level/cadence are
    // decided per account below (the cheap filters narrow the set first).
    const candidates = await prisma.operator.findMany({
      where:   { role: 'restaurant', onboardingNudgeUnsub: false, createdAt: { lte: earliest } },
      select:  { id: true, email: true, name: true, locale: true, createdAt: true, status: true, emailVerifiedAt: true },
      orderBy: { createdAt: 'asc' },
      take:    BATCH_CAP,
    })

    let sent = 0, skipped = 0
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
        const progress   = deriveOnboardingProgress(buildActivationChecklist('restaurant', signals))
        const sentLevels = (await prisma.onboardingNudge.findMany({ where: { operatorId: op.id }, select: { level: true } })).map((r) => r.level)

        const level = decideNudgeLevel({
          nowMs: now, createdAtMs: op.createdAt.getTime(),
          sentLevels, unsubscribed: false, isComplete: progress.isComplete,
        })
        if (!level) { skipped++; continue }

        // CLAIM the level BEFORE sending: the @@unique([operatorId,level]) makes this atomic,
        // so a re-run or a concurrent run hits P2002 and skips → a level is emailed AT MOST ONCE.
        try {
          await prisma.onboardingNudge.create({ data: { operatorId: op.id, level } })
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') { skipped++; continue }
          throw err
        }

        // Build the localized email (deep link to the next step + tokenised unsubscribe).
        const locale = resolveNudgeLocale(op.locale)
        const t      = await getTranslations({ locale, namespace: 'onboardingNudge' })
        const stepsRemaining = Math.max(0, progress.total - progress.done)
        const resumePath = progress.nextStep?.ctaHref ?? '/dashboard'
        const resumeUrl  = `${baseUrl()}/${locale}${resumePath}`
        const unsubUrl   = `${baseUrl()}/api/onboarding/unsubscribe?token=${encodeURIComponent(mintUnsubscribeToken(op.id))}`

        await sendTransactional({
          to:      op.email,
          subject: t('subject', { steps: stepsRemaining }),
          trigger: 'onboarding_nudge',
          html:    renderNudgeHtml(t, { name: op.name, steps: stepsRemaining, resumeUrl, unsubUrl, rtl: locale === 'ar' }),
        })
        sent++
      } catch (err) {
        // Per-account isolation: one failure never stops the batch.
        skipped++
        console.error('[onboarding-nudge] account failed', op.id, err instanceof Error ? err.message : err)
      }
    }

    return NextResponse.json({ ok: true, considered: candidates.length, sent, skipped })
  } catch (err) {
    console.error('[onboarding-nudges run]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// Localized HTML — sober shell mirroring lib/transactional-emails (orange accent, navy text,
// 480px column), with dir="rtl" for Arabic. Strings come from the onboardingNudge i18n ns.
function renderNudgeHtml(
  t: (k: string, v?: Record<string, string | number>) => string,
  p: { name: string; steps: number; resumeUrl: string; unsubUrl: string; rtl: boolean },
): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const dir = p.rtl ? 'rtl' : 'ltr'
  return `
    <div dir="${dir}" style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a2e;text-align:${p.rtl ? 'right' : 'left'}">
      <h2 style="color:#F97316">${esc(t('title'))}</h2>
      <p>${esc(t('greeting', { name: p.name }))}</p>
      <p>${esc(t('body', { steps: p.steps }))}</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${p.resumeUrl}" style="background:#F97316;color:#fff;text-decoration:none;
           padding:14px 28px;border-radius:12px;font-weight:600;display:inline-block">
           ${esc(t('resumeCta'))}
        </a>
      </p>
      <p style="font-size:12px;color:#9ca3af;margin-top:28px">
        ${esc(t('unsubPrefix'))} <a href="${p.unsubUrl}" style="color:#9ca3af">${esc(t('unsubLink'))}</a>.
      </p>
    </div>`
}
