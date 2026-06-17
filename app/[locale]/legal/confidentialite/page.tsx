import type { Metadata } from 'next'
import { Info } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

// ── /legal/confidentialite — privacy policy (Agent 34) ────────────────────────
// MINIMAL honest placeholder so the privacy link referenced by the legal notice
// (and the RGPD consent copy) is never dead. NOT a full privacy policy (out of
// scope) — a short, truthful "page being prepared" skeleton with the essential
// principles. The detailed version is a separate brick (flagged in the report).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Politique de confidentialité — Grubano',
  robots: { index: false, follow: false },
}

export default async function ConfidentialitePage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('legal')

  return (
    <article className="space-y-7">
      <div
        role="status"
        className="flex items-start gap-2.5 rounded-grubano-md border border-grubano-info/40 bg-grubano-info-tint px-4 py-3 text-grubano-sm text-grubano-ink"
      >
        <Info size={18} className="mt-0.5 shrink-0 text-grubano-info" />
        <span>{t('confidentialite.draftNote')}</span>
      </div>

      <header>
        <h1 className="font-display text-grubano-2xl font-bold text-grubano-ink">{t('confidentialite.title')}</h1>
      </header>

      <Section title={t('confidentialite.collectTitle')} body={t('confidentialite.collectBody')} />
      <Section title={t('confidentialite.rightsTitle')} body={t('confidentialite.rightsBody')} />
      <Section title={t('confidentialite.contactTitle')} body={t('confidentialite.contactBody')} />
    </article>
  )
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-grubano-lg font-bold text-grubano-ink">{title}</h2>
      <p className="text-grubano-sm leading-relaxed text-grubano-ink-muted">{body}</p>
    </section>
  )
}
