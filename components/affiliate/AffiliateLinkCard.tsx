'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link2, Copy, Check } from 'lucide-react'
import { Card, Button } from '@/components/design-system'

// ── AffiliateLinkCard — shows the affiliate's referral link + a copy button (Brique A) ──
// Read-only display of the instantly-minted link. No money: sharing the link only drives
// attribution once Brique B wires the credit. RTL-aware (the link itself stays dir="ltr").

export default function AffiliateLinkCard({ link, code }: { link: string; code: string }) {
  const t = useTranslations('affiliate')
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard unavailable — the field is selectable as a fallback */
    }
  }

  return (
    <Card elevation="sm" padding="md">
      <div className="flex items-center gap-2 mb-2">
        <Link2 size={16} className="text-grubano-primary rtl:-scale-x-100" />
        <p className="text-sm font-bold">{t('yourLinkTitle')}</p>
      </div>
      <p className="text-xs text-grubano-ink-muted mb-3">{t('yourLinkHint')}</p>

      <div className="flex items-stretch gap-2">
        <input
          readOnly
          value={link}
          dir="ltr"
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-grubano-lg border border-grubano-line bg-grubano-bg px-3 py-2 text-xs font-mono text-grubano-ink"
        />
        <Button
          variant="primary" size="sm"
          leftIcon={copied ? <Check size={14} /> : <Copy size={14} />}
          onClick={copy}
        >
          {copied ? t('copied') : t('copy')}
        </Button>
      </div>

      <p className="mt-2 text-[11px] text-grubano-ink-faint">
        {t('yourCode')} <span className="font-mono font-semibold text-grubano-ink-muted">{code}</span>
      </p>
    </Card>
  )
}
