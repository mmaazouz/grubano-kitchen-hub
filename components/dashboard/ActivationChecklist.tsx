'use client'

/**
 * ActivationChecklist — discovery banner + activation checklist (B1.2, Agent 28).
 *
 * Client island for the restaurateur dashboard home. Fetches the OWNER-SCOPED,
 * READ-ONLY GET /api/business/activation (session-resolved, no IDOR) and renders:
 *   • a welcoming "discovery mode" banner with a progress bar, while isDiscovery;
 *   • the ordered steps with done / current / todo / locked states + just-in-time
 *     CTAs to EXISTING pages (onboarding, menu, finance).
 *
 * Honest to the server: the "go live" step is admin-gated (SEC1), so a complete-
 * but-unpublished establishment shows a read-only "awaiting Grubano validation"
 * state with NO publish button. When every step is done (isDiscovery=false) the
 * whole block is hidden — the home stays uncluttered for live operators.
 *
 * Purely presentational + a read: it changes no gating and promises nothing the
 * server would refuse.
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import { Card } from '@/components/design-system'
import { CheckCircle2, Circle, Lock, Sparkles, Clock, ArrowRight, Loader2 } from 'lucide-react'

type StepState = 'done' | 'current' | 'todo' | 'locked'
interface Step {
  id:                string
  gate:              number
  titleKey:          string
  descriptionKey:    string
  state:             StepState
  ctaKey?:           string
  ctaHref?:          string
  blockedReasonKey?: string
}
interface Checklist {
  role:          string
  steps:         Step[]
  progressPct:   number
  currentStepId: string | null
  isDiscovery:   boolean
}
type Resp = { ok: boolean; role?: string; checklist?: Checklist }

export default function ActivationChecklist() {
  const t = useTranslations('activation')
  const [checklist, setChecklist] = useState<Checklist | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/business/activation', { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as Resp
        if (cancelled) return
        if (!data.ok || !data.checklist) throw new Error('payload')
        setChecklist(data.checklist)
        setPhase('ready')
      } catch {
        if (!cancelled) setPhase('error')
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Loading — a slim placeholder so the home does not jump.
  if (phase === 'loading') {
    return (
      <div className="mb-5 flex items-center gap-2 text-grubano-sm text-grubano-ink-muted" aria-busy="true">
        <Loader2 size={16} className="animate-spin" />
        <span>{t('title')}…</span>
      </div>
    )
  }

  // Load error — subtle, non-blocking (the rest of the home still renders).
  if (phase === 'error') {
    return (
      <Card elevation="sm" padding="md" className="mb-5 border border-grubano-border">
        <p className="text-grubano-sm text-grubano-ink-muted">{t('loadError')}</p>
      </Card>
    )
  }

  // All steps done → hide the block entirely (home stays clean for live operators).
  if (!checklist || !checklist.isDiscovery) return null

  const { steps, progressPct, currentStepId } = checklist
  const doneCount = steps.filter((s) => s.state === 'done').length

  return (
    <section
      aria-label={t('title')}
      className="mb-6 overflow-hidden rounded-grubano-xl border border-grubano-primary/25 bg-gradient-to-br from-grubano-tint/70 to-white shadow-grubano-sm"
    >
      {/* Discovery banner */}
      <div className="flex items-start gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary text-white shadow-grubano-sm">
          <Sparkles size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-extrabold leading-tight text-grubano-ink">
            {t('banner.title')}
          </h2>
          <p className="mt-0.5 text-grubano-sm text-grubano-ink-muted">{t('banner.subtitle')}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-4 pt-3 sm:px-5">
        <div className="mb-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-grubano-ink-faint">
          <span>{t('progress', { done: doneCount, total: steps.length })}</span>
          <span>{progressPct}%</span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-grubano-pill bg-grubano-surface-muted"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-grubano-pill bg-grubano-primary transition-[width] duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      <ol className="mt-2 flex flex-col gap-1 p-3 sm:p-4">
        {steps.map((step) => (
          <StepRow key={step.id} step={step} isCurrent={step.id === currentStepId} t={t} />
        ))}
      </ol>
    </section>
  )
}

function StepRow({
  step,
  isCurrent,
  t,
}: {
  step: Step
  isCurrent: boolean
  t: ReturnType<typeof useTranslations>
}) {
  const locked = step.state === 'locked'
  const done   = step.state === 'done'

  const icon =
    done ? <CheckCircle2 size={20} className="text-grubano-success" />
    : locked ? <Lock size={16} className="text-grubano-ink-faint" />
    : step.blockedReasonKey === 'blocked.awaitingApproval'
      ? <Clock size={18} className="text-grubano-warning" />
      : <Circle size={18} className={isCurrent ? 'text-grubano-primary' : 'text-grubano-ink-faint'} />

  const statusKey =
    done ? 'status.done'
    : step.state === 'current' ? 'status.current'
    : step.state === 'todo' ? 'status.todo'
    : 'status.locked'

  return (
    <li
      className={[
        'flex items-start gap-3 rounded-grubano-lg px-3 py-2.5 transition-colors',
        isCurrent ? 'bg-white shadow-grubano-sm ring-1 ring-grubano-primary/20' : '',
        locked ? 'opacity-60' : '',
      ].join(' ')}
    >
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center" aria-hidden="true">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={`text-grubano-sm font-bold ${done ? 'text-grubano-ink-muted line-through decoration-grubano-ink-faint/50' : 'text-grubano-ink'}`}>
            {t(step.titleKey)}
          </span>
          <span className="sr-only">{t(statusKey)}</span>
        </div>
        <p className="mt-0.5 text-[13px] leading-snug text-grubano-ink-muted">{t(step.descriptionKey)}</p>

        {step.blockedReasonKey && (
          <p className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-grubano-ink-faint">
            {step.blockedReasonKey === 'blocked.awaitingApproval'
              ? <Clock size={12} className="shrink-0" />
              : <Lock size={12} className="shrink-0" />}
            {t(step.blockedReasonKey)}
          </p>
        )}

        {/* Just-in-time CTA — only when the server actually allows the action.
            There is intentionally NO "publish" CTA: going live is admin-only. */}
        {step.ctaKey && step.ctaHref && (
          <Link
            href={step.ctaHref}
            className="mt-2 inline-flex items-center gap-1 rounded-grubano-md bg-grubano-primary px-3 py-1.5 text-[13px] font-bold text-white shadow-grubano-sm transition-colors hover:bg-grubano-primaryHover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/30"
          >
            {t(step.ctaKey)}
            <ArrowRight size={14} className="shrink-0" />
          </Link>
        )}
      </div>
    </li>
  )
}
