'use client'

import { useTranslations } from 'next-intl'
import { Users2 } from 'lucide-react'
import { Link } from '@/navigation'
import { EmptyState, Button } from '@/components/design-system'

export default function CreatorAudiencePage() {
  const t = useTranslations('creators.nav')
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <EmptyState
        emoji={<Users2 size={32} className="text-grubano-primary" />}
        title={t('audience')}
        description="Les statistiques d'audience et de parrainage sont accessibles depuis le tableau de bord principal."
        action={
          <Link href="/creators/dashboard">
            <Button variant="primary" size="sm">
              {t('overview')}
            </Button>
          </Link>
        }
      />
    </div>
  )
}
