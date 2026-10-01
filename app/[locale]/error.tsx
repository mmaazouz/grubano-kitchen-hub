'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Card, Button } from '@/components/design-system'
import { Link } from '@/navigation'

// ── app/[locale]/error.tsx — THE application error boundary (P0-15) ───────────
//
// Before this file, `app/` had NO error.tsx and NO global-error.tsx anywhere:
// any uncaught client exception, anywhere in the product, produced a silent
// BLANK PAGE with no message and no way back (this is exactly what made the
// /orders ToastProvider bug — P0-14 — invisible and unrecoverable).
//
// WHY HERE and not at the root of app/: this repo has no `app/layout.tsx`. The
// de-facto root layout is `app/[locale]/layout.tsx` — it is the only file that
// renders <html>/<body> and mounts <NextIntlClientProvider>. An error.tsx placed
// at the root of app/ would therefore render with NO html/body wrapper. Placed
// on the [locale] segment, this boundary:
//   • covers every page of the product (they all live under [locale]),
//   • is rendered INSIDE the layout, so the i18n provider is available and the
//     screen is fully localised in the 5 product locales,
//   • keeps the header/chrome around it, so the user is never stranded.
// The last-resort net for a failure of the layout ITSELF is app/global-error.tsx.
//
// Note: the pre-existing app/[locale]/eat/error.tsx keeps its own, more specific
// consumer visual (EatStateScreen "offline") — a nested boundary wins over this
// one for the /eat subtree, which is the intended Next.js behaviour.
export default function LocalizedError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('errors.boundary')

  useEffect(() => {
    // Diagnostics only — English in logs, per project convention. The full error
    // (message + stack) goes to the console/server logs, NEVER to the screen.
    console.error('[app] error boundary caught:', error)
  }, [error])

  return (
    <div className="mx-auto w-full max-w-md px-5 pt-16">
      <Card elevation="sm" padding="lg">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="text-4xl" aria-hidden="true">⚠️</span>
          <h1 className="font-display text-xl font-extrabold text-grubano-ink">{t('title')}</h1>
          <p className="text-sm text-grubano-ink-muted">{t('body')}</p>

          {/* PRODUCTION SAFETY: never surface a stack trace or a file path. Only
              Next's opaque `digest` is shown — it is a hash with no code detail,
              and it is what lets support correlate the incident with the server
              logs. The raw message is shown in development only. */}
          {error.digest && (
            <p className="text-[11px] text-grubano-ink-faint">
              {t('ref')} : <code className="font-mono">{error.digest}</code>
            </p>
          )}
          {process.env.NODE_ENV !== 'production' && (
            <pre className="mt-2 max-h-40 w-full overflow-auto rounded-grubano-lg bg-grubano-surface-muted p-2 text-left text-[11px] text-grubano-ink-muted">
              {error.message}
            </pre>
          )}

          <div className="mt-2 flex w-full flex-col gap-2">
            <Button variant="primary" size="md" fullWidth onClick={reset}>
              {t('retry')}
            </Button>
            <Link
              href="/"
              className="text-sm font-semibold text-grubano-primary underline underline-offset-2"
            >
              {t('home')}
            </Link>
          </div>
        </div>
      </Card>
    </div>
  )
}
