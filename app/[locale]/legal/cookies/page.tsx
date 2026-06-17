import type { Metadata } from 'next'
import { AlertTriangle } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { LEGAL_COOKIES, isLegalInfoComplete } from '@/lib/legal-info'

// ── /legal/cookies — cookie inventory (Agent 35) ──────────────────────────────
// Lists the cookies the app ACTUALLY sets (from lib/legal-info.ts LEGAL_COOKIES):
// NEXT_LOCALE (language), next-auth.session-token (session), grubano_estab
// (selected establishment), grubano_ref (referral). All strictly necessary — no
// advertising / third-party analytics cookies, and no consent banner/CMP exists
// (so none is described here). Same public chrome + shared finalisation banner +
// noindex while isLegalInfoComplete() is false, for coherence with the other
// legal pages.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Cookies — Grubano',
  robots: isLegalInfoComplete() ? undefined : { index: false, follow: false },
}

export default async function CookiesPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('legal')
  const complete = isLegalInfoComplete()

  // Static (TS-safe) label lookups, keyed by the LEGAL_COOKIES *Key fields.
  const dur: Record<string, string> = {
    oneYear:    t('cookies.durOneYear'),
    thirtyDays: t('cookies.durThirtyDays'),
    ninetyDays: t('cookies.durNinetyDays'),
  }
  const purpose: Record<string, string> = {
    locale:  t('cookies.purposeLocale'),
    session: t('cookies.purposeSession'),
    estab:   t('cookies.purposeEstab'),
    ref:     t('cookies.purposeRef'),
  }
  const cat: Record<string, string> = {
    necessary: t('cookies.catNecessary'),
  }

  return (
    <article className="space-y-7">
      {!complete && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-grubano-md border border-grubano-warning/40 bg-grubano-warning-tint px-4 py-3 text-grubano-sm text-grubano-ink"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-grubano-warning" />
          <span>{t('draftBanner')}</span>
        </div>
      )}

      <header className="space-y-2">
        <h1 className="font-display text-grubano-2xl font-bold text-grubano-ink">{t('cookies.title')}</h1>
        <p className="text-grubano-sm leading-relaxed text-grubano-ink-muted">{t('cookies.intro')}</p>
        <p className="text-grubano-sm leading-relaxed text-grubano-ink-muted">{t('cookies.noTrackingNote')}</p>
      </header>

      <div className="overflow-x-auto rounded-grubano-md border border-grubano-border">
        <table className="w-full text-left text-grubano-sm">
          <thead className="bg-grubano-surface-muted/60 text-grubano-xs uppercase tracking-wide text-grubano-ink-faint">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">{t('cookies.colName')}</th>
              <th scope="col" className="px-3 py-2 font-semibold">{t('cookies.colPurpose')}</th>
              <th scope="col" className="px-3 py-2 font-semibold">{t('cookies.colDuration')}</th>
              <th scope="col" className="px-3 py-2 font-semibold">{t('cookies.colCategory')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-grubano-border">
            {LEGAL_COOKIES.map((c) => (
              <tr key={c.name}>
                <td className="px-3 py-2 font-mono text-grubano-xs text-grubano-ink">{c.name}</td>
                <td className="px-3 py-2 text-grubano-ink-muted">{purpose[c.purposeKey] ?? c.purposeKey}</td>
                <td className="px-3 py-2 text-grubano-ink-muted">{dur[c.durationKey] ?? c.durationKey}</td>
                <td className="px-3 py-2 text-grubano-ink-muted">{cat[c.categoryKey] ?? c.categoryKey}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="space-y-2">
        <h2 className="font-display text-grubano-lg font-bold text-grubano-ink">{t('cookies.manageTitle')}</h2>
        <p className="text-grubano-sm leading-relaxed text-grubano-ink-muted">{t('cookies.manageBody')}</p>
      </section>
    </article>
  )
}
