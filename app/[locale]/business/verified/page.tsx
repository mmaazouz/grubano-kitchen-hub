'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { useTranslations } from 'next-intl'
import PartnerShell, { type PartnerStep } from '@/components/business/PartnerShell'

type VerifyStatus = 'success' | 'invalid' | 'expired' | 'used' | 'error'

const VALID_STATUSES: readonly VerifyStatus[] = ['success', 'invalid', 'expired', 'used', 'error']

// PRÉSENTATION (PartnerShell, mode parcours — référence partner-shell.html) :
// message .note--ok (succès) / .note--warn (lien expiré ou déjà utilisé) /
// .note--error (invalide, erreur), bouton .btn, frise « Compte » (faite si succès,
// en cours sinon). Logique INCHANGÉE : lecture de ?status=, repli 'error', CTA →
// /auth/magic, Suspense autour de useSearchParams.

function useSteps(success: boolean): PartnerStep[] {
  const tShell = useTranslations('business.shell')
  return [
    { label: tShell('stepAccount'),       state: success ? 'done' : 'now' },
    { label: tShell('stepEstablishment'), state: 'todo' },
    { label: tShell('stepVerification'),  state: 'todo' },
    { label: tShell('stepGoLive'),        state: 'todo' },
  ]
}

function VerifiedContent() {
  const t = useTranslations('business.verified')
  const router = useRouter()
  const params = useSearchParams()

  // Unknown / missing `status` falls back to a generic error so the page never
  // crashes if the user opens the URL directly without coming from the API.
  const raw = params.get('status') ?? ''
  const status: VerifyStatus = (VALID_STATUSES as readonly string[]).includes(raw)
    ? (raw as VerifyStatus)
    : 'error'

  const isSuccess = status === 'success'
  const steps = useSteps(isSuccess)

  const titleKey =
    status === 'success' ? 'successTitle'
    : status === 'expired' ? 'expiredTitle'
    : status === 'used'    ? 'usedTitle'
    : status === 'invalid' ? 'invalidTitle'
    : 'errorTitle'

  const bodyKey =
    status === 'success' ? 'successBody'
    : status === 'expired' ? 'expiredBody'
    : status === 'used'    ? 'usedBody'
    : status === 'invalid' ? 'invalidBody'
    : 'errorBody'

  // Reference message grammar: ok (success) · warn (expired / used) · error (invalid / error).
  const tone = isSuccess ? 'ok' : status === 'expired' || status === 'used' ? 'warn' : 'error'
  const icon = tone === 'ok' ? 'check_circle' : tone === 'warn' ? 'pending' : 'error'

  function goToAuth() {
    router.push('/auth/magic')
  }

  return (
    <PartnerShell mode="parcours" exitHref="/business" steps={steps}>
      <div className="card card--raised card__pad">
        <div className={`note note--${tone}`} role={isSuccess ? 'status' : 'alert'}>
          <span className="ms" aria-hidden="true">{icon}</span>
          <span>
            <b>{t(titleKey)}</b>{' '}
            <span style={{ whiteSpace: 'pre-line' }}>{t(bodyKey)}</span>
          </span>
        </div>

        <button type="button" className="btn btn--lg btn--primary btn--block" onClick={goToAuth} style={{ marginTop: 'var(--pt-4)' }}>
          {isSuccess ? t('successCta') : t('errorCta')}
          <span className="ms flip-rtl" aria-hidden="true">arrow_forward</span>
        </button>

        {!isSuccess && (
          <p className="t-help" style={{ textAlign: 'center', marginTop: 'var(--pt-3)' }}>
            {t('helpHint')}
          </p>
        )}
      </div>
    </PartnerShell>
  )
}

function VerifiedFallback() {
  const steps = useSteps(false)
  return (
    <PartnerShell mode="parcours" exitHref="/business" steps={steps}>
      <div className="card card--raised card__pad" aria-busy="true">
        <span className="sk" style={{ height: 18, width: '60%' }} />
        <span className="sk" style={{ height: 14, width: '85%', marginTop: 10 }} />
        <span className="sk" style={{ height: 44, marginTop: 16 }} />
      </div>
    </PartnerShell>
  )
}

export default function PartnerVerifiedPage() {
  return (
    <Suspense fallback={<VerifiedFallback />}>
      <VerifiedContent />
    </Suspense>
  )
}
