import type { Metadata } from 'next'
import { AlertTriangle } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import {
  LEGAL_INFO,
  LEGAL_SUBPROCESSORS,
  isLegalInfoComplete,
  isPlaceholder,
} from '@/lib/legal-info'

// ── /legal/confidentialite — privacy policy (RGPD), Agent 35 ──────────────────
// Standard RGPD MODEL (not legal advice) anchored on the app's REAL processing
// (account, KYB, orders/payments, partner profiles + AI vetting, technical logs)
// and its real subprocessors (Stripe, Anthropic, French business registry, OAuth,
// email provider). All fillable FACTS (controller, DPO, retention, transfers,
// email provider, hosting) come from lib/legal-info.ts — kept as visible
// placeholders. The shared "en cours de finalisation" banner + noindex stay until
// isLegalInfoComplete() is true (now also covers the privacy facts).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Politique de confidentialité — Grubano',
  robots: isLegalInfoComplete() ? undefined : { index: false, follow: false },
}

export default async function ConfidentialitePage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('legal')
  const { editor, host, privacy } = LEGAL_INFO
  const complete = isLegalInfoComplete()

  // Static (TS-safe) role labels, looked up by subprocessor roleKey.
  const subLabel: Record<string, string> = {
    payment:  t('confidentialite.subPayment'),
    llm:      t('confidentialite.subLlm'),
    registry: t('confidentialite.subRegistry'),
    oauth:    t('confidentialite.subOauth'),
    email:    t('confidentialite.subEmail'),
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
        <h1 className="font-display text-grubano-2xl font-bold text-grubano-ink">{t('confidentialite.title')}</h1>
        <p className="text-grubano-sm leading-relaxed text-grubano-ink-muted">{t('confidentialite.intro')}</p>
      </header>

      <Section title={t('confidentialite.controllerTitle')}>
        <p className={bodyClass}>{t('confidentialite.controllerBody')}</p>
      </Section>

      {/* Données collectées + finalités */}
      <Section title={t('confidentialite.dataTitle')}>
        <p className={bodyClass}>{t('confidentialite.dataIntro')}</p>
        <dl className="mt-3 space-y-3">
          <Block term={t('confidentialite.catAccountTitle')} desc={t('confidentialite.catAccountBody')} />
          <Block term={t('confidentialite.catBusinessTitle')} desc={t('confidentialite.catBusinessBody')} />
          <Block term={t('confidentialite.catOrdersTitle')} desc={t('confidentialite.catOrdersBody')} />
          <Block term={t('confidentialite.catPartnersTitle')} desc={t('confidentialite.catPartnersBody')} />
          <Block term={t('confidentialite.catTechnicalTitle')} desc={t('confidentialite.catTechnicalBody')} />
        </dl>
      </Section>

      <Section title={t('confidentialite.legalBasisTitle')}>
        <p className={bodyClass}>{t('confidentialite.legalBasisBody')}</p>
      </Section>

      {/* Destinataires & sous-traitants */}
      <Section title={t('confidentialite.recipientsTitle')}>
        <p className={bodyClass}>{t('confidentialite.recipientsIntro')}</p>
        <ul className="mt-3 space-y-1.5">
          {LEGAL_SUBPROCESSORS.map((s) => (
            <li key={s.roleKey} className="text-grubano-sm text-grubano-ink-muted">
              <span className="font-semibold text-grubano-ink">{subLabel[s.roleKey] ?? s.roleKey}</span>
              {' — '}
              <span className={isPlaceholder(s.name) ? 'italic text-grubano-ink-faint' : ''}>{s.name}</span>
            </li>
          ))}
          {/* Hosting: sourced from the legal-info host placeholder. */}
          <li className="text-grubano-sm text-grubano-ink-muted">
            <span className="font-semibold text-grubano-ink">{t('confidentialite.subHosting')}</span>
            {' — '}
            <span className={isPlaceholder(host.nom) ? 'italic text-grubano-ink-faint' : ''}>{host.nom}</span>
          </li>
        </ul>
      </Section>

      {/* Transferts hors UE */}
      <Section title={t('confidentialite.transferTitle')}>
        <p className={bodyClass}>{t('confidentialite.transferBody')}</p>
        <p className={`mt-1 ${valueClass(privacy.nonEuTransfer)}`}>{privacy.nonEuTransfer}</p>
      </Section>

      {/* Durées de conservation */}
      <Section title={t('confidentialite.retentionTitle')}>
        <p className={bodyClass}>{t('confidentialite.retentionBody')}</p>
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <Fact label={t('confidentialite.retentionAccountLabel')} value={privacy.retentionAccount} />
          <Fact label={t('confidentialite.retentionOrdersLabel')} value={privacy.retentionOrders} />
        </dl>
      </Section>

      {/* Droits */}
      <Section title={t('confidentialite.rightsTitle')}>
        <p className={bodyClass}>{t('confidentialite.rightsBody')}</p>
        <p className="mt-1 text-grubano-sm leading-relaxed text-grubano-ink-muted">{t('confidentialite.cnilNote')}</p>
      </Section>

      {/* Contact / DPO */}
      <Section title={t('confidentialite.contactTitle')}>
        <p className={bodyClass}>{t('confidentialite.contactBody')}</p>
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <Fact label={t('confidentialite.contactTitle')} value={privacy.dpoContact} />
          <Fact label="E-mail" value={editor.email} />
        </dl>
      </Section>

      {/* Cookies */}
      <Section title={t('confidentialite.cookiesTitle')}>
        <p className={bodyClass}>{t('confidentialite.cookiesBody')}</p>
        <Link
          href="/legal/cookies"
          className="mt-2 inline-block text-grubano-sm font-semibold text-grubano-primary hover:underline"
        >
          {t('confidentialite.cookiesLink')}
        </Link>
      </Section>

      {/* Sécurité */}
      <Section title={t('confidentialite.securityTitle')}>
        <p className={bodyClass}>{t('confidentialite.securityBody')}</p>
      </Section>
    </article>
  )
}

const bodyClass = 'text-grubano-sm leading-relaxed text-grubano-ink-muted'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-grubano-lg font-bold text-grubano-ink">{title}</h2>
      {children}
    </section>
  )
}

function Block({ term, desc }: { term: string; desc: string }) {
  return (
    <div>
      <dt className="text-grubano-sm font-semibold text-grubano-ink">{term}</dt>
      <dd className="text-grubano-sm leading-relaxed text-grubano-ink-muted">{desc}</dd>
    </div>
  )
}

// Muted/italic cue while a fact is still an unfilled placeholder.
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
