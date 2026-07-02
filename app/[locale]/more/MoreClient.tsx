'use client'

// ── /more — RÉGLAGES / PLUS operator content (CD v1 LOT 7, écran 4). ──────────────
// Client wrapper: renders the CD « Réglages » design in --op- (navy shell already
// mounted by AppChrome → OperatorShell; this is only the <section> inside op-content).
//
// 🔒 PRESENTATION-ONLY re-skin of the legacy /more list. AUTH is REAL:
//   • « Se déconnecter » → signOut({ callbackUrl }) from next-auth/react — a TRUE logout.
// DATA is REAL, DISPLAY-ONLY:
//   • The legal/fiscal identity (Raison sociale, SIREN, statut KYB) shows the server
//     KYB fields passed as props (siren / officialName / legalForm / kybStatus /
//     kybVerifiedAt / country) EXACTLY as stored — NO invented declaration logic. The
//     KYB badge label is the raw status string, mapped only to a colour tone.
//   • The intra-community VAT number + the full DAC7 self-declaration keep their EXISTING
//     real POST forms (<VatNumberForm/> / <Dac7FiscalForm/>), embedded BYTE-IDENTICAL.
// HONEST DE-MOCK:
//   • Rows with no real destination yet (Profil, Sécurité & mot de passe, Langue, Centre
//     d'aide) render inert with a « bientôt » pill — never a fake flow.
//   • Rows with a real page (Notifications, Facturation → /finance, Formule → /premium,
//     CGU / Confidentialité → /legal/*) link to it. ⚠️ ZERO money/amount on this screen.

