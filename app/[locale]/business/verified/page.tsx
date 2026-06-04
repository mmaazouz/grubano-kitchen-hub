'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { useTranslations } from 'next-intl'
import { ChefHat, ShieldCheck, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react'
import { Card, Button } from '@/components/design-system'

type VerifyStatus = 'success' | 'invalid' | 'expired' | 'used' | 'error'

const VALID_STATUSES: readonly VerifyStatus[] = ['success', 'invalid', 'expired', 'used', 'error']

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

  function goToAuth() {
    router.push('/business/auth')
  }

  return (
    <Card elevation="premium" padding="lg" className="w-full max-w-md text-center">
      <div
        className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full ${
          isSuccess ? 'bg-grubano-success/15' : 'bg-grubano-warning/15'
        }`}
      >
        {isSuccess ? (
          <CheckCircle2 size={36} className="text-grubano-success" />
        ) : (
          <AlertTriangle size={32} className="text-grubano-warning" />
        )}
      </div>

      <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{t(titleKey)}</h1>
      <p className="mt-3 whitespace-pre-line text-grubano-sm leading-relaxed text-grubano-ink-muted">
        {t(bodyKey)}
      </p>

      <div className="mt-6">
        <Button
          variant="primary"
          size="lg"
          fullWidth
          rightIcon={<ArrowRight size={16} />}
          onClick={goToAuth}
        >
          {isSuccess ? t('successCta') : t('errorCta')}
        </Button>
      </div>

      {!isSuccess && (
        <p className="mt-4 text-[11px] leading-relaxed text-grubano-ink-faint">
          {t('helpHint')}
        </p>
      )}
    </Card>
  )
}

function VerifiedFallback() {
  return (
    <Card elevation="premium" padding="lg" className="w-full max-w-md text-center">
      <div className="mx-auto mb-4 h-16 w-16 animate-pulse rounded-full bg-grubano-surface-muted" />
      <div className="mx-auto h-6 w-2/3 animate-pulse rounded bg-grubano-surface-muted" />
      <div className="mx-auto mt-3 h-4 w-3/4 animate-pulse rounded bg-grubano-surface-muted" />
    </Card>
  )
}

export default function PartnerVerifiedPage() {
  return (
    <Layout>
      <Suspense fallback={<VerifiedFallback />}>
        <VerifiedContent />
      </Suspense>
    </Layout>
  )
}

// ── Layout / brand chrome (matches /business/auth) ──────────────────────────

function Layout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('business.auth')
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-grubano-surface-muted/40 to-white">
      <header className="border-b border-grubano-border bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-grubano-md bg-grubano-dark text-grubano-primary shadow-grubano-sm">
              <ChefHat size={18} />
            </div>
            <div>
              <p className="font-display text-base font-extrabold leading-none text-grubano-ink">Grubano</p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-grubano-primary">
                {t('brandPartners')}
              </p>
            </div>
          </div>
          <span className="hidden items-center gap-1.5 rounded-grubano-pill bg-grubano-tint px-3 py-1 text-xs font-semibold text-grubano-primary sm:inline-flex">
            <ShieldCheck size={13} />
            {t('verifiedSpace')}
          </span>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl items-center justify-center px-5 pb-10 pt-16 md:pt-24">
        {children}
      </main>
    </div>
  )
}
