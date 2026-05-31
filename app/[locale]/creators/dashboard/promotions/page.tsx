'use client'

import { useTranslations } from 'next-intl'
import { Tag } from 'lucide-react'
import { Link } from '@/navigation'
import { EmptyState, Button } from '@/components/design-system'

export default function CreatorPromotionsPage() {
  const t = useTranslations('creators.nav')
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <EmptyState
        emoji={<Tag size={32} className="text-grubano-primary" />}
        title={t('promotions')}
        description="La gestion de vos promotions et codes promo sera disponible prochainement."
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
