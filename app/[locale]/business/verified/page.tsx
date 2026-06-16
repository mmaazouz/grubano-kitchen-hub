'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { useTranslations } from 'next-intl'
import { CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react'
import { Card, Button } from '@/components/design-system'
import PartnerChrome from '@/components/business/PartnerChrome'

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
    router.push('/auth/magic')
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

// ── Layout — the shared partner chrome (P4 unification, Agent 20) ────────────
// Delegates the header/background to <PartnerChrome> (same chrome as the landing /
// /business/start). Content (the verified-state card) is unchanged.
function Layout({ children }: { children: React.ReactNode }) {
  return <PartnerChrome>{children}</PartnerChrome>
}
