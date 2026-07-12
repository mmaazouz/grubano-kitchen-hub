'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import { Card } from '@/components/design-system'
import { Sparkles, CheckCircle2, Circle, ArrowRight } from 'lucide-react'
import { deriveOnboardingProgress, type OnboardingProgress } from '@/lib/onboarding-progress'
import type { ActivationChecklist } from '@/lib/activation-checklist'

// ── OnboardingGuide — anti-abandon progress guide (Agent 93) ──────────────────────────
// SELF-GATING: probes GET /api/onboarding/guide; renders NOTHING when ONBOARDING_GUIDE_ENABLED
// is OFF → the establishment space stays byte-identical. When ON: reads the EXISTING
// owner-scoped GET /api/business/activation (the activation-checklist ENGINE — not forked,
// not recomputed) and derives a compact view: a progress bar (x / n, %), the step list
// (done / to-do), and a SINGLE prominent "Reprendre" CTA → the next actionable step. Hidden
// once the journey is complete. Purely presentational + a read — changes nothing.

type ActivationResp = { ok: boolean; checklist?: ActivationChecklist }

// ROLE-AWARE (Agent 98): the guide is mounted PER SURFACE with that surface's role — the
// establishment hub mounts <OnboardingGuide /> (no role → restaurant, byte-identical), the
// affiliate dashboard mounts <OnboardingGuide role="affiliate" />. The role only selects the
// activation query; the rendering (bar, step list, resume CTA) is role-agnostic and unchanged.
export default function OnboardingGuide({ role }: { role?: string } = {}) {
  const t  = useTranslations('onboardingGuide')
  const ta = useTranslations('activation') // reuse the EXISTING step titles (no new step labels)
  const [enabled, setEnabled]   = useState<boolean | null>(null)
  const [progress, setProgress] = useState<OnboardingProgress | null>(null)

  // 1) Flag probe — OFF → render nothing.
  useEffect(() => {
    let cancelled = false
    fetch('/api/onboarding/guide', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => { if (!cancelled) setEnabled(!!d?.enabled) })
      .catch(() => { if (!cancelled) setEnabled(false) })
    return () => { cancelled = true }
  }, [])

  // 2) When enabled, read the EXISTING owner-scoped activation engine + derive. The role (if
  //    any) selects the surface's checklist; no role → restaurant (byte-identical request).
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const url = role ? `/api/business/activation?role=${encodeURIComponent(role)}` : '/api/business/activation'
    fetch(url, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ActivationResp | null) => {
        if (cancelled) return
        if (d?.ok && d.checklist) setProgress(deriveOnboardingProgress(d.checklist))
      })
      .catch(() => { /* non-blocking — guide simply doesn't show */ })
    return () => { cancelled = true }
  }, [enabled, role])

  // OFF / unknown / not loaded / already complete → render nothing (byte-identical space).
  if (!enabled || !progress || progress.isComplete || progress.total === 0) return null

  const { total, done, progressPct, steps, nextStep } = progress

  return (
    <Card elevation="sm" padding="md" className="mb-4 border border-grubano-primary/25 bg-gradient-to-br from-grubano-tint/60 to-white">
      <div className="mb-2 flex items-start gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary text-white">
          <Sparkles size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-grubano-ink">{t('title')}</p>
          <p className="text-[12px] text-grubano-ink-muted">{t('subtitle')}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-1">
        <div className="mb-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-grubano-ink-faint">
          <span>{t('progress', { done, total })}</span>
          <span>{progressPct}%</span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-grubano-pill bg-grubano-surface-muted"
          role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}
        >
          <div className="h-full rounded-grubano-pill bg-grubano-primary transition-[width] duration-500 rtl:ml-auto" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {/* Compact step list (done / to-do) — titles read from the EXISTING activation namespace */}
      <ul className="mt-3 space-y-1">
        {steps.map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-[13px]">
            {s.done
              ? <CheckCircle2 size={15} className="shrink-0 text-grubano-success" />
              : <Circle size={15} className="shrink-0 text-grubano-ink-faint" />}
            <span className={s.done ? 'text-grubano-ink-muted line-through decoration-grubano-ink-faint/50' : 'text-grubano-ink'}>
              {ta(s.titleKey)}
            </span>
          </li>
        ))}
      </ul>

      {/* Single prominent "resume → next actionable step" CTA */}
      {nextStep && (
        <Link
          href={nextStep.ctaHref}
          className="mt-3 inline-flex items-center gap-1.5 rounded-grubano-md bg-grubano-primary px-3 py-1.5 text-[13px] font-bold text-white shadow-grubano-sm transition-colors hover:bg-grubano-primaryHover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/30"
        >
          {t('resume', { step: ta(nextStep.titleKey) })}
          <ArrowRight size={14} className="shrink-0 rtl:rotate-180" />
        </Link>
      )}
    </Card>
  )
}
