import type { ActivationChecklist } from '@/lib/activation-checklist'

// ── Onboarding guide — progress derivation (anti-abandon, Agent 93) ───────────────────
//
// PURE, READ-ONLY transform of the EXISTING activation checklist (lib/activation-checklist,
// served owner-scoped by GET /api/business/activation) into a compact "resume" view: how
// many steps are done, the % (READ from the engine, never recomputed differently), whether
// the journey is complete, the step titles + done flags, and the NEXT actionable step to
// resume on. It NEVER redefines the steps nor recomputes their status — it reads the engine's
// `state` / `progressPct` / `isDiscovery`. No I/O, no DB, no schema → fully unit-testable.

/** Kill-switch — default OFF. Only the exact string 'true' shows the onboarding guide. */
export function isOnboardingGuideEnabled(): boolean {
  return process.env.ONBOARDING_GUIDE_ENABLED === 'true'
}

export interface GuideStep {
  id:       string
  titleKey: string
  done:     boolean
}

export interface ResumeTarget {
  id:       string
  titleKey: string
  ctaKey:   string
  ctaHref:  string
}

export interface OnboardingProgress {
  total:       number
  done:        number
  progressPct: number
  isComplete:  boolean
  steps:       GuideStep[]
  /** The earliest non-done step the owner can ACT on (has a CTA) — the "resume" target.
   *  null when nothing is actionable (all done, or the only frontier is admin-gated). */
  nextStep:    ResumeTarget | null
}

/**
 * Derive the compact guide view from the engine's checklist. The status comes straight
 * from the engine (step.state, checklist.progressPct, checklist.isDiscovery) — this never
 * introduces a second source of truth. The resume target is the FIRST step in the engine's
 * order that is not done AND carries an actionable CTA (ctaHref + ctaKey); a frontier with
 * no CTA (e.g. admin-gated "publish — awaiting validation") is skipped so "resume" always
 * points at something the owner can actually do.
 */
export function deriveOnboardingProgress(checklist: ActivationChecklist): OnboardingProgress {
  const steps = Array.isArray(checklist?.steps) ? checklist.steps : []
  const total = steps.length
  const done  = steps.filter((s) => s.state === 'done').length

  const progressPct =
    typeof checklist?.progressPct === 'number'
      ? checklist.progressPct
      : total === 0 ? 100 : Math.round((done / total) * 100)

  const actionable = steps.find((s) => s.state !== 'done' && !!s.ctaHref && !!s.ctaKey)
  const nextStep: ResumeTarget | null =
    actionable && actionable.ctaHref && actionable.ctaKey
      ? { id: actionable.id, titleKey: actionable.titleKey, ctaKey: actionable.ctaKey, ctaHref: actionable.ctaHref }
      : null

  return {
    total,
    done,
    progressPct,
    isComplete: !checklist?.isDiscovery,
    steps: steps.map((s) => ({ id: s.id, titleKey: s.titleKey, done: s.state === 'done' })),
    nextStep,
  }
}
