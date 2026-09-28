import type { Metadata } from 'next'
import { AlertTriangle } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import { isCgvPublishable } from '@/lib/legal-info'
// PRE-L11 (T-78): the support channel comes from the ONE place that names it, never a fifth literal.
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/support-contact'
// PRE-L11 (T-79): three separate facts — which text, when the text changed, and whether it is in force.
import { cgvState } from '@/lib/cgv-version'
import { claimWindowHours } from '@/lib/claim-flags'
import { CLAIM_MAX_ORDER_AGE_DAYS } from '@/lib/claim-eligibility'

// ── /legal/cgv — conditions générales de vente (D′ L10, décision D-8) ─────────
//
// WHY THIS PAGE EXISTS. The claims cycle is about to be opened, and a customer who is told « une réclamation
// approuvée n'est pas un remboursement déjà effectué » in a toast has nowhere to read the rule in full. The
// five other legal pages are already mounted here; this one describes the SERVICE as it really behaves.
//
// WHAT IS NOT DONE HERE, and it matters. This page is NOT legal validation: the founder's L10 instruction is
// explicit, and so is this file. Nothing is INVENTED — no SIREN, no legal form, no address, no VAT number, no
// statutory delay, no waiver of a consumer right. Every company fact stays where it already lives
// (lib/legal-info.ts, rendered by /legal/mentions-legales), and this page LINKS there instead of restating
// facts that are still placeholders. While `isLegalInfoComplete()` is false the page carries its own draft
// banner and is not indexable, exactly like the three pages beside it — so it can never look final while the
// company identity is missing and the text has not been reviewed by counsel — and those are TWO facts, so
// they have two predicates (`isLegalInfoComplete()` and `CGV_COUNSEL_REVIEWED`), joined by `isCgvPublishable()`.
//
// THE TWO PRODUCT NUMBERS ARE READ FROM THE CODE, NEVER TYPED IN. The submission window comes from
// `claimWindowHours()` (env `CLAIM_WINDOW_HOURS`, 48 by default — read from `lib/claim-flags`, which
// imports NOTHING, so a public legal route never pulls Prisma or Stripe) and the hard ceiling from
// `CLAIM_MAX_ORDER_AGE_DAYS` — the SAME values `getClaimEligibility` enforces. A hardcoded « 48 h » in five
// locales would become false the day the env changes, and a legal page that contradicts the product is worse
// than one that is silent.
//
// S-21 IS RESPECTED BY CONSTRUCTION. The refund paragraph states that a refund is sent back to the payment
// method used and that WHEN it appears depends on the customer's bank — with no number of days, no date, and
// no guarantee. The two numbers above are a product window and an order age, never a banking delay, and the
// L10 bank-delay test scans this namespace with that distinction encoded.
//
// SECTION 7 IS LOAD-BEARING. A product window presented as an absolute loss of rights would be exactly the
// misleading clause the founder forbade: `rightsBody` says in so many words that these delays organise the
// service, are not a limitation of statutory rights, and are not a waiver of them.
export const dynamic = 'force-dynamic'

/**
 * A LOCALIZED title (founder §17), which is why this is `generateMetadata` and not a static `metadata`.
 *
 * The three sibling legal pages each hardcode a FRENCH `metadata.title`, so an English or Arabic reader gets
 * a French browser tab — recorded as a finding rather than fixed here, because rewriting three pages'
 * metadata is not a text lot's business. This page does it right from the start, from the SAME key the <h1>
 * renders, so the tab and the heading can never disagree.
 */
export async function generateMetadata(props: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale: props.params.locale, namespace: 'legal' })
  return {
    title: `${t('cgv.title')} — Grubano`,
    // Not indexable until the company facts are filled in AND counsel has reviewed the text (same rule as the
    // sibling legal pages: a draft must not be crawled).
    // NOT `isLegalInfoComplete()`: that knows about a SIREN, not about a lawyer. `isCgvPublishable()` is
    // the conjunction, so filling the company facts cannot silently make an unreviewed T&C indexable.
    robots: isCgvPublishable() ? undefined : { index: false, follow: false },
  }
}

