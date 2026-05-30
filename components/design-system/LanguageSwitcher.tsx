'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Check, ChevronDown, Globe } from 'lucide-react'
import { usePathname, useRouter } from '@/navigation'
import { locales, type Locale } from '@/i18n'

const FLAG: Record<Locale, string> = {
  fr: '🇫🇷',
  en: '🇬🇧',
  es: '🇪🇸',
  ar: '🇲🇦',
  it: '🇮🇹',
}

// Native names — intentionally NOT translated.
const NATIVE: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  es: 'Español',
  ar: 'العربية',
  it: 'Italiano',
}

export interface LanguageSwitcherProps {
  /** Compact shows only the flag; full shows flag + native name. */
  variant?: 'compact' | 'full'
  className?: string
}

export function LanguageSwitcher({ variant = 'full', className = '' }: LanguageSwitcherProps) {
  const t = useTranslations('languageSwitcher')
  const locale = useLocale() as Locale
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  function select(next: Locale) {
    setOpen(false)
    if (next === locale) return
    // Persist preference so middleware honours it on future visits.
    document.cookie = `NEXT_LOCALE=${next};path=/;max-age=31536000;samesite=lax`
    router.replace(pathname, { locale: next })
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('label')}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-grubano-pill border border-grubano-border bg-grubano-surface px-3 py-2 text-grubano-sm font-medium text-grubano-ink transition-colors hover:bg-grubano-surface-muted"
      >
        <Globe className="h-4 w-4 text-grubano-ink-muted" aria-hidden />
        <span className="text-base leading-none">{FLAG[locale]}</span>
        {variant === 'full' && <span>{NATIVE[locale]}</span>}
        <ChevronDown className={`h-4 w-4 text-grubano-ink-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute end-0 z-50 mt-2 w-44 overflow-hidden rounded-grubano-lg border border-grubano-border bg-grubano-surface py-1 shadow-grubano-lg animate-fade-in"
        >
          {locales.map((loc) => (
            <li key={loc}>
              <button
                type="button"
                role="option"
                aria-selected={loc === locale}
                onClick={() => select(loc)}
                className="flex w-full items-center gap-3 px-3 py-2 text-start text-grubano-sm text-grubano-ink transition-colors hover:bg-grubano-surface-muted"
              >
                <span className="text-base leading-none">{FLAG[loc]}</span>
                <span className="flex-1">{NATIVE[loc]}</span>
                {loc === locale && <Check className="h-4 w-4 text-grubano-primary" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
