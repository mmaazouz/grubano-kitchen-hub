import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import './logistics-landing.css'

// ── LO4 · Landing publique « Devenez livreur » (CD marketing --gb-*) ─────────────────
// PUBLIC route /business/logistics (the /business sub-tree is already public at the
// middleware for onboarding — no flag gate here, no notFound) → full-bleed marketing
// page in the light gb-foundation language (crème + AMBER logistics accent --gb-lo /
// dégradé --gb-ride), NOT the navy console shell. Re-skin of the banked CD maquette
// LO4 with the mandated HONESTY guardrails, ALL already present in the CD and KEPT:
//   • waitlist notice banner (network being rolled out) ;
//   • qualitative features (zero fabricated stats) ;
//   • descriptive remuneration — NO rate/amount ; rev__term « Barème » →
//     « Communiqué au lancement » ; rev__note (« revenus… non garantis ; cette page
//     ne constitue pas une offre d'emploi ni un contrat ») ;
//   • FAQ (« combien vais-je gagner » → barème au lancement, non garanti) ;
//   • NO testimonial (nothing to tag) ;
//   • every CTA (maquette href="register.html") → the REAL logistics register route
//     /business/logistics/register (already public) ;
//   • footer uses the REAL legal pages only (/legal/mentions-legales,
//     /legal/confidentialite, /legal/cookies) — NEVER /legal/cgu (does not exist).
// Static marketing content: no owner data, no loading/error states.

const SYMBOL_COLOR = '/brand/grubano-symbol-color.svg'

export default async function LogisticsLandingPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale)

  const tm = await getTranslations('business.logistics.landing')

  const feats = [
    { ic: 'explore',       key: 'feat1', basil: false },
    { ic: 'schedule',      key: 'feat2', basil: true  },
    { ic: 'check_circle',  key: 'feat3', basil: false },
    { ic: 'shield',        key: 'feat4', basil: true  },
    { ic: 'two_wheeler',   key: 'feat5', basil: false },
    { ic: 'support_agent', key: 'feat6', basil: true  },
  ] as const

  const steps = [
    { n: '1', ic: 'schedule',       key: 'step1' },
    { n: '2', ic: 'description',    key: 'step2' },
    { n: '3', ic: 'verified_user',  key: 'step3' },
    { n: '4', ic: 'two_wheeler',    key: 'step4' },
  ] as const

  return (
    <div className="lo-mkt">

      {/* ── nav ─────────────────────────────────────────────────────────── */}
      <nav className="nav">
        <div className="nav__in">
          <Link className="nav__brand" href="/business/logistics">
            <img src={SYMBOL_COLOR} alt="Grubano" /><b>Grubano</b><span>{tm('navBadge')}</span>
          </Link>
          <div className="nav__links">
            <a href="#pourquoi">{tm('navWhy')}</a>
            <a href="#etapes">{tm('navHow')}</a>
            <a href="#remu">{tm('navRevenue')}</a>
            <a href="#faq">{tm('navFaq')}</a>
            <Link className="nav__cta" href="/business/logistics/register">{tm('navCta')}<span className="ms">arrow_forward</span></Link>
          </div>
        </div>
      </nav>

      {/* ── hero ────────────────────────────────────────────────────────── */}
      <header className="hero" id="top">
        <div className="hero__in">
          <div>
            <span className="hero__eyebrow"><span className="ms">two_wheeler</span>{tm('heroEyebrow')}</span>
            <h1>{tm('heroTitleA')}<br />{tm('heroTitleB')} <span className="hl">{tm('heroTitleHl')}</span></h1>
            <p className="hero__sub">{tm('heroSub')}</p>
            <div className="hero__cta">
              <Link className="btn-lo" href="/business/logistics/register"><span className="ms">rocket_launch</span>{tm('heroCtaApply')}</Link>
              <a className="btn-ghost" href="#pourquoi"><span className="ms">play_circle</span>{tm('heroCtaDiscover')}</a>
            </div>
            <div className="hero__note"><span className="ms">schedule</span>{tm('heroNote')}</div>
          </div>
          <div className="hero__art">
            <img src={SYMBOL_COLOR} alt="Grubano" />
            {/* qualitative chips — kept from the maquette, no fabricated numbers */}
            <div className="hero__chip c1">
              <span className="ic" style={{ background: 'var(--gb-lo)' }}><span className="ms">explore</span></span>
              <div><b>{tm('heroChip1Title')}</b><span>{tm('heroChip1Sub')}</span></div>
            </div>
            <div className="hero__chip c2">
              <span className="ic" style={{ background: 'var(--gb-basil)' }}><span className="ms">schedule</span></span>
              <div><b>{tm('heroChip2Title')}</b><span>{tm('heroChip2Sub')}</span></div>
            </div>
          </div>
        </div>
      </header>

      {/* ── notice (waitlist banner — honest, kept verbatim) ─────────────── */}
      <div className="notice">
        <div className="notice__in"><span className="ms">info</span>{tm('notice')}</div>
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
                <p>{tm(`${f.key}Body`)}</p>
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
                <p>{tm(`${s.key}Body`)}</p>
                <div className="step__t"><span className="ms">{s.ic}</span>{tm(`${s.key}Tag`)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── rémunération (honest — NO rate, « Barème communiqué au lancement ») ── */}
      <section className="sec" id="remu">
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
                  <div><b>{tm(`${k}Title`)}</b><p>{tm(`${k}Body`)}</p></div>
                </div>
              ))}
            </div>
            <div className="rev__card">
              <h3>{tm('revCardTitle')}</h3>
              <div className="rev__terms">
                <div className="rev__term"><span className="k">{tm('termFeesLabel')}</span><span className="v">{tm('termFeesVal')}</span></div>
                <div className="rev__term"><span className="k">{tm('termStatusLabel')}</span><span className="v">{tm('termStatusVal')}</span></div>
                <div className="rev__term"><span className="k">{tm('termFlexLabel')}</span><span className="v">{tm('termFlexVal')}</span></div>
                {/* honest — the exact barème is only communicated at launch */}
                <div className="rev__term"><span className="k">{tm('termScaleLabel')}</span><span className="v">{tm('termScaleVal')}</span></div>
              </div>
              <div className="rev__note"><span className="ms">info</span><span>{tm('revNote')}</span></div>
              <Link className="btn-lo" href="/business/logistics/register" style={{ width: '100%', marginTop: 20 }}><span className="ms">rocket_launch</span>{tm('revCta')}</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── faq ─────────────────────────────────────────────────────────── */}
      <section className="sec" id="faq" style={{ background: 'var(--gb-surface-2)' }}>
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
          <h2>{tm('ctaBandTitle')}</h2>
          <p>{tm('ctaBandSub')}</p>
          <Link className="btn-lo" href="/business/logistics/register"><span className="ms">rocket_launch</span>{tm('ctaBandBtn')}</Link>
        </div>
      </div>

      {/* ── footer (disclaimed + REAL legal links, never /legal/cgu) ─────── */}
      <footer className="foot">
        <div className="foot__in">
          <div className="foot__brand"><img src={SYMBOL_COLOR} alt="Grubano" /><b>Grubano</b></div>
          <div className="foot__links">
            <a href="#pourquoi">{tm('navWhy')}</a>
            <a href="#remu">{tm('navRevenue')}</a>
            <a href="#faq">{tm('navFaq')}</a>
            <Link href="/business/logistics/register">{tm('navCta')}</Link>
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