export default async function CgvPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('legal')
  // The banner asks the SAME question the robots tag asks: is this page publishable at all?
  const publishable = isCgvPublishable()
  // The real product values, read once and passed to the copy as variables.
  const state = cgvState()
  const hours = claimWindowHours()
  const days = CLAIM_MAX_ORDER_AGE_DAYS

  return (
    <article className="space-y-7">
      {!publishable && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-grubano-md border border-grubano-warning/40 bg-grubano-warning-tint px-4 py-3 text-grubano-sm text-grubano-ink"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-grubano-warning" />
          <span>{t('cgv.draftBanner')}</span>
        </div>
      )}

      <header className="space-y-2">
        <h1 className="font-display text-grubano-2xl font-bold text-grubano-ink">{t('cgv.title')}</h1>
        <p className="text-grubano-sm leading-relaxed text-grubano-ink-muted">{t('cgv.intro')}</p>
      </header>

      <Section title={t('cgv.scopeTitle')}>
        <Body>{t('cgv.scopeBody')}</Body>
      </Section>

      {/* The company identity lives in ONE place. This section points at it rather than copying placeholders. */}
      <Section title={t('cgv.editorTitle')}>
        <Body>{t('cgv.editorBody')}</Body>
        <LegalLink href="/legal/mentions-legales">{t('cgv.editorLink')}</LegalLink>
      </Section>

      <Section title={t('cgv.serviceTitle')}>
        <Body>{t('cgv.serviceBody')}</Body>
      </Section>

      <Section title={t('cgv.orderTitle')}>
        <Body>{t('cgv.orderBody')}</Body>
      </Section>

      <Section title={t('cgv.paymentTitle')}>
        <Body>{t('cgv.paymentBody')}</Body>
      </Section>

      {/* The claims / refunds section — the reason this page is in L10 at all. */}
      <Section title={t('cgv.claimsTitle')}>
        <Body>{t('cgv.claimsIntro')}</Body>
        <ul className="mt-1 space-y-2 ps-5 text-grubano-sm leading-relaxed text-grubano-ink-muted [&>li]:list-disc">
          <li>{t('cgv.claimsSelfService')}</li>
          <li>{t('cgv.claimsWindow', { hours })}</li>
          <li>{t('cgv.claimsMaxAge', { days })}</li>
          <li>{t('cgv.claimsSupport')}</li>
          <li>{t('cgv.claimsReview')}</li>
          <li>{t('cgv.claimsAmount')}</li>
          <li>{t('cgv.claimsApprovedNotPaid')}</li>
          <li>{t('cgv.claimsBank')}</li>
          <li>{t('cgv.claimsPartial')}</li>
          <li>{t('cgv.claimsHistory')}</li>
          <li>{t('cgv.claimsCancelled')}</li>
          <li>{t('cgv.claimsLoyalty')}</li>
        </ul>
      </Section>

      <Section title={t('cgv.rightsTitle')}>
        <Body>{t('cgv.rightsBody')}</Body>
      </Section>

      <Section title={t('cgv.disputesTitle')}>
        <Body>{t('cgv.disputesBody')}</Body>
        {/* T-78 — THE SUPPORT CHANNEL, FROM THE SOURCE THAT ALREADY NAMES IT. The founder's ruling: for the
            beta the terms point at the support contact the application already has, and no second address is
            hardcoded. The LABEL is the one the sibling legal page already uses (`legal.mentions.labelEmail`),
            so this costs no new copy in five locales. This is NOT the editor's legal contact — that is a
            company fact, still an unfilled placeholder on the mentions légales, and §12 forbids inventing it. */}
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <dt className="text-grubano-sm font-semibold text-grubano-ink-muted">{t('mentions.labelEmail')}</dt>
          <dd className="text-grubano-sm text-grubano-ink">
            <a href={SUPPORT_MAILTO} className="font-semibold text-grubano-primary hover:underline">{SUPPORT_EMAIL}</a>
          </dd>
        </dl>
        <LegalLink href="/legal/mentions-legales">{t('cgv.editorLink')}</LegalLink>
      </Section>

      <Section title={t('cgv.dataTitle')}>
        <Body>{t('cgv.dataBody')}</Body>
        <LegalLink href="/legal/confidentialite">{t('cgv.dataLink')}</LegalLink>
      </Section>

      <Section title={t('cgv.changesTitle')}>
        <Body>{t('cgv.changesBody')}</Body>
      </Section>

      {/* T-79 — THREE FACTS, AND THE THIRD IS NOT A DATE. `version` names WHICH text, `lastUpdated` says when
          the TEXT changed, and `effectiveDate` says whether it BINDS anyone. The founder's ruling forbids
          inventing the third: while no lawyer has reviewed the text, the honest value is the sentence, not a
          day. Printing one date would invite the reader — and us — to treat it as the date the terms took
          effect, which is the easiest legal fact to invent by accident, because every document has one. */}
      <Section title={t('cgv.versionLabel')}>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <dt className="text-grubano-sm font-semibold text-grubano-ink-muted">{t('cgv.versionLabel')}</dt>
          <dd className="text-grubano-sm text-grubano-ink">{state.version}</dd>
          <dt className="text-grubano-sm font-semibold text-grubano-ink-muted">{t('cgv.lastUpdatedLabel')}</dt>
          <dd className="text-grubano-sm text-grubano-ink">{state.lastUpdated}</dd>
          <dt className="text-grubano-sm font-semibold text-grubano-ink-muted">{t('cgv.effectiveDateLabel')}</dt>
          <dd className={state.inForce ? 'text-grubano-sm text-grubano-ink' : 'text-grubano-sm italic text-grubano-ink-faint'}>
            {state.inForce ? state.effectiveDate : t('cgv.notInForce')}
          </dd>
        </dl>
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

function Body({ children }: { children: React.ReactNode }) {
  return <p className="text-grubano-sm leading-relaxed text-grubano-ink-muted">{children}</p>
}

/** `@/navigation`'s Link adds the locale prefix, so no URL is ever written five times. */
function LegalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="mt-2 inline-block text-grubano-sm font-semibold text-grubano-primary hover:underline">
      {children}
    </Link>
  )
}
