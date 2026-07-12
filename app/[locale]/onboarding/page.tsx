'use client'

import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/navigation'
import { formatEuros } from '@/lib/format-money'
import './onboarding.css'

// ── /onboarding — operator FIRST-establishment wizard — VERBATIM CD v1
// (Notion 391fd2c9-…-b084d162, LOT 7). ⚠️ FULL-SCREEN assistant (N=0): this route
// is in AppChrome.BARE_PREFIXES so it renders WITHOUT the navy OperatorShell — the
// page owns its OWN full-screen layout (see onboarding.css). Middleware already
// gates /onboarding to restaurant/admin (OPERATOR_FLAT_PREFIXES), so the session
// cookie is present and every same-origin POST below authenticates automatically.
//
// 🔌 WIRING (founder ask — the 4 steps drive the REAL creation, EXISTING endpoints
// only, no new/modified API route):
//   Step 1 « Votre restaurant » → collects {name, city, address, cuisine[], phone}.
//   Step 2 « Horaires »         → VISUAL ONLY (no hours endpoint exists) — honest
//                                 note, not persisted.
//   Step 3 « Votre menu »       → collects dishes {name, price EUROS} locally.
//   Step 4 « Mise en ligne »    → « Mettre mon restaurant en ligne »:
//       1. POST /api/restaurants (NO additional → 1st establishment; the server
//          FORCES isActive:false, awaiting admin validation — shown honestly).
//       2. POST /api/brands ({name, emoji, cuisineType, restaurantId}).
//       3. POST /api/menu per dish ({brandId, name, price EUROS Float, category}).
//   The CD demo bar + its <script> are REMOVED; goStep/addDish/toggleDay/publish
//   are React state. Dish price shown via formatEuros(euros, locale), className="mono".

// ── Types ──────────────────────────────────────────────────────────────────────

interface Dish {
  id: string
  name: string
  price: number // EUROS (Float) — MenuItem.price
}

interface DayHours {
  key: string
  open: boolean
  hours: string
}

const CUISINE_OPTIONS = [
  { value: 'italien', key: 'cuisineItalien' },
  { value: 'francais', key: 'cuisineFrancais' },
  { value: 'japonais', key: 'cuisineJaponais' },
  { value: 'mediterraneen', key: 'cuisineMediterraneen' },
  { value: 'burgers', key: 'cuisineBurgers' },
  { value: 'autre', key: 'cuisineAutre' },
] as const

const DEFAULT_HOURS = '12:00 – 14:30, 19:00 – 22:30'

