import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import { prisma } from '@/lib/prisma'
import './creator-landing.css'

// ── CR1 · Landing publique « Devenez créateur » (CD marketing --gb-*) ────────────────
// PUBLIC route /creators (∈ AppChrome BARE_PREFIXES) → full-bleed marketing page in the
// consumer gb-foundation language (crème + ROSE-MAGENTA creator accent --gb-cr / --gb-bloom),
// NOT the navy console shell. Re-skin of the banked CD maquette CR1 with the mandated
// HONESTY edits (integration note D6):
//   • the fabricated hero chip « 48k vues moyennes* » → replaced by a REAL public stat
//     (published-recipe count from getCreatorStats) or dropped when zero ;
//   • the named fictional testimonial « Léa Moreau » → REMOVED entirely (no tm-sec) ;
//   • the current screen's FALLBACK_LEADERBOARD + EUR-per-creator leaderboard → PURGED
//     (the maquette has none → drops the public individual-€ leak) ;
//   • the commission rate is NEVER shown hardcoded — the honest « présenté à l'activation »
//     posture is kept, revenus « non garantis », footer disclaimed.
// A subtle real « Déjà créateur ? → Mon studio » entry (nav + band) is preserved so
// existing creators keep a way in (calque of the Franchise landing).

type CreatorStats = {
  activeCount:  number
  publishedRecipes: number
}

async function getCreatorStats(): Promise<CreatorStats> {
  try {
    const [activeCount, publishedRecipes] = await Promise.all([
      prisma.creator.count(),
      prisma.creatorDish.count({ where: { status: { in: ['approved', 'live'] } } }),
    ])
    return { activeCount, publishedRecipes }
  } catch {
    return { activeCount: 0, publishedRecipes: 0 }
  }
}

const SYMBOL_COLOR = '/brand/grubano-symbol-color.svg'
const SYMBOL_WHITE = '/brand/grubano-symbol-white.svg'

