'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from '@/navigation'
import { ArrowLeft, Copy, Tag } from 'lucide-react'
import { showToast } from '@/lib/eat-cart'

const HERO_OFFERS = [
  { tagKey: 'heroWeekendTag', titleKey: 'heroWeekendTitle', discount: '30' },
  { tagKey: 'heroNewTag', titleKey: 'heroNewTitle', discount: '20' },
  { tagKey: 'heroFreeTag', titleKey: 'heroFreeTitle', discount: '15' },
]

const CODES = [
  { code: 'FRENCH10', descKey: 'code1Desc', subKey: 'code1Sub' },
  { code: 'BIENVENUE', descKey: 'code2Desc', subKey: 'code2Sub' },
  { code: 'LIVRAISON0', descKey: 'code3Desc', subKey: 'code3Sub' },
]

export default function PromosScreen() {
  const t = useTranslations('eat.promos')
  const router = useRouter()

  function copy(code: string) {
    try {
      navigator.clipboard?.writeText(code)
    } catch {
      /* ignore */
    }
    showToast(t('copiedToast', { code }))
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <div className="flex items-center gap-3 border-b border-[#f0f0f0] bg-white px-4 pb-4 pt-3">
        <button onClick={() => router.back()} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f5f5f5] active:scale-90">
          <ArrowLeft size={20} className="text-[#1a1a1a]" />
        </button>
        <h1 className="font-sans text-[22px] font-extrabold text-[#1a1a1a]">{t('title')}</h1>
      </div>

      <div className="space-y-4 p-4">
        {/* Hero offers */}
        {HERO_OFFERS.map((o, i) => (
          <div key={i} className="relative flex h-[150px] overflow-hidden rounded-[20px] bg-[#F97316]">
            <div className="flex flex-1 flex-col justify-between p-4">
              <span className="self-start rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white">{t(o.tagKey)}</span>
              <p className="text-[17px] font-extrabold leading-tight text-white">{t(o.titleKey)}</p>
              <div className="flex items-end gap-1">
                <span className="text-xs text-white/90">{t('upTo')}</span>
                <span className="text-[34px] font-black leading-[38px] text-white">{o.discount}</span>
                <span className="mb-1 text-base font-bold text-white">%</span>
              </div>
            </div>
            <div className="flex w-[120px] items-center justify-center bg-white/10 text-5xl">🎁</div>
          </div>
        ))}

        {/* Promo codes */}
        <p className="px-1 pt-2 text-[17px] font-extrabold text-[#1a1a1a]">{t('promoCodes')}</p>
        {CODES.map((c) => (
          <div key={c.code} className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-bolt-card">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#FFF3ED]"><Tag size={20} className="text-[#F97316]" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-[#1a1a1a]">{t(c.descKey)}</p>
              <p className="text-xs text-[#888]">{t(c.subKey)}</p>
            </div>
            <button
              onClick={() => copy(c.code)}
              className="flex items-center gap-1.5 rounded-full border-[1.5px] border-dashed border-[#F97316] px-3 py-2 text-[13px] font-bold text-[#F97316] active:scale-95"
            >
              {c.code} <Copy size={13} />
            </button>
          </div>
        ))}

        <p className="px-2 pt-1 text-center text-xs text-[#aaa]">
          {t('footerHint')}
        </p>
      </div>
    </div>
  )
}