// Parse a "12,50" / "12.50" euro string → Float euros (NaN-safe). Display only
// uses formatEuros; this is the single spot that turns typed text into a number.
function parseEuros(raw: string): number {
  const n = Number(raw.trim().replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : 0
}

export default function OnboardingPage() {
  const t = useTranslations('operator.onboarding')
  const locale = useLocale()
  const router = useRouter()

  const [step, setStep] = useState(1) // 1..4
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState(false)

  // ── Step 1 — restaurant infos (wired to POST /api/restaurants) ──
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [cuisine, setCuisine] = useState('')
  const [phone, setPhone] = useState('')

  // ── Step 2 — hours (VISUAL only — no hours endpoint) ──
  const [days, setDays] = useState<DayHours[]>([
    { key: 'mon', open: true, hours: DEFAULT_HOURS },
    { key: 'tue', open: true, hours: DEFAULT_HOURS },
    { key: 'wed', open: true, hours: DEFAULT_HOURS },
    { key: 'thu', open: true, hours: DEFAULT_HOURS },
    { key: 'fri', open: true, hours: '12:00 – 14:30, 19:00 – 23:00' },
    { key: 'sat', open: true, hours: '12:00 – 23:00' },
    { key: 'sun', open: false, hours: t('closed') },
  ])

  // ── Step 3 — menu (collected locally; POSTed on publish) ──
  const [dishes, setDishes] = useState<Dish[]>([])
  const [newDishName, setNewDishName] = useState('')
  const [newDishPrice, setNewDishPrice] = useState('')

  const openDaysCount = days.filter((d) => d.open).length
  const progressPct = step * 25

  const cuisineLabel = useMemo(() => {
    const opt = CUISINE_OPTIONS.find((c) => c.value === cuisine)
    return opt ? t(opt.key) : ''
  }, [cuisine, t])

  // ── navigation ──
  function goStep(n: number) {
    setError(null)
    setStep(Math.min(4, Math.max(1, n)))
  }
  function nextStep() {
    if (step === 4) { publish(); return }
    // Guard step 1 with the same required fields the real endpoint enforces, so
    // the operator sees the error INLINE before the network round-trip.
    if (step === 1 && (!name.trim() || !address.trim() || !city.trim())) {
      setError(t('errRequiredResto'))
      return
    }
    goStep(step + 1)
  }
  function prevStep() { if (step > 1) goStep(step - 1) }

  // ── hours toggle (visual) ──
  function toggleDay(key: string) {
    setDays((prev) => prev.map((d) =>
      d.key !== key ? d : d.open
        ? { ...d, open: false, hours: t('closed') }
        : { ...d, open: true, hours: d.hours === t('closed') ? DEFAULT_HOURS : d.hours },
    ))
  }
  function setDayHours(key: string, value: string) {
    setDays((prev) => prev.map((d) => (d.key === key ? { ...d, hours: value } : d)))
  }

  // ── dishes ──
  function addDish() {
    const n = newDishName.trim()
    if (!n) return
    setDishes((prev) => [...prev, { id: crypto.randomUUID(), name: n, price: parseEuros(newDishPrice) }])
    setNewDishName('')
    setNewDishPrice('')
  }
  function delDish(id: string) {
    setDishes((prev) => prev.filter((d) => d.id !== id))
  }

  // ── publish → REAL creation via EXISTING endpoints ──
  async function publish() {
    if (!name.trim() || !address.trim() || !city.trim()) {
      setError(t('errRequiredResto'))
      goStep(1)
      return
    }
    setSaving(true)
    setError(null)
    try {
      // 1) Restaurant (1st establishment → NO additional flag → server forces
      //    isActive:false, awaiting admin validation).
      const rRes = await fetch('/api/restaurants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          address: address.trim(),
          city: city.trim(),
          cuisine: cuisine ? [cuisine] : [],
        }),
      })
      const rData = await rRes.json().catch(() => ({}))
      if (!rRes.ok) {
        setError(rData?.error || t('errRestaurantFailed'))
        setSaving(false)
        return
      }
      const restaurantId: string | undefined = rData?.restaurant?.id

      // 2) Brand for this establishment (best-effort — the restaurant already
      //    exists; a brand failure must not claim the whole thing failed).
      let brandId: string | undefined
      try {
        const bRes = await fetch('/api/brands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            cuisineType: cuisineLabel || undefined,
            ...(restaurantId ? { restaurantId } : {}),
          }),
        })
        const bData = await bRes.json().catch(() => ({}))
        if (bRes.ok) brandId = bData?.brand?.id
      } catch { /* non-blocking */ }

      // 3) Menu items (only if a brand was created — MenuItem requires a brandId).
      //    Price is a Float in EUROS. Best-effort per dish; a failed dish is
      //    skipped, never fabricated.
      if (brandId && dishes.length > 0) {
        await Promise.allSettled(dishes.map((d) =>
          fetch('/api/menu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              brandId,
              name: d.name,
              price: d.price > 0 ? d.price : 0.01,
              category: t('defaultCategory'),
            }),
          }),
        ))
      }

      setCreated(true)
    } catch {
      setError(t('errNetwork'))
    } finally {
      setSaving(false)
    }
  }

  // ── step meta for the left rail ──
  const stepMeta = [
    { n: 1, key: 'stepResto' },
    { n: 2, key: 'stepHours' },
    { n: 3, key: 'stepMenu' },
    { n: 4, key: 'stepPublish' },
  ]

  return (
    <div className="gb-op-onb">
      <div className="onb-shell">
        {/* ── top bar (logo + progress + Quitter) ── */}
        <header className="onb-topbar">
          <div className="onb-topbar__brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/grubano-symbol-color.svg" alt="" />
            <b>Grubano Business</b>
          </div>
          {!created && (
            <div className="onb-progress">
              <div className="onb-progress__lbl">
                {t('stepLabel', { current: step, total: 4 })}
              </div>
              <div className="onb-progress__track">
                <div className="onb-progress__fill" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          )}
          <button type="button" className="onb-quit" onClick={() => router.push('/dashboard')}>
            <span className="ms" aria-hidden="true">close</span><span>{t('quit')}</span>
          </button>
        </header>

        <div className="onb-body">
          {/* ── left step list (hidden mobile) ── */}
          {!created && (
            <aside className="onb-steplist">
              {stepMeta.map((s) => {
                const state = s.n < step ? 'done' : s.n === step ? 'active' : ''
                return (
                  <div key={s.n} className={`onb-steplist__item ${state}`}>
                    <span className="num">
                      {s.n < step ? <span className="ms" aria-hidden="true">check</span> : s.n}
                    </span>
                    <b>{t(s.key)}</b>
                  </div>
                )
              })}
            </aside>
          )}

          {/* ── panel ── */}
          <div className="onb-panel">
            {error && (
              <div className="onb-error-banner" role="alert">
                <span className="ms" aria-hidden="true">error</span>
                <span>{error}</span>
              </div>
            )}

            {/* ══ CREATED — honest « pending admin validation » success ══ */}
            {created ? (
              <div className="onb-card">
                <div className="onb-done">
                  <span className="ms big" aria-hidden="true">check_circle</span>
                  <h1>{t('doneTitle')}</h1>
                  <p>{t('donePending')}</p>
                  <button type="button" className="cta" onClick={() => router.push('/dashboard')}>
                    {t('doneCta')}<span className="ms flip-rtl" aria-hidden="true">arrow_forward</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="onb-card">
                {/* ── STEP 1 — Votre restaurant ── */}
                {step === 1 && (
                  <div className="onb-step">
                    <h1 className="onb-card__title">{t('restoTitle')}</h1>
                    <p className="onb-card__sub">{t('restoSub')}</p>
                    <div className="op-field">
                      <label htmlFor="onb-name">{t('nameLabel')}</label>
                      <input id="onb-name" className="op-input" type="text" placeholder={t('namePlaceholder')}
                        value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div className="op-field">
                      <label htmlFor="onb-address">{t('addressLabel')}</label>
                      <input id="onb-address" className="op-input" type="text" placeholder={t('addressPlaceholder')}
                        value={address} onChange={(e) => setAddress(e.target.value)} />
                    </div>
                    <div className="op-field">
                      <label htmlFor="onb-city">{t('cityLabel')}</label>
                      <input id="onb-city" className="op-input" type="text" placeholder={t('cityPlaceholder')}
                        value={city} onChange={(e) => setCity(e.target.value)} />
                    </div>
                    <div className="op-field-row">
                      <div className="op-field">
                        <label htmlFor="onb-cuisine">{t('cuisineLabel')}</label>
                        <select id="onb-cuisine" className="op-select"
                          value={cuisine} onChange={(e) => setCuisine(e.target.value)}>
                          <option value="" disabled>{t('cuisinePlaceholder')}</option>
                          {CUISINE_OPTIONS.map((c) => (
                            <option key={c.value} value={c.value}>{t(c.key)}</option>
                          ))}
                        </select>
                      </div>
                      <div className="op-field">
                        <label htmlFor="onb-phone">{t('phoneLabel')}</label>
                        <input id="onb-phone" className="op-input mono" type="text" placeholder="01 23 45 67 89"
                          value={phone} onChange={(e) => setPhone(e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}

                {/* ── STEP 2 — Horaires (VISUAL only) ── */}
                {step === 2 && (
                  <div className="onb-step">
                    <h1 className="onb-card__title">{t('hoursTitle')}</h1>
                    <p className="onb-card__sub">{t('hoursSub')}</p>
                    {days.map((d) => (
                      <div key={d.key} className={`hours-row${d.open ? '' : ' closed'}`}>
                        <span className="day">{t(`day.${d.key}`)}</span>
                        <button type="button" className={`toggle${d.open ? ' on' : ''}`}
                          onClick={() => toggleDay(d.key)} aria-pressed={d.open}
                          aria-label={t(`day.${d.key}`)} />
                        <input className="hours-time-input" type="text" value={d.hours} disabled={!d.open}
                          onChange={(e) => setDayHours(d.key, e.target.value)} />
                      </div>
                    ))}
                  </div>
                )}

                {/* ── STEP 3 — Votre menu ── */}
                {step === 3 && (
                  <div className="onb-step">
                    <h1 className="onb-card__title">{t('menuTitle')}</h1>
                    <p className="onb-card__sub">{t('menuSub')}</p>
                    <div>
                      {dishes.length === 0 ? (
                        <div className="onb-empty-menu">
                          <span className="ms" aria-hidden="true">restaurant_menu</span>
                          <span>{t('menuEmpty')}</span>
                        </div>
                      ) : dishes.map((d) => (
                        <div key={d.id} className="dish-row">
                          <span className="dish-row__ic"><span className="ms" aria-hidden="true">restaurant</span></span>
                          <div className="dish-row__m"><b>{d.name}</b><span>{t('dishTag')}</span></div>
                          <span className="dish-price-val mono">{formatEuros(d.price, locale)}</span>
                          <button type="button" className="dish-del" onClick={() => delDish(d.id)}
                            aria-label={t('remove')}>
                            <span className="ms" aria-hidden="true">delete</span>
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="dish-add-form">
                      <div className="op-field name-f">
                        <label htmlFor="onb-dish-name">{t('dishNameLabel')}</label>
                        <input id="onb-dish-name" className="op-input" type="text" placeholder={t('dishNamePlaceholder')}
                          value={newDishName} onChange={(e) => setNewDishName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDish() } }} />
                      </div>
                      <div className="op-field price-f">
                        <label htmlFor="onb-dish-price">{t('dishPriceLabel')}</label>
                        <input id="onb-dish-price" className="op-input mono" type="text" placeholder="0,00"
                          value={newDishPrice} onChange={(e) => setNewDishPrice(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDish() } }} />
                      </div>
                      <button type="button" className="onb-add-btn" onClick={addDish} disabled={!newDishName.trim()}>
                        <span className="ms" aria-hidden="true">add</span>{t('add')}
                      </button>
                    </div>
                    <button type="button" className="onb-later" onClick={() => goStep(4)}>{t('menuLater')}</button>
                  </div>
                )}

                {/* ── STEP 4 — Mise en ligne (récap) ── */}
                {step === 4 && (
                  <div className="onb-step">
                    <div className="onb-publish-card">
                      <span className="ms big" aria-hidden="true">check_circle</span>
                      <h1 className="onb-card__title">{t('publishTitle')}</h1>
                      <p className="onb-card__sub">{t('publishSub')}</p>
                    </div>
                    <div className="recap-row">
                      <span className="ms" aria-hidden="true">storefront</span>
                      <div className="recap-row__m">
                        <div className="lbl">{t('recapResto')}</div>
                        <div className="val">
                          {[name.trim() || t('recapRestoEmpty'), cuisineLabel].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <button type="button" className="recap-edit" onClick={() => goStep(1)}>{t('edit')}</button>
                    </div>
                    <div className="recap-row">
                      <span className="ms" aria-hidden="true">schedule</span>
                      <div className="recap-row__m">
                        <div className="lbl">{t('recapHours')}</div>
                        <div className="val">{t('recapHoursValue', { count: openDaysCount })}</div>
                      </div>
                      <button type="button" className="recap-edit" onClick={() => goStep(2)}>{t('edit')}</button>
                    </div>
                    <div className="recap-row">
                      <span className="ms" aria-hidden="true">restaurant_menu</span>
                      <div className="recap-row__m">
                        <div className="lbl">{t('recapMenu')}</div>
                        <div className="val">{t('recapMenuValue', { count: dishes.length })}</div>
                      </div>
                      <button type="button" className="recap-edit" onClick={() => goStep(3)}>{t('edit')}</button>
                    </div>
                    {/* Honest: the created restaurant starts INVISIBLE (isActive:false),
                        awaiting admin validation per the publication rule. */}
                    <div className="onb-review-notice">
                      <span className="ms" aria-hidden="true">info</span>
                      <span>{t('publishReviewNotice')}</span>
                    </div>
                  </div>
                )}

                {/* ── footer (Retour / Continuer|Publier) ── */}
                <div className="onb-foot">
                  <button type="button" className={`onb-btn-back${step === 1 ? ' is-hidden' : ''}`}
                    onClick={prevStep} disabled={saving}>
                    <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('back')}
                  </button>
                  <button type="button" className="onb-btn-next" onClick={nextStep} disabled={saving}>
                    {saving && <span className="onb-spin" aria-hidden="true" />}
                    {!saving && <span className="next-label">{step === 4 ? t('publishCta') : t('continue')}</span>}
                    {saving && <span className="next-label">{t('publishing')}</span>}
                    {!saving && step !== 4 && <span className="ms flip-rtl" aria-hidden="true">arrow_forward</span>}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
