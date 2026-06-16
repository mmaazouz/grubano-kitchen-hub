'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import { Bike, ShieldCheck, Mail, ArrowLeft, Sparkles } from 'lucide-react'
import { Card, Button } from '@/components/design-system'
import PartnerChrome from '@/components/business/PartnerChrome'

/**
 * Light "coming soon" placeholder for the LOGISTICS / courier partner. The full
 * courier onboarding is a later slice — this page sets expectations + offers a
 * human contact, and never leaves the "Logistique" card as a dead link.
 */
export default function LogisticsSoonPage() {
  const t = useTranslations('business.logisticsSoon')

  return (
    <PartnerChrome>
      <Card elevation="premium" padding="lg" className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#2563EB]/12 text-[#2563EB]">
          <Bike size={32} />
        </div>

        <span className="mx-auto inline-flex items-center gap-1.5 rounded-grubano-pill bg-grubano-tint px-3 py-1 text-xs font-bold text-grubano-primary">
          <Sparkles size={13} />
          {t('badge')}
        </span>

        <h1 className="mt-3 font-display text-2xl font-extrabold text-grubano-ink">{t('title')}</h1>
        <p className="mt-2 whitespace-pre-line text-grubano-sm leading-relaxed text-grubano-ink-muted">{t('body')}</p>

        <div className="mt-4 flex items-center justify-center gap-2 rounded-grubano-md bg-grubano-surface-muted px-3 py-2.5 text-grubano-sm font-semibold text-grubano-ink">
          <ShieldCheck size={15} className="text-grubano-primary" />
          {t('dedicatedSupport')}
        </div>

        <div className="mt-6 space-y-2">
          <a href="mailto:contact@grubano.com?subject=Logistique%20Grubano">
            <Button variant="primary" size="lg" fullWidth leftIcon={<Mail size={16} />}>
              {t('contactCta')}
            </Button>
          </a>
          <Link href="/business/start" className="block">
            <Button variant="ghost" size="md" fullWidth leftIcon={<ArrowLeft size={16} />}>
              {t('back')}
            </Button>
          </Link>
        </div>
      </Card>
    </PartnerChrome>
  )
}
