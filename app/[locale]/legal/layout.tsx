import { ChefHat } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import { LanguageSwitcher } from '@/components/design-system'

// ── /legal/* — public legal route group (Agent 34) ────────────────────────────
// Minimal SELF-CONTAINED public shell for the legal pages (mentions légales,
// politique de confidentialité…). Rendered BARE (this prefix is in AppChrome
// BARE_PREFIXES and is public in middleware) so it never wears the operator
// sidebar. No new shared chrome — just a sober header + footer in grubano tokens,
// like the other public spaces mount their own shell. RTL/dir is already set on
// <html> by the root locale layout.
export const dynamic = 'force-dynamic'

export default async function LegalLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  setRequestLocale(params.locale)
  const t = await getTranslations('legal')

  return (
    <div className="min-h-screen bg-grubano-bg">
      <a
        href="#legal-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-grubano-md focus:bg-grubano-ink focus:px-3 focus:py-2 focus:text-white"
      >
        {t('shell.skipToContent')}
      </a>

      <header className="border-b border-grubano-border bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-4">
          <Link href="/" className="flex items-center gap-2.5" aria-label={t('shell.backHome')}>
            <span className="grid h-8 w-8 place-items-center rounded-grubano-md bg-grubano-dark text-grubano-primary">
              <ChefHat size={16} />
            </span>
            <span className="font-display text-grubano-base font-bold text-grubano-ink">Grubano</span>
          </Link>
          <LanguageSwitcher variant="compact" />
        </div>
      </header>

      <main id="legal-content" className="mx-auto max-w-3xl px-5 py-8">
        {children}
      </main>

      <footer className="border-t border-grubano-border bg-grubano-surface-muted/40">
        <div className="mx-auto max-w-3xl px-5 py-6">
          <p className="mb-2 text-grubano-xs font-semibold uppercase tracking-wide text-grubano-ink-faint">
            {t('shell.otherPages')}
          </p>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-grubano-sm font-medium text-grubano-ink-muted">
            <Link href="/legal/mentions-legales" className="transition-colors hover:text-grubano-primary">
              {t('nav.mentions')}
            </Link>
            <Link href="/legal/confidentialite" className="transition-colors hover:text-grubano-primary">
              {t('nav.confidentialite')}
            </Link>
            <Link href="/" className="transition-colors hover:text-grubano-primary">
              {t('shell.backHome')}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
