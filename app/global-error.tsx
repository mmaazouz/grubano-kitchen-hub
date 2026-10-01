'use client'

import { useEffect } from 'react'

// ── app/global-error.tsx — the LAST-RESORT error boundary (P0-15) ─────────────
//
// Next renders this ONLY when the root layout itself fails — i.e. when
// app/[locale]/layout.tsx could not render. It REPLACES the whole document, so
// this file must emit its own <html> and <body>.
//
// TWO CONSEQUENCES, both deliberate:
//
// 1. NO i18n. `useTranslations` reads the NextIntlClientProvider, which is
//    mounted in app/[locale]/layout.tsx — the very layout that just failed. Any
//    hook call here would throw INSIDE the error boundary and loop back to a
//    blank page, defeating the purpose. Same reason we use a plain <a> and not
//    the locale-aware <Link> from @/navigation. The copy is therefore in the
//    product's default locale (defaultLocale = 'fr', i18n.ts:7). This is a
//    technical constraint of global-error, not an i18n oversight: the localised
//    screen users will actually see in practice is app/[locale]/error.tsx.
//
// 2. NO design-system import and NO CSS import. globals.css is loaded by the
//    failed layout, so class names would render unstyled. Styles are inlined,
//    with the same palette as public/offline.html (bg #FBF8F3, ink #0F2742,
//    accent #F97316) so the screen still looks like Grubano.
//
// Production safety: the stack and the message are logged, never displayed.
// Only Next's opaque `digest` hash is shown, so support can correlate the
// incident without leaking any code detail or file path.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // English in logs, per project convention.
    console.error('[app] GLOBAL error boundary (root layout failed):', error)
  }, [error])

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#FBF8F3',
          color: '#0F2742',
          fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        }}
      >
        <main style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: 40, lineHeight: 1 }} aria-hidden="true">⚠️</div>
          <h1 style={{ margin: '16px 0 8px', fontSize: 22, fontWeight: 800 }}>
            Une erreur est survenue
          </h1>
          <p style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.5, color: '#6B7280' }}>
            Quelque chose s&apos;est mal passé de notre côté. Vous pouvez réessayer — vos
            données n&apos;ont pas été perdues.
          </p>

          {error.digest && (
            <p style={{ margin: '0 0 20px', fontSize: 11, color: '#9CA3AF' }}>
              Référence à communiquer au support :{' '}
              <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                {error.digest}
              </code>
            </p>
          )}

          <button
            type="button"
            onClick={reset}
            style={{
              display: 'block',
              width: '100%',
              padding: '14px 20px',
              border: 'none',
              borderRadius: 12,
              background: '#F97316',
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Réessayer
          </button>
          <a
            href="/"
            style={{
              display: 'inline-block',
              marginTop: 12,
              fontSize: 14,
              fontWeight: 600,
              color: '#F97316',
              textDecoration: 'underline',
            }}
          >
            Retour à l&apos;accueil
          </a>
        </main>
      </body>
    </html>
  )
}
