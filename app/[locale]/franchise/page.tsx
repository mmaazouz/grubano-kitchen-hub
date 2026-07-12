import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import { prisma } from '@/lib/prisma'
import BrandJoinCTA from './BrandJoinCTA'
import MyFranchiseeApplications from './MyFranchiseeApplications'
import './franchise-landing.css'

// ── FR7 · Landing publique « Devenez franchisé » (CD marketing --gb-*) ───────────────
// PUBLIC route /franchise (∈ AppChrome BARE_PREFIXES) → full-bleed marketing page in the
// consumer gb-foundation language (crème + zest + basil), NOT the navy console shell
// (brief D3). Re-skin of the banked CD maquette FR7 with the mandated HONESTY edits:
//   • the fabricated « +18 % de couverts » chip → replaced by a REAL stat (brand count) ;
//   • the named fictional testimonial (« Marc Dubois ») → REMOVED entirely ;
//   • the royalty rate shown in the offer/FAQ = the REAL network default (Brand.royaltyPct,
//     never a hardcoded 5 %) ;
//   • the real open-brand catalogue is PRESERVED as a « Nos marques » section with the B7
//     BrandJoinCTA + MyFranchiseeApplications (founder decision) — the revenue calculator
//     (a projection) is dropped.
// The entry-fee / duration / budget / apport figures are EDITORIAL marketing copy (no
// contract model) — disclaimed as indicatif and SIGNALLED for business confirmation.

type BrandRow = {
  id:          string
  name:        string
  cuisine:     string
  emoji:       string
  description: string
  avgRevenue:  number
  setupCost:   number
  royaltyRate: number
  citiesAvail: string[]
  available:   boolean
}

type FranchiseStats = {
  brandCount: number
  avgRevenue: number | null
  posCount:   number
}

const DEFAULT_ROYALTY = 0.06 // network default = resolveFranchiseRate fallback (Brand.royaltyPct ?? 0.06)

async function getFranchiseStats(): Promise<FranchiseStats> {
  try {
    const [brandCount, aggResult, posCount] = await Promise.all([
      prisma.brand.count({ where: { openToFranchise: true } }),
      prisma.brand.aggregate({ where: { openToFranchise: true }, _avg: { avgMonthlyRevenue: true } }),
      prisma.pointOfSale.count(),
    ])
    const avg = aggResult._avg.avgMonthlyRevenue
    return { brandCount, avgRevenue: avg && avg > 0 ? avg : null, posCount }
  } catch {
    return { brandCount: 0, avgRevenue: null, posCount: 0 }
  }
}

