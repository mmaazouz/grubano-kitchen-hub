import { describe, it, expect } from 'vitest'
import { deriveOnboardingProgress, isOnboardingGuideEnabled } from '@/lib/onboarding-progress'
import type { ActivationChecklist, ChecklistStep } from '@/lib/activation-checklist'

// ── Onboarding guide — progress derivation (Agent 93) ─────────────────────────────────
// Pure transform of the EXISTING engine output. Reads state/progressPct/isDiscovery; never
// recomputes status. The resume target = earliest non-done step with an actionable CTA.

const step = (over: Partial<ChecklistStep> & Pick<ChecklistStep, 'id' | 'state'>): ChecklistStep => ({
  gate: 0, titleKey: `steps.${over.id}.title`, descriptionKey: `steps.${over.id}.desc`, ...over,
})

function checklist(steps: ChecklistStep[]): ActivationChecklist {
  const done = steps.filter((s) => s.state === 'done').length
  const progressPct = steps.length === 0 ? 100 : Math.round((done / steps.length) * 100)
  const current = steps.find((s) => s.state === 'current') ?? steps.find((s) => s.state === 'todo') ?? steps.find((s) => s.state === 'locked') ?? null
  return { role: 'restaurant', steps, progressPct, currentStepId: current?.id ?? null, isDiscovery: steps.some((s) => s.state !== 'done') }
}

describe('deriveOnboardingProgress', () => {
  it('early journey: counts done, reads %, resumes on the first actionable step', () => {
    const c = checklist([
      step({ id: 'account', state: 'done' }),
      step({ id: 'establishment', state: 'current', ctaKey: 'steps.establishment.cta', ctaHref: '/business/onboarding' }),
      step({ id: 'menu', state: 'locked', blockedReasonKey: 'blocked.needEstablishment' }),
      step({ id: 'publish', state: 'locked' }),
      step({ id: 'payments', state: 'todo', ctaKey: 'steps.payments.cta', ctaHref: '/finance' }),
      step({ id: 'payouts', state: 'locked' }),
    ])
    const p = deriveOnboardingProgress(c)
    expect(p.total).toBe(6)
    expect(p.done).toBe(1)
    expect(p.progressPct).toBe(c.progressPct)          // READ from the engine, not recomputed
    expect(p.isComplete).toBe(false)
    expect(p.nextStep?.id).toBe('establishment')        // earliest non-done WITH a CTA
    expect(p.nextStep?.ctaHref).toBe('/business/onboarding')
    expect(p.steps.find((s) => s.id === 'account')?.done).toBe(true)
  })

  it('⚠️ RESUME skips an admin-gated frontier with no CTA (publish awaiting) → next actionable', () => {
    const c = checklist([
      step({ id: 'account', state: 'done' }),
      step({ id: 'establishment', state: 'done' }),
      step({ id: 'menu', state: 'done' }),
      // current frontier is publish, but it's admin-gated → NO cta
      step({ id: 'publish', state: 'current', blockedReasonKey: 'blocked.awaitingApproval' }),
      step({ id: 'payments', state: 'todo', ctaKey: 'steps.payments.cta', ctaHref: '/finance' }),
      step({ id: 'payouts', state: 'locked' }),
    ])
    const p = deriveOnboardingProgress(c)
    expect(p.nextStep?.id).toBe('payments')             // skips publish (no CTA), resumes on payments
    expect(p.nextStep?.ctaHref).toBe('/finance')
  })

  it('no actionable step (only a CTA-less frontier remains) → nextStep null', () => {
    const c = checklist([
      step({ id: 'account', state: 'done' }),
      step({ id: 'establishment', state: 'done' }),
      step({ id: 'menu', state: 'done' }),
      step({ id: 'publish', state: 'current', blockedReasonKey: 'blocked.awaitingApproval' }),
      step({ id: 'payments', state: 'done' }),
      step({ id: 'payouts', state: 'done' }),
    ])
    const p = deriveOnboardingProgress(c)
    expect(p.isComplete).toBe(false)
    expect(p.nextStep).toBeNull()
  })

  it('all done → isComplete true (the guide hides)', () => {
    const c = checklist([
      step({ id: 'account', state: 'done' }),
      step({ id: 'establishment', state: 'done' }),
      step({ id: 'menu', state: 'done' }),
      step({ id: 'publish', state: 'done' }),
      step({ id: 'payments', state: 'done' }),
      step({ id: 'payouts', state: 'done' }),
    ])
    const p = deriveOnboardingProgress(c)
    expect(p.done).toBe(6)
    expect(p.progressPct).toBe(100)
    expect(p.isComplete).toBe(true)
    expect(p.nextStep).toBeNull()
  })

  it('empty / malformed checklist → safe defaults (never throws)', () => {
    const empty = deriveOnboardingProgress({ role: 'x', steps: [], progressPct: 100, currentStepId: null, isDiscovery: false })
    expect(empty.total).toBe(0)
    expect(empty.isComplete).toBe(true)
    expect(empty.nextStep).toBeNull()
    // a defensive call with a half-shaped object still doesn't throw
    expect(() => deriveOnboardingProgress({} as unknown as ActivationChecklist)).not.toThrow()
  })
})

describe('isOnboardingGuideEnabled — flag', () => {
  it('only the exact string true enables it', () => {
    delete process.env.ONBOARDING_GUIDE_ENABLED
    expect(isOnboardingGuideEnabled()).toBe(false)
    process.env.ONBOARDING_GUIDE_ENABLED = 'true'
    expect(isOnboardingGuideEnabled()).toBe(true)
    process.env.ONBOARDING_GUIDE_ENABLED = '1'
    expect(isOnboardingGuideEnabled()).toBe(false)
    delete process.env.ONBOARDING_GUIDE_ENABLED
  })
})