export default async function CreatorsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale)

  const [t, tm, stats] = await Promise.all([
    getTranslations('creators'),
    getTranslations('creators.mkt'),
    getCreatorStats(),
  ])

  // honest hero chip — REAL published-recipe count (replaces the fabricated « 48k vues »).
  // dropped entirely when there is nothing measured yet (never fabricate a number).
  const showRecipesChip = stats.publishedRecipes > 0

  const feats = [
    { ic: 'restaurant_menu', key: 'f1', basil: false },
    { ic: 'link',           key: 'f2', basil: true  },
    { ic: 'trending_up',    key: 'f3', basil: false },
    { ic: 'verified',       key: 'f4', basil: true  },
    { ic: 'groups',         key: 'f5', basil: false },
    { ic: 'savings',        key: 'f6', basil: true  },
  ] as const

  const steps = [
    { n: '1', ic: 'schedule',        key: 's1' },
    { n: '2', ic: 'verified',        key: 's2' },
    { n: '3', ic: 'restaurant_menu', key: 's3' },
    { n: '4', ic: 'payments',        key: 's4' },
  ] as const

  return (
    <div className="cr-mkt">

      {/* ── nav ─────────────────────────────────────────────────────────── */}
      <nav className="nav">
        <div className="nav__in">
          <Link className="nav__brand" href="/creators">
            <img src={SYMBOL_COLOR} alt="Grubano" /><b>Grubano</b><span>{tm('badge')}</span>
          </Link>
          <div className="nav__links">
            <a href="#pourquoi">{tm('navWhy')}</a>
            <a href="#etapes">{tm('navHow')}</a>
            <a href="#revenus">{tm('navRevenue')}</a>
            <a href="#faq">{tm('navFaq')}</a>
            <Link className="nav__studio" href="/creators/dashboard"><span className="ms">login</span>{tm('navStudio')}</Link>
            <Link className="nav__cta" href="/creators/apply">{tm('navApply')}<span className="ms">arrow_forward</span></Link>
          </div>
        </div>
      </nav>

      {/* ── hero ────────────────────────────────────────────────────────── */}
      <header className="hero" id="top">
        <div className="hero__in">
          <div>
            <span className="hero__eyebrow"><span className="ms">palette</span>{tm('heroEyebrow')}</span>
            <h1>{tm('heroTitleA')}<br />{tm('heroTitleB')} <span className="hl">{tm('heroTitleHl')}</span></h1>
            <p className="hero__sub">{tm('heroSub')}</p>
            <div className="hero__cta">
              <Link className="btn-cr" href="/creators/apply"><span className="ms">rocket_launch</span>{tm('heroCtaApply')}</Link>
              <a className="btn-ghost" href="#pourquoi"><span className="ms">play_circle</span>{tm('heroCtaDiscover')}</a>
            </div>
            <div className="hero__note"><span className="ms">check_circle</span>{tm('heroNote')}</div>
          </div>
          <div className="hero__art">
            <img src={SYMBOL_WHITE} alt="Grubano" />
            {/* honest chip 1 — REAL published-recipe count (replaces fabricated « 48k vues ») */}
            {showRecipesChip && (
              <div className="hero__chip c1">
                <span className="ic" style={{ background: 'var(--gb-cr)' }}><span className="ms">restaurant_menu</span></span>
                <div><b>{stats.publishedRecipes}</b><span>{tm('heroChipRecipes')}</span></div>
              </div>
            )}
            {/* honest chip 2 — qualitative, no fabricated number (kept from maquette) */}
            <div className="hero__chip c2">
              <span className="ic" style={{ background: 'var(--gb-basil)' }}><span className="ms">payments</span></span>
              <div><b>{tm('heroChipCommissions')}</b><span>{tm('heroChipCommissionsSub')}</span></div>
            </div>
          </div>
        </div>
      </header>

      {/* ── trust strip (qualitative — no fabricated numbers) ────────────── */}
      <div className="trust">
        <div className="trust__in">
          <div className="trust__it"><b>{tm('trustStudio')}</b><span>{tm('trustStudioSub')}</span></div>
          <div className="trust__it"><b>{tm('trustRecipes')}</b><span>{tm('trustRecipesSub')}</span></div>
          <div className="trust__it"><b>{tm('trustAffiliation')}</b><span>{tm('trustAffiliationSub')}</span></div>
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

      {/* ── revenus (honest — NO hardcoded rate, non garantis) ──────────── */}
      <section className="sec" id="revenus">
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
                <div className="rev__term"><span className="k">{tm('termRecipesLabel')}</span><span className="v">{tm('termRecipesVal')}</span></div>
                <div className="rev__term"><span className="k">{tm('termPayLabel')}</span><span className="v">{tm('termPayVal')}</span></div>
                <div className="rev__term"><span className="k">{tm('termPayoutLabel')}</span><span className="v">{tm('termPayoutVal')}</span></div>
              </div>
              <div className="rev__note"><span className="ms">info</span><span>{tm('revNote')}</span></div>
              <Link className="btn-cr" href="/creators/apply" style={{ width: '100%', marginTop: 20 }}><span className="ms">rocket_launch</span>{tm('revCta')}</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── already-creator band (real entry — replaces fictional testimonial) ── */}
      <section className="sec" id="deja">
        <div className="wrap">
          <div className="cr-banner">
            <div className="cr-banner__t">
              <b>{t('alreadyCreator')}</b>
              <span>{t('alreadyCreatorDesc')}</span>
            </div>
            <Link href="/creators/dashboard"><span className="ms">space_dashboard</span>{t('mySpace')}</Link>
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
          <Link className="btn-cr" href="/creators/apply"><span className="ms">rocket_launch</span>{tm('ctaBtn')}</Link>
        </div>
      </div>

      {/* ── footer (disclaimed) ─────────────────────────────────────────── */}
      <footer className="foot">
        <div className="foot__in">
          <div className="foot__brand"><img src={SYMBOL_COLOR} alt="Grubano" /><b>Grubano</b></div>
          <div className="foot__links">
            <a href="#pourquoi">{tm('navWhy')}</a>
            <a href="#revenus">{tm('navRevenue')}</a>
            <a href="#faq">{tm('navFaq')}</a>
            <Link href="/creators/apply">{tm('navApply')}</Link>
          </div>
          <div className="foot__copy">{tm('footCopy')}</div>
        </div>
      </footer>
    </div>
  )
}