async function getBrands(): Promise<BrandRow[]> {
  try {
    const dbBrands = await prisma.brand.findMany({
      where:   { openToFranchise: true },
      include: { pointsOfSale: { select: { id: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return dbBrands.map(b => ({
      id:          b.id,
      name:        b.name,
      cuisine:     b.cuisineType       ?? '',
      emoji:       b.emoji,
      description: b.tagline           ?? '',
      avgRevenue:  b.avgMonthlyRevenue ?? 0,
      setupCost:   b.setupFee          ?? 0,
      royaltyRate: b.royaltyPct        ?? DEFAULT_ROYALTY,
      citiesAvail: (Array.isArray(b.franchiseZones) ? b.franchiseZones : []) as string[],
      available:   b.franchiseStatus !== 'full',
    }))
  } catch {
    return []
  }
}

/** Real network royalty rate (integer %). Uniform across open brands → that value ;
 *  otherwise the network default (0.06). NEVER a hardcoded marketing 5 %. */
function networkRatePct(brands: BrandRow[]): number {
  const rates = Array.from(new Set(brands.filter(b => b.available).map(b => b.royaltyRate)))
  const rate = rates.length === 1 ? rates[0] : DEFAULT_ROYALTY
  return Math.round(rate * 100)
}

const SYMBOL_COLOR = '/brand/grubano-symbol-color.svg'
const SYMBOL_WHITE = '/brand/grubano-symbol-white.svg'

export default async function FranchisePage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale)

  const [t, tm, stats, brands] = await Promise.all([
    getTranslations('franchise'),
    getTranslations('franchise.mkt'),
    getFranchiseStats(),
    getBrands(),
  ])

  const ratePct   = networkRatePct(brands)
  const available = brands.filter(b => b.available)

  const feats = [
    { ic: 'verified',       key: 'f1', basil: false },
    { ic: 'devices',        key: 'f2', basil: true  },
    { ic: 'school',         key: 'f3', basil: false },
    { ic: 'insights',       key: 'f4', basil: true  },
    { ic: 'groups',         key: 'f5', basil: false },
    { ic: 'local_shipping', key: 'f6', basil: true  },
  ] as const

  const steps = [
    { n: '1', ic: 'schedule',    key: 's1' },
    { n: '2', ic: 'groups',      key: 's2' },
    { n: '3', ic: 'school',      key: 's3' },
    { n: '4', ic: 'celebration', key: 's4' },
  ] as const

  return (
    <div className="fr-mkt">

      {/* ── nav ─────────────────────────────────────────────────────────── */}
      <nav className="nav">
        <div className="nav__in">
          <Link className="nav__brand" href="/franchise">
            <img src={SYMBOL_COLOR} alt="Grubano" /><b>Grubano</b><span>{tm('badge')}</span>
          </Link>
          <div className="nav__links">
            <a href="#concept">{tm('navConcept')}</a>
            <a href="#etapes">{tm('navHow')}</a>
            <a href="#invest">{tm('navInvest')}</a>
            <a href="#faq">{tm('navFaq')}</a>
            <Link className="nav__cta" href="/franchise/apply">{tm('navApply')}<span className="ms">arrow_forward</span></Link>
          </div>
        </div>
      </nav>

      {/* ── hero ────────────────────────────────────────────────────────── */}
      <header className="hero" id="top">
        <div className="hero__in">
          <div>
            <span className="hero__eyebrow"><span className="ms">storefront</span>{tm('heroEyebrow')}</span>
            <h1>{tm('heroTitleA')}<br />{tm('heroTitleB')} <span className="hl">{tm('heroTitleHl')}</span></h1>
            <p className="hero__sub">{tm('heroSub')}</p>
            <div className="hero__cta">
              <Link className="btn-zest" href="/franchise/apply"><span className="ms">rocket_launch</span>{tm('heroCtaApply')}</Link>
              <a className="btn-ghost" href="#concept"><span className="ms">play_circle</span>{tm('heroCtaConcept')}</a>
            </div>
            <div className="hero__note"><span className="ms">schedule</span>{tm('heroNote')}</div>
          </div>
          <div className="hero__art">
            <img src={SYMBOL_WHITE} alt="Grubano" />
            {/* honest chip — REAL open-brand count (replaces the fabricated « +18 % ») */}
            <div className="hero__chip c1">
              <span className="ic" style={{ background: 'var(--gb-basil)' }}><span className="ms">storefront</span></span>
              <div><b>{stats.brandCount}</b><span>{tm('heroChipBrands')}</span></div>
            </div>
            <div className="hero__chip c2">
              <span className="ic" style={{ background: 'var(--gb-zest-600)' }}><span className="ms">all_inclusive</span></span>
              <div><b>{tm('heroChipAllInOne')}</b><span>{tm('heroChipAllInOneSub')}</span></div>
            </div>
          </div>
        </div>
      </header>

      {/* ── trust strip ─────────────────────────────────────────────────── */}
      <div className="trust">
        <div className="trust__in">
          <div className="trust__it"><b>{stats.brandCount}</b><span>{tm('trustBrandsSub')}</span></div>
          <div className="trust__it"><b>{tm('trustServices')}</b><span>{tm('trustServicesSub')}</span></div>
          <div className="trust__it"><b>{tm('trustYears')}</b><span>{tm('trustYearsSub')}</span></div>
          <div className="trust__it"><b>{tm('trustSupport')}</b><span>{tm('trustSupportSub')}</span></div>
        </div>
      </div>

      {/* ── concept ─────────────────────────────────────────────────────── */}
      <section className="sec" id="concept">
        <div className="wrap">
          <div className="sec__head">
            <span className="sec__eyebrow">{tm('conceptEyebrow')}</span>
            <h2>{tm('conceptTitle')}</h2>
            <p>{tm('conceptSub')}</p>
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

      {/* ── steps ───────────────────────────────────────────────────────── */}
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

      {/* ── investment (redevance = REAL rate; other figures editorial/disclaimed) ── */}
      <section className="sec" id="invest">
        <div className="wrap">
          <div className="sec__head">
            <span className="sec__eyebrow">{tm('investEyebrow')}</span>
            <h2>{tm('investTitle')}</h2>
          </div>
          <div className="inv">
            <div className="inv__list">
              {['inv1', 'inv2', 'inv3', 'inv4'].map(k => (
                <div key={k} className="inv__row">
                  <span className="ms">check</span>
                  <div><b>{tm(`${k}Title`)}</b><p>{tm(`${k}Desc`)}</p></div>
                </div>
              ))}
            </div>
            <div className="inv__card">
              <h3>{tm('investCardTitle')}</h3>
              <div className="inv__big">{tm('investBig')}<small> {tm('investBigUnit')}</small></div>
              <div className="inv__terms">
                <div className="inv__term"><span className="k">{tm('termRoyalty')}</span><span className="v">{tm('termRoyaltyVal', { pct: ratePct })}</span></div>
                <div className="inv__term"><span className="k">{tm('termDuration')}</span><span className="v">{tm('termDurationVal')}</span></div>
                <div className="inv__term"><span className="k">{tm('termBudget')}</span><span className="v">{tm('termBudgetVal')}</span></div>
                <div className="inv__term"><span className="k">{tm('termApport')}</span><span className="v">{tm('termApportVal')}</span></div>
              </div>
              <div className="inv__note"><span className="ms">info</span><span>{tm('investNote')}</span></div>
              <Link className="btn-zest" href="/franchise/apply" style={{ width: '100%', marginTop: 20 }}><span className="ms">rocket_launch</span>{tm('investCta')}</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Nos marques (REAL catalogue — B7 join flow preserved) ────────────── */}
      <section className="sec brands-sec" id="marques">
        <div className="wrap">
          <div className="sec__head">
            <span className="sec__eyebrow">{tm('brandsEyebrow')}</span>
            <h2>{tm('brandsSecTitle')}</h2>
            <p>{tm('brandsSecSub')}</p>
          </div>

          {/* already a franchisee → dashboard */}
          <div className="fr-banner">
            <div className="fr-banner__t">
              <b>{t('alreadyFranchisee')}</b>
              <span>{t('alreadyFranchiseeDesc')}</span>
            </div>
            <Link href="/franchise/dashboard"><span className="ms">space_dashboard</span>{t('mySpace')}</Link>
          </div>

          {/* my own franchisee candidacies (renders only when signed-in with ≥1) */}
          <div className="fr-mine"><MyFranchiseeApplications /></div>

          {available.length === 0 ? (
            <div className="fr-banner" style={{ justifyContent: 'center', textAlign: 'center' }}>
              <div className="fr-banner__t">
                <b>{t('brandsEmpty')}</b>
                <span>{t('brandsEmptyDesc')}</span>
              </div>
            </div>
          ) : (
            <div className="bgrid">
              {available.map(brand => (
                <div key={brand.id} className="bcard">
                  <div className="bcard__hd">
                    <span className="bcard__emoji">{brand.emoji}</span>
                    <div className="bcard__ti">
                      <b>{brand.name}</b>
                      <span>{brand.cuisine}</span>
                    </div>
                  </div>
                  {brand.description && <p className="bcard__desc">{brand.description}</p>}
                  <div className="bcard__stats">
                    <div className="bcard__stat"><b>{(brand.avgRevenue / 1000).toFixed(1)}k€</b><span>{t('brandLabelRevenue')}</span></div>
                    <div className="bcard__stat"><b>{brand.setupCost.toLocaleString('fr-FR')}€</b><span>{t('brandLabelSetup')}</span></div>
                    <div className="bcard__stat"><b>{Math.round(brand.royaltyRate * 100)}%</b><span>{t('brandLabelRoyalties')}</span></div>
                  </div>
                  {brand.citiesAvail.length > 0 && (
                    <div className="bcard__cities">
                      {brand.citiesAvail.map(city => <span key={city} className="bcard__city">{city}</span>)}
                    </div>
                  )}
                  <div className="bcard__foot">
                    <BrandJoinCTA brandId={brand.id} brandName={brand.name} />
                  </div>
                </div>
              ))}
            </div>
          )}
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
            <details className="qa"><summary>{tm('q3')}<span className="ms">expand_more</span></summary><div className="qa__a">{tm('a3', { pct: ratePct })}</div></details>
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
          <Link className="btn-zest" href="/franchise/apply"><span className="ms">rocket_launch</span>{tm('ctaBtn')}</Link>
        </div>
      </div>

      {/* ── footer ──────────────────────────────────────────────────────── */}
      <footer className="foot">
        <div className="foot__in">
          <div className="foot__brand"><img src={SYMBOL_COLOR} alt="Grubano" /><b>Grubano</b></div>
          <div className="foot__links">
            <a href="#concept">{tm('navConcept')}</a>
            <a href="#invest">{tm('navInvest')}</a>
            <a href="#faq">{tm('navFaq')}</a>
            <Link href="/franchise/apply">{tm('navApply')}</Link>
          </div>
          <div className="foot__copy">{tm('footCopy')}</div>
        </div>
      </footer>
    </div>
  )
}
