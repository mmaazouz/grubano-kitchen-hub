'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from '@/navigation'
import { ArrowLeft, Tag } from 'lucide-react'

/**
 * /eat/promos — neutralized showcase (founder decision, audit C3-fix §4).
 *
 * The previous page ADVERTISED fake offers and the client-only FRENCH10 code
 * (a 100% client decor that made the cart total lie vs the real debit — the
 * promo never reached the server, the charge, the fee or the ledger). Until
 * the real « Promotions Restaurateur » governance lands (server-resolved
 * Promotion model, restaurant-funded), this route stays alive (old links
 * never 404) as a sober "coming soon" — and reminds the guest that the only
 * REAL discount today (welcome) is applied automatically at checkout.
 */
export default function PromosScreen() {
  const t = useTranslations('eat.promos')
  const router = useRouter()

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <div className="flex items-center gap-3 border-b border-[#f0f0f0] bg-white px-4 pb-4 pt-3">
        <button onClick={() => router.back()} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f5f5f5] active:scale-90">
          <ArrowLeft size={20} className="text-[#1a1a1a]" />
        </button>
        <h1 className="font-sans text-[22px] font-extrabold text-[#1a1a1a]">{t('title')}</h1>
      </div>

      <div className="p-4">
        <div className="rounded-[20px] bg-white p-8 text-center shadow-bolt-card">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#FFF3ED] text-[#F97316]">
            <Tag size={24} />
          </span>
          <p className="mt-4 text-[17px] font-extrabold text-[#1a1a1a]">{t('soonTitle')}</p>
          <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-[#888]">{t('soonBody')}</p>
        </div>
      </div>
    </div>
  )
}
