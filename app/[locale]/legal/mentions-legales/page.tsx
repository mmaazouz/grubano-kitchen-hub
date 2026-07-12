import type { Metadata } from 'next'
import { AlertTriangle } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import { LEGAL_INFO, isLegalInfoComplete, isPlaceholder } from '@/lib/legal-info'

// ── /legal/mentions-legales — legal notice (Agent 34) ─────────────────────────
// Public, static. STANDARD French legal-notice MODEL (not legal advice) reading
// every company / host / mediation FACT from lib/legal-info.ts. While that file
// still holds placeholders, isLegalInfoComplete() is false and a discreet
// "en cours de finalisation" banner shows at the top (so the page can never be
// shipped looking final while empty). The banner disappears on its own once
// Mohammed fills lib/legal-info.ts.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Mentions légales — Grubano',
  // Not indexable until the company facts are filled in.
  robots: isLegalInfoComplete() ? undefined : { index: false, follow: false },
}

export default async function MentionsLegalesPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('legal')
  const { editor, host, mediation } = LEGAL_INFO
  const complete = isLegalInfoComplete()

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
        <h1 className="font-display text-grubano-2xl font-bold text-grubano-ink">{t('mentions.title')}</h1>
        <p className="text-grubano-sm leading-relaxed text-grubano-ink-muted">{t('mentions.intro')}</p>
      </header>

      {/* Éditeur */}
      <Section title={t('mentions.editorTitle')}>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <Fact label={t('mentions.labelRaisonSociale')} value={editor.raisonSociale} />
          <Fact label={t('mentions.labelFormeJuridique')} value={editor.formeJuridique} />
          <Fact label={t('mentions.labelCapital')} value={editor.capitalSocial} />
          <Fact label={t('mentions.labelSiren')} value={editor.siren} />
          <Fact label={t('mentions.labelSiret')} value={editor.siret} />
          <Fact label={t('mentions.labelRcs')} value={editor.rcsVille} />
          <Fact label={t('mentions.labelSiege')} value={editor.siegeAdresse} />
          <Fact label={t('mentions.labelEmail')} value={editor.email} />
          {/* Optional facts: shown only once actually filled. */}
          {!isPlaceholder(editor.tvaIntra) && <Fact label={t('mentions.labelTva')} value={editor.tvaIntra} />}
          {!isPlaceholder(editor.telephone) && <Fact label={t('mentions.labelTelephone')} value={editor.telephone} />}
        </dl>
      </Section>

      {/* Directeur de la publication */}
      <Section title={t('mentions.directorTitle')}>
        <p className={valueClass(editor.directeurPublication)}>{editor.directeurPublication}</p>
      </Section>

      {/* Hébergeur */}
      <Section title={t('mentions.hostTitle')}>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <Fact label={t('mentions.labelHostNom')} value={host.nom} />
          <Fact label={t('mentions.labelHostAdresse')} value={host.adresse} />
          <Fact label={t('mentions.labelHostContact')} value={host.contact} />
        </dl>
      </Section>

      {/* Propriété intellectuelle */}
      <Section title={t('mentions.ipTitle')}>
        <p className="text-grubano-sm leading-relaxed text-grubano-ink-muted">{t('mentions.ipBody')}</p>
      </Section>

      {/* Données personnelles (RGPD) */}
      <Section title={t('mentions.dataTitle')}>
        <p className="text-grubano-sm leading-relaxed text-grubano-ink-muted">{t('mentions.dataBody')}</p>
        <Link
          href="/legal/confidentialite"
          className="mt-2 inline-block text-grubano-sm font-semibold text-grubano-primary hover:underline"
        >
          {t('mentions.dataPrivacyLink')}
        </Link>
      </Section>

      {/* Cookies */}
      <Section title={t('mentions.cookiesTitle')}>
        <p className="text-grubano-sm leading-relaxed text-grubano-ink-muted">{t('mentions.cookiesBody')}</p>
      </Section>

      {/* Médiation de la consommation */}
      <Section title={t('mentions.mediationTitle')}>
        <p className="text-grubano-sm leading-relaxed text-grubano-ink-muted">{t('mentions.mediationBody')}</p>
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <Fact label={t('mentions.labelMediatorNom')} value={mediation.nom} />
          <Fact label={t('mentions.labelMediatorUrl')} value={mediation.url} />
          <Fact label={t('mentions.labelMediatorAdresse')} value={mediation.adresse} />
        </dl>
      </Section>

      {/* Loi applicable */}
      <Section title={t('mentions.lawTitle')}>
        <p className="text-grubano-sm leading-relaxed text-grubano-ink-muted">{t('mentions.lawBody')}</p>
      </Section>
    </article>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-grubano-lg font-bold text-grubano-ink">{title}</h2>
      {children}
    </section>
  )
}

// A muted/italic value cue while still an unfilled placeholder.
function valueClass(value: string): string {
  return isPlaceholder(value)
    ? 'text-grubano-sm italic text-grubano-ink-faint'
    : 'text-grubano-sm text-grubano-ink'
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-grubano-sm font-semibold text-grubano-ink-muted">{label}</dt>
      <dd className={valueClass(value)}>{value}</dd>
    </>
  )
}
