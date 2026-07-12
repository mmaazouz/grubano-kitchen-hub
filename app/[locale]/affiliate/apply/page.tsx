import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import { isAffiliateEnabled } from '@/lib/affiliate-account'
import './affiliate-landing.css'

export const dynamic = 'force-dynamic'

// ── AF7 · Landing publique « Devenez affilié » (CD marketing --gb-*) ─────────────────
// PUBLIC route /affiliate/apply (middleware allow-list, unchanged) → full-bleed
// marketing page in the light gb-foundation language (crème + TEAL affiliate accent
// --gb-af / dégradé --gb-flow), NOT the navy console shell. Re-skin of the banked CD
// maquette AF7 with the mandated HONESTY edits (integration note):
//   • all the maquette's honest guardrails are KEPT verbatim: qualitative trust strip
//     (Lien/Suivi/Auto/Gratuit — zero fabricated stats), descriptive remuneration
//     (« Commission par commande », NO hardcoded rate), rev__note (« taux exact
//     présenté à l'activation… revenus non garantis »), FAQ (« nous ne garantissons
//     pas de revenus »), disclaimed foot__copy ;
//   • the fictional testimonial « Thomas Renaud » keeps its « Témoignage illustratif »
//     tag — the tag is NEVER removed ;
//   • every CTA (maquette href="apply.html") → the REAL AF8 application route
//     /affiliate/apply/candidature (same public sub-tree, same flag gate) ;
//   • footer gains the REAL legal links (/legal/mentions-legales, /legal/confidentialite,
//     /legal/cookies) — no invented « CGU » page ;
//   • rev__term « Liens de campagne : Jusqu'à 5 » → honest value (dedicated campaign
//     links do not exist yet — AF2 shows them « bientôt ») : « Lien personnel unique ».
// 404 when AFFILIATE_ENABLED is OFF → the surface stays invisible, byte-identical
// flag-OFF behaviour (same gate as before this re-skin). Static marketing content:
// no owner data, no loading/error states. The pre-login signup form (Agent 118's
// AffiliateApplyClient) now lives on the AF8 page, not here.

const SYMBOL_COLOR = '/brand/grubano-symbol-color.svg'
const SYMBOL_WHITE = '/brand/grubano-symbol-white.svg'