import { useState } from 'react'
import { signOut, useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import VatNumberForm from '@/components/fiscal/VatNumberForm'
import Dac7FiscalForm from '@/components/fiscal/Dac7FiscalForm'
import './more.css'

// Real KYB identity read server-side (page.tsx) — display only, exactly as stored.
export interface KybIdentity {
  siren: string | null
  officialName: string | null
  legalForm: string | null
  kybStatus: string | null
  kybVerifiedAt: string | null // ISO or null
  country: string | null
}

type BadgeTone = 'ok' | 'warn' | 'muted'

export default function MoreClient({ kyb }: { kyb: KybIdentity }) {
  const t = useTranslations('more')
  const { data: session } = useSession()
  const [loggingOut, setLoggingOut] = useState(false)

  // profile identity for the « Profil » row — real session values, no fabrication.
  const name = (session?.user?.name as string | undefined)?.trim() || ''
  const email = (session?.user?.email as string | undefined)?.trim() || ''
  const profileLine = [name, email].filter(Boolean).join(' · ')

  // KYB status → badge tone + label. The label is the RAW server value (localised only
  // for the known canonical states); any other/unknown string is shown verbatim. NO
  // declaration/verification is inferred here — this only picks a colour.
  const rawStatus = (kyb.kybStatus ?? '').trim()
  const statusKey = rawStatus.toLowerCase()
  const kybBadge: { tone: BadgeTone; label: string } = (() => {
    if (statusKey === 'verified') return { tone: 'ok', label: t('kyb.verified') }
    if (statusKey === 'pending') return { tone: 'warn', label: t('kyb.pending') }
    if (statusKey === 'rejected') return { tone: 'warn', label: t('kyb.rejected') }
    if (statusKey === '' || statusKey === 'none') return { tone: 'muted', label: t('kyb.none') }
    return { tone: 'muted', label: rawStatus } // unknown → verbatim, no invented meaning
  })()

  const doLogout = () => {
    if (loggingOut) return
    setLoggingOut(true)
    // REAL logout — clears the NextAuth session and returns to the operator login.
    signOut({ callbackUrl: '/login' })
  }

  // ── inert « bientôt » row (no real destination yet) ──
  const InertRow = ({ icon, label, sub }: { icon: string; label: string; sub?: string }) => (
    <div className="set-row is-inert" aria-disabled="true">
      <span className="set-row__ic"><span className="ms" aria-hidden="true">{icon}</span></span>
      <div className="set-row__m"><b>{label}</b>{sub && <span className="hide-mobile">{sub}</span>}</div>
      <span className="set-badge muted">{t('soon')}</span>
    </div>
  )

  // ── real link row (→ existing page) ──
  const LinkRow = ({ icon, label, sub, href, badge }: {
    icon: string; label: string; sub?: string; href: string
    badge?: { tone: BadgeTone | 'premium'; label: string; icon?: string }
  }) => (
    <Link href={href} className="set-row">
      <span className="set-row__ic"><span className="ms" aria-hidden="true">{icon}</span></span>
      <div className="set-row__m"><b>{label}</b>{sub && <span className="hide-mobile">{sub}</span>}</div>
      {badge && (
        <span className={`set-badge ${badge.tone}`}>
          {badge.icon && <span className="ms" aria-hidden="true" style={{ fontSize: 13 }}>{badge.icon}</span>}
          {badge.tone !== 'premium' && <i className="dot" />}
          {badge.label}
        </span>
      )}
      <span className="ms set-row__chev flip-rtl" aria-hidden="true">chevron_right</span>
    </Link>
  )

  // ── read-only legal identifier row (mono value, no chevron) ──
  const LegalRow = ({ icon, label, value }: { icon: string; label: string; value: string }) => (
    <div className="set-row is-inert">
      <span className="set-row__ic"><span className="ms" aria-hidden="true">{icon}</span></span>
      <div className="set-row__m"><b>{label}</b></div>
      <span className="set-legal-val mono">{value}</span>
    </div>
  )

  return (
    <section className="op-set">
      <div className="op-dash__head">
        <h1 className="op-dash__title">{t('title')}</h1>
        <p className="op-dash__sub">{t('subtitle')}</p>
      </div>

      {/* ── Compte ── */}
      <div className="set-block">
        <div className="set-block__head">{t('account.title')}</div>
        <div className="op-card">
          {/* Profil — no dedicated page yet → honest « bientôt » (real identity shown as sub) */}
          <InertRow icon="person" label={t('account.profile')} sub={profileLine || undefined} />
          {/* Sécurité & mot de passe — no real flow yet → honest « bientôt » (no fake) */}
          <InertRow icon="lock" label={t('account.security')} sub={t('account.securitySub')} />
          {/* Langue — inert href="#" today → honest « bientôt » */}
          <InertRow icon="translate" label={t('account.language')} sub={undefined} />
          {/* Notifications — REAL page */}
          <LinkRow icon="notifications" label={t('account.notifications')} sub={t('account.notificationsSub')} href="/notifications" />
        </div>
      </div>

      {/* ── Facturation & abonnement — LINKS only, NO amount, NO payment ── */}
      <div className="set-block">
        <div className="set-block__head">{t('billing.title')}</div>
        <div className="op-card">
          <LinkRow icon="workspace_premium" label={t('billing.plan')} href="/premium"
            badge={{ tone: 'premium', label: t('billing.premium'), icon: 'star' }} />
          <LinkRow icon="credit_card" label={t('billing.methods')} sub={t('billing.methodsSub')} href="/finance" />
          <LinkRow icon="receipt" label={t('billing.history')} sub={t('billing.historySub')} href="/finance" />
        </div>
      </div>

      {/* ── Informations légales & fiscales — REAL server KYB, display only ── */}
      <div className="set-block">
        <div className="set-block__head">{t('legal.title')}</div>
        <div className="op-card">
          {/* Raison sociale + forme juridique (real; « bientôt » when unset) */}
          <div className="set-row is-inert">
            <span className="set-row__ic"><span className="ms" aria-hidden="true">business</span></span>
            <div className="set-row__m">
              <b>{t('legal.company')}</b>
              <span>{[kyb.officialName, kyb.legalForm].filter(Boolean).join(' · ') || t('legal.unset')}</span>
            </div>
          </div>
          {/* SIREN (mono) — real, or « bientôt » */}
          {kyb.siren
            ? <LegalRow icon="tag" label={t('legal.siren')} value={kyb.siren} />
            : <InertRow icon="tag" label={t('legal.siren')} />}
          {/* Statut KYB — RAW server status, no invented logic */}
          <div className="set-row is-inert">
            <span className="set-row__ic"><span className="ms" aria-hidden="true">verified_user</span></span>
            <div className="set-row__m">
              <b>{t('legal.kyb')}</b>
              <span className="hide-mobile">
                {kyb.kybVerifiedAt ? t('legal.kybVerifiedAt', { date: kyb.kybVerifiedAt.slice(0, 10) }) : t('legal.kybSub')}
              </span>
            </div>
            <span className={`set-badge ${kybBadge.tone}`}><i className="dot" />{kybBadge.label}</span>
          </div>
        </div>
      </div>

      {/* ── N° de TVA intracommunautaire — REAL POST form, byte-identical ── */}
      <div className="set-form-block">
        <div className="set-form-block__head">{t('legal.vatSection')}</div>
        <VatNumberForm />
      </div>

      {/* ── Déclaration DAC7 — REAL POST form, byte-identical ── */}
      <div className="set-form-block">
        <div className="set-form-block__head">{t('legal.dac7Section')}</div>
        <Dac7FiscalForm />
      </div>

      {/* ── Aide & support ── */}
      <div className="set-block">
        <div className="set-block__head">{t('help.title')}</div>
        <div className="op-card">
          {/* Centre d'aide — no page yet → honest « bientôt » */}
          <InertRow icon="help" label={t('help.center')} />
          {/* Contacter le support — no page yet → honest « bientôt » */}
          <InertRow icon="support_agent" label={t('help.contact')} />
          {/* CGU / Confidentialité — REAL legal pages */}
          <LinkRow icon="description" label={t('help.terms')} href="/legal/mentions-legales" />
          <LinkRow icon="shield" label={t('help.privacy')} href="/legal/confidentialite" />
        </div>
      </div>

      {/* ── Se déconnecter — REAL logout (signOut) ── */}
      <button type="button" className="set-logout" onClick={doLogout} disabled={loggingOut}>
        <span className="ms" aria-hidden="true">logout</span>
        {loggingOut ? t('loggingOut') : t('logout')}
      </button>
      <div className="set-version">{t('version')}</div>
    </section>
  )
}
