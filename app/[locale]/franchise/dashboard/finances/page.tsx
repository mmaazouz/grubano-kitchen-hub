'use client'

import { useTranslations } from 'next-intl'
import { CreditCard } from 'lucide-react'
import { Link } from '@/navigation'
import { EmptyState, Button } from '@/components/design-system'

export default function FranchiseFinancesPage() {
  const t = useTranslations('franchise.nav')
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <EmptyState
        emoji={<CreditCard size={32} className="text-grubano-primary" />}
        title={t('finances')}
        description="Le suivi des royalties et de la trésorerie sera disponible prochainement."
        action={
          <Link href="/franchise/dashboard">
            <Button variant="primary" size="sm">
              {t('overview')}
            </Button>
          </Link>
        }
      />
    </div>
  )
}