export default async function AffiliateLandingPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale)
  if (!isAffiliateEnabled()) notFound()

  const tm = await getTranslations('affiliate.mkt')

  const feats = [
    { ic: 'link',                key: 'f1', basil: false },
    { ic: 'payments',            key: 'f2', basil: true  },
    { ic: 'insights',            key: 'f3', basil: false },
    { ic: 'savings',             key: 'f4', basil: true  },
    { ic: 'campaign',            key: 'f5', basil: false },
    { ic: 'volunteer_activism',  key: 'f6', basil: true  },
  ] as const

  const steps = [
    { n: '1', ic: 'schedule', key: 's1' },
    { n: '2', ic: 'link',     key: 's2' },
    { n: '3', ic: 'share',    key: 's3' },
    { n: '4', ic: 'payments', key: 's4' },
  ] as const

  return (
    <div className="af-mkt">

      {/* ── nav ─────────────────────────────────────────────────────────── */}
      <nav className="nav">
        <div className="nav__in">
          <Link className="nav__brand" href="/affiliate/apply">
            <img src={SYMBOL_COLOR} alt="Grubano" /><b>Grubano</b><span>{tm('badge')}</span>
          </Link>
          <div className="nav__links">
            <a href="#pourquoi">{tm('navWhy')}</a>
            <a href="#etapes">{tm('navHow')}</a>
            <a href="#gains">{tm('navRevenue')}</a>
            <a href="#faq">{tm('navFaq')}</a>
            <Link className="nav__cta" href="/affiliate/apply/candidature">{tm('navApply')}<span className="ms">arrow_forward</span></Link>
          </div>
        </div>
      </nav>

      {/* ── hero ────────────────────────────────────────────────────────── */}
      <header className="hero" id="top">
        <div className="hero__in">
          <div>
            <span className="hero__eyebrow"><span className="ms">link</span>{tm('heroEyebrow')}</span>
            <h1>{tm('heroTitleA')}<br />{tm('heroTitleB')} <span className="hl">{tm('heroTitleHl')}</span></h1>
            <p className="hero__sub">{tm('heroSub')}</p>
            <div className="hero__cta">
              <Link className="btn-af" href="/affiliate/apply/candidature"><span className="ms">rocket_launch</span>{tm('heroCtaApply')}</Link>
              <a className="btn-ghost" href="#pourquoi"><span className="ms">play_circle</span>{tm('heroCtaDiscover')}</a>
            </div>
            <div className="hero__note"><span className="ms">check_circle</span>{tm('heroNote')}</div>
          </div>
          <div className="hero__art">
            <img src={SYMBOL_WHITE} alt="Grubano" />
            {/* qualitative chips — kept from the maquette, no fabricated numbers */}
            <div className="hero__chip c1">
              <span className="ic" style={{ background: 'var(--gb-af)' }}><span className="ms">ads_click</span></span>
              <div><b>{tm('heroChip1Title')}</b><span>{tm('heroChip1Sub')}</span></div>
            </div>
            <div className="hero__chip c2">
              <span className="ic" style={{ background: 'var(--gb-basil)' }}><span className="ms">payments</span></span>
              <div><b>{tm('heroChip2Title')}</b><span>{tm('heroChip2Sub')}</span></div>
            </div>
          </div>
        </div>
      </header>

      {/* ── trust strip (qualitative — no fabricated stats, kept verbatim) ── */}
      <div className="trust">
        <div className="trust__in">
          <div className="trust__it"><b>{tm('trustLink')}</b><span>{tm('trustLinkSub')}</span></div>
          <div className="trust__it"><b>{tm('trustTrack')}</b><span>{tm('trustTrackSub')}</span></div>
          <div className="trust__it"><b>{tm('trustAuto')}</b><span>{tm('trustAutoSub')}</span></div>
          <div className="trust__it"><b>{tm('trustFree')}</b><span>{tm('trustFreeSub')}</span></div>
        </div>
      </div>

      {/* ── pourquoi (6 feats) ──────────────────────────────────────────── */}
      <section className="sec" id="pourquoi">
        <div className="wrap">
          <div className="sec__head">
            <span className="sec__eyebrow">{tm('whyEyebrow')}</span>
            <h2>{tm('whyTitle')}</h2>
            <p>{tm('whySub')}</p>
          </div>
          <div className="feats">
            {feats.map(f => (
              <div key={f.key} className={`feat${f.basil ? ' basil' : ''}`}>
                <div className="feat__ic"><span className="ms">{f.ic}</span></div>
                <h3>{tm(`${f.key}Title`)}</h3>
                <p>{tm(`${f.key}Desc`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── étapes (4 steps) ────────────────────────────────────────────── */}
      <section className="sec steps-sec" id="etapes">
        <div className="wrap">
          <div className="sec__head">
            <span className="sec__eyebrow">{tm('stepsEyebrow')}</span>
            <h2>{tm('stepsTitle')}</h2>
            <p>{tm('stepsSub')}</p>
          </div>
          <div className="steps">
            {steps.map(s => (
              <div key={s.key} className="step">
                <div className="step__n">{s.n}</div>
                <h3>{tm(`${s.key}Title`)}</h3>
                <p>{tm(`${s.key}Desc`)}</p>
                <div className="step__t"><span className="ms">{s.ic}</span>{tm(`${s.key}Time`)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── rémunération (honest — NO rate, revenus non garantis) ──────── */}
      <section className="sec" id="gains">
        <div className="wrap">
          <div className="sec__head">
            <span className="sec__eyebrow">{tm('revEyebrow')}</span>
            <h2>{tm('revTitle')}</h2>
          </div>
          <div className="rev">
            <div className="rev__list">
              {['rev1', 'rev2', 'rev3', 'rev4'].map(k => (
                <div key={k} className="rev__row">
                  <span className="ms">check</span>
                  <div><b>{tm(`${k}Title`)}</b><p>{tm(`${k}Desc`)}</p></div>
                </div>
              ))}
            </div>
            <div className="rev__card">
              <h3>{tm('revCardTitle')}</h3>
              <div className="rev__terms">
                <div className="rev__term"><span className="k">{tm('termFeesLabel')}</span><span className="v">{tm('termFeesVal')}</span></div>
                {/* honest — dedicated campaign links do not exist yet (AF2 shows « bientôt ») */}
                <div className="rev__term"><span className="k">{tm('termLinksLabel')}</span><span className="v">{tm('termLinksVal')}</span></div>
                <div className="rev__term"><span className="k">{tm('termPayLabel')}</span><span className="v">{tm('termPayVal')}</span></div>
                <div className="rev__term"><span className="k">{tm('termPayoutLabel')}</span><span className="v">{tm('termPayoutVal')}</span></div>
              </div>
              <div className="rev__note"><span className="ms">info</span><span>{tm('revNote')}</span></div>
              <Link className="btn-af" href="/affiliate/apply/candidature" style={{ width: '100%', marginTop: 20 }}><span className="ms">rocket_launch</span>{tm('revCta')}</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── témoignage (fictif — tag « Témoignage illustratif » OBLIGATOIRE) ── */}
      <section className="sec tm-sec">
        <div className="wrap">
          <div className="tm">
            <div className="tm__q">{tm('tmQuote')}</div>
            <div className="tm__by">
              <span className="tm__av">{tm('tmInitials')}</span>
              <div><b>{tm('tmName')}</b><span>{tm('tmRole')}</span></div>
            </div>
            <span className="tm__tag">{tm('tmTag')}</span>
          </div>
        </div>
      </section>

      {/* ── faq ─────────────────────────────────────────────────────────── */}
      <section className="sec" id="faq">
        <div className="wrap">
          <div className="sec__head">
            <span className="sec__eyebrow">{tm('faqEyebrow')}</span>
            <h2>{tm('faqTitle')}</h2>
          </div>
          <div className="faq">
            <details className="qa" open><summary>{tm('q1')}<span className="ms">expand_more</span></summary><div className="qa__a">{tm('a1')}</div></details>
            <details className="qa"><summary>{tm('q2')}<span className="ms">expand_more</span></summary><div className="qa__a">{tm('a2')}</div></details>
            <details className="qa"><summary>{tm('q3')}<span className="ms">expand_more</span></summary><div className="qa__a">{tm('a3')}</div></details>
            <details className="qa"><summary>{tm('q4')}<span className="ms">expand_more</span></summary><div className="qa__a">{tm('a4')}</div></details>
            <details className="qa"><summary>{tm('q5')}<span className="ms">expand_more</span></summary><div className="qa__a">{tm('a5')}</div></details>
          </div>
        </div>
      </section>

      {/* ── final cta ───────────────────────────────────────────────────── */}
      <div className="cta-band">
        <div className="cta-band__in">
          <h2>{tm('ctaTitle')}</h2>
          <p>{tm('ctaSub')}</p>
          <Link className="btn-af" href="/affiliate/apply/candidature"><span className="ms">rocket_launch</span>{tm('ctaBtn')}</Link>
        </div>
      </div>

      {/* ── footer (disclaimed + REAL legal links) ──────────────────────── */}
      <footer className="foot">
        <div className="foot__in">
          <div className="foot__brand"><img src={SYMBOL_COLOR} alt="Grubano" /><b>Grubano</b></div>
          <div className="foot__links">
            <a href="#pourquoi">{tm('navWhy')}</a>
            <a href="#gains">{tm('navRevenue')}</a>
            <a href="#faq">{tm('navFaq')}</a>
            <Link href="/affiliate/apply/candidature">{tm('navApply')}</Link>
            <Link href="/legal/mentions-legales">{tm('footLegalMentions')}</Link>
            <Link href="/legal/confidentialite">{tm('footLegalPrivacy')}</Link>
            <Link href="/legal/cookies">{tm('footLegalCookies')}</Link>
          </div>
          <div className="foot__copy">{tm('footCopy')}</div>
        </div>
      </footer>
    </div>
  )
}
