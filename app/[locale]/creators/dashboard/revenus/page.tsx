'use client'

import { useTranslations } from 'next-intl'
import { TrendingUp } from 'lucide-react'
import { Link } from '@/navigation'
import { EmptyState, Button } from '@/components/design-system'

export default function CreatorRevenusPage() {
  const t = useTranslations('creators.nav')
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <EmptyState
        emoji={<TrendingUp size={32} className="text-grubano-primary" />}
        title={t('revenue')}
        description="Le détail de vos commissions, versements et historique de revenus sera disponible prochainement."
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
