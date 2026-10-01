'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Link, useRouter } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import StripeDepositForm from '@/components/eat/StripeDepositForm'
import SessionBadge from '@/components/session/SessionBadge'
import './reserver.css'
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

// ── /eat/r/[id]/reserver ──────────────────────────────────────────────────────
//
// CONSUMER reservation + Click&Collect screen. VERBATIM re-skin of the FROZEN CD
// ref (Notion 38efd2c9-…-81b8, eat/reservation.html) onto the gb- foundation +
// Material Symbols. Renders inside the EatShell in is-bare / immersive mode (the
// route /eat/r/ is IMMERSIVE → desktop rail kept, no top bar; this page header
// governs). CONTENT only — never duplicates the nav shell.
//
// 🔒 MONEY page. The Stripe empreinte (<StripeDepositForm/>), the reservation POST
// (/api/reservations/public), the availability fetch and the deposit branch are
// BYTE-IDENTICAL — only the markup/CSS around them changed.
//
// Modes (CD toggle « Réserver | Click&Collect »):
//   • Réserver  — the REAL table-reservation flow: real available slots
//                 (GET /api/reservations/availability) + real party-size + real
//                 contact → submit → (deposit | done). The CD's AI hint is INERT.
//   • Click&Collect — there is NO order/pickup backend on THIS page (the real C&C
//                 flow lives in the cart → /api/orders with fulfillmentType:'pickup').
//                 Fabricating an order summary + a code here would invent data, which
//                 the spec forbids → we render an explicit placeholder routing the
//                 guest to the restaurant menu to build a real pickup order.

interface AvailabilityResponse {
  restaurantId: string
  date:         string
  durationMin:  number
  totalTables:  number
  slots:        Array<{ time: string; available: boolean; freeTables: number }>
}

interface CreatedReservation {
  id:            string
  restaurantId:  string
  /** Resolved server-side from the auto-picked free table. */
  tableId?:      string
  tableName:     string
  date:          string
  endTime:       string
  status:        string
  guests:        number
  customerName:  string
  depositAmount: number
}

type Mode = 'reserve' | 'pickup'
type Step = 'form' | 'deposit' | 'done'

const DATE_STRIP_DAYS = 14
const PARTY_OPTIONS = [1, 2, 3, 4, 5, 6] as const // 6 renders « 6+ »

export default function ReservePage() {
  return (
    <Suspense fallback={<ScreenFallback />}>
      <ReserveInner />
    </Suspense>
  )
}

function ScreenFallback() {
  return (
    <div className="gb-reserver">
      <div className="rs-state">
        <span className="ms spin" aria-hidden="true">progress_activity</span>
      </div>
    </div>
  )
}

function ReserveInner() {
  const t = useTranslations('eat.reservation')
  const tSession = useTranslations('session')
  const locale = useLocale()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const restaurantId = params?.id ?? ''

  // ── State ────────────────────────────────────────────────────────────────
  const today = useMemo(() => new Date().toISOString().split('T')[0], [])
  const [mode,     setMode]     = useState<Mode>('reserve')
  const [step,     setStep]     = useState<Step>('form')
  const [date,     setDate]     = useState(today)
  const [guests,   setGuests]   = useState(2)
  const [time,     setTime]     = useState('')
  const [name,     setName]     = useState('')
  const [email,    setEmail]    = useState('')
  const [phone,    setPhone]    = useState('')
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null)
  const [availabilityErr, setAvailabilityErr] = useState('')
  const [loadingSlots,   setLoadingSlots]   = useState(false)
  const [submitting,     setSubmitting]     = useState(false)
  const [submitError,    setSubmitError]    = useState('')
  const [reservation,    setReservation]    = useState<CreatedReservation | null>(null)

  // ── Availability fetch (real slots) — runs whenever the chosen date changes
  // while in the « Réserver » mode and the form step. BYTE-IDENTICAL endpoint. ──
  useEffect(() => {
    if (mode !== 'reserve' || step !== 'form') return
    let cancelled = false
    setLoadingSlots(true)
    setAvailabilityErr('')
    fetch(`/api/reservations/availability?restaurantId=${restaurantId}&date=${date}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => null)
          throw new Error(body?.error || 'load_failed')
        }
        return r.json() as Promise<AvailabilityResponse>
      })
      .then((d) => {
        if (cancelled) return
        setAvailability(d)
        if (d.totalTables === 0) setAvailabilityErr(t('restaurantClosed'))
      })
      .catch(() => { if (!cancelled) setAvailabilityErr(t('errLoadAvailability')) })
      .finally(() => { if (!cancelled) setLoadingSlots(false) })
    return () => { cancelled = true }
  }, [mode, step, date, restaurantId, t])

  // ── Submit (BYTE-IDENTICAL reservation POST + deposit branch) ──────────────
  async function submit() {
    if (submitting) return
    setSubmitting(true)
    setSubmitError('')
    try {
      // The availability endpoint hands back HH:MM in server-local time. We
      // recompose an ISO datetime from the chosen date + the chosen slot.
      const isoStart = new Date(`${date}T${time}:00`).toISOString()
      const r = await fetch('/api/reservations/public', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId,
          date:         isoStart,
          guests,
          customerName: name.trim(),
          email:        email.trim() || undefined,
          phone:        phone.trim() || undefined,
          durationMin:  availability?.durationMin,
        }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok || !data?.reservation?.id) {
        const code = data?.code
        if (code === 'slot_taken')     setSubmitError(t('errSlotTaken'))
        else if (code === 'slot_past') setSubmitError(t('errSlotPast'))
        // Chantier horaires — strict public gate (409). 'hors_horaires' = the
        // slot is outside the weekly ranges (or too close to closing);
        // 'closed' = an exceptional closure covers it. Booking a FUTURE open
        // slot stays possible (T3.Q3) — these only reject THIS slot.
        else if (code === 'hors_horaires') setSubmitError(t('errOutsideHours'))
        else if (code === 'closed')        setSubmitError(t('errClosedSlot'))
        else                           setSubmitError(t('errCreate'))
        return
      }
      const resa: CreatedReservation = data.reservation
      setReservation(resa)
      // Persist a thin "last reservation" pointer so /eat/account can offer a
      // "Payer mon addition" button without scanning the QR. Tolerant: failures
      // (Safari private mode, quota) just degrade the account convenience.
      try {
        if (resa.tableId) {
          localStorage.setItem('grubano_last_reservation', JSON.stringify({
            reservationId: resa.id,
            restaurantId:  resa.restaurantId,
            tableId:       resa.tableId,
            tableName:     resa.tableName,
            date:          resa.date,
            savedAt:       Date.now(),
          }))
        }
      } catch { /* non-fatal */ }
      if (resa.depositAmount > 0) {
        // Surface the deposit step — the inner Stripe form is byte-identical.
        setStep('deposit')
      } else {
        setStep('done')
      }
    } catch {
      setSubmitError(t('errCreate'))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Derived display values (real) ──────────────────────────────────────────
  const longDate = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' })
        .format(new Date(date + 'T12:00:00'))
    } catch { return date }
  }, [date, locale])

  // Real 14-day date strip from today forward (CD « Date » row). Selecting a date
  // maps onto the real `date` state and clears the chosen time (refetch).
  const dateStrip = useMemo(() => {
    const base = new Date(today + 'T12:00:00')
    return Array.from({ length: DATE_STRIP_DAYS }, (_, i) => {
      const d = new Date(base)
      d.setDate(base.getDate() + i)
      const iso = d.toISOString().split('T')[0]
      return {
        iso,
        isToday: i === 0,
        month: new Intl.DateTimeFormat(locale, { month: 'short' }).format(d).replace('.', '').toUpperCase(),
        day:   new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(d),
        wday:  new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d).replace('.', ''),
      }
    })
  }, [today, locale])

  const partyLabel = (n: number) => (n >= 6 ? '6+' : String(n))
  const footSummary = `${longDate} · ${t('partyShort', { count: guests })}${time ? ` · ${time}` : ''}`
  const canConfirm = step === 'form' && mode === 'reserve' && !!time && !!name.trim() && !submitting

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="gb-reserver">
      {/* Header (CD .pg-top) */}
      <div className="pg-top">
        <button type="button" className="back" onClick={() => router.back()} aria-label={t('headerBack')}>
          <span className="ms" aria-hidden="true">arrow_back</span>
        </button>
        <h1>{mode === 'reserve' ? t('headerTitle') : t('ccTitle')}</h1>
      </div>

      {/* CD 2-col grid: restaurant recap (left, sticky) || form card (right) */}
      <div className="grid">
        {/* ── Restaurant recap card ──────────────────────────────────────────
            This page never fetches the restaurant profile, so the recap shows the
            CD chrome with the guest's REAL live selections (date · party · time) in
            « Bon à savoir ». The photo/name/rating/address are DEFERRED (no fetch
            here) — rendered as the CD placeholder, never fabricated facts. */}
        <aside className="rs-rcard">
          <div className="img" />
          <div className="b">
            <h2>{t('summaryTitle')}</h2>
            <div className="div" />
            <div className="know">{t('knowTitle')}</div>
            {mode === 'reserve' ? (
              <>
                <div className="know-row"><span className="ms" aria-hidden="true">event</span><span className="capitalize">{longDate}</span></div>
                <div className="know-row"><span className="ms" aria-hidden="true">schedule</span>{time || '—'}</div>
                <div className="know-row"><span className="ms" aria-hidden="true">group</span>{t('partyShort', { count: guests })}</div>
                <div className="know-row"><span className="ms" aria-hidden="true">payments</span>{t('knowNoPrepay')}</div>
              </>
            ) : (
              <>
                <div className="know-row"><span className="ms" aria-hidden="true">storefront</span>{t('ccKnowCounter')}</div>
                <div className="know-row"><span className="ms" aria-hidden="true">qr_code_2</span>{t('ccKnowCode')}</div>
              </>
            )}
          </div>
        </aside>

        {/* ── Form card ──────────────────────────────────────────────────────── */}
        <section className="rs-fcard">
          {/* Mode toggle (CD .modes) — real React state (not the CD data-screen script) */}
          {step === 'form' && (
            <div className="modes" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'reserve'}
                onClick={() => { setMode('reserve'); setSubmitError('') }}
              >
                <span className="ms" aria-hidden="true">table_restaurant</span>{t('modeReserve')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'pickup'}
                onClick={() => { setMode('pickup'); setSubmitError('') }}
              >
                <span className="ms" aria-hidden="true">storefront</span>{t('modePickup')}
              </button>
            </div>
          )}

          {/* ═══ RÉSERVE — form step ═══ */}
          {step === 'form' && mode === 'reserve' && (
            <>
              {/* Date strip (real dates) */}
              <p className="lab">{t('stepDate')}</p>
              <div className="dates" role="listbox" aria-label={t('stepDate')}>
                {dateStrip.map((d) => {
                  const sel = date === d.iso
                  return (
                    <div
                      key={d.iso}
                      role="option"
                      aria-selected={sel}
                      tabIndex={0}
                      className={`date${sel ? ' sel' : ''}`}
                      onClick={() => { setDate(d.iso); setTime('') }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDate(d.iso); setTime('') } }}
                    >
                      <small>{d.isToday ? t('today') : d.month}</small>
                      <b>{d.day}</b>
                      <span className="d3">{d.wday}</span>
                    </div>
                  )
                })}
              </div>

              {/* Time slots (real availability) */}
              <p className="lab">{t('stepSlot')}</p>
              {availability && !availabilityErr && !loadingSlots && (
                <p className="rs-caption">
                  {t('slotsCaption', { guests, minutes: availability.durationMin })}
                </p>
              )}
              {availabilityErr ? (
                <div className="rs-state err">
                  <span className="ms" aria-hidden="true">error</span>
                  <span>{availabilityErr}</span>
                </div>
              ) : loadingSlots ? (
                <div className="rs-state">
                  <span className="ms spin" aria-hidden="true">progress_activity</span>
                  <span>{t('slotsLoading')}</span>
                </div>
              ) : availability && availability.slots.length > 0 ? (
                <div className="times">
                  {availability.slots.map((s) => {
                    const active = time === s.time
                    return (
                      <button
                        key={s.time}
                        type="button"
                        disabled={!s.available}
                        onClick={() => { if (s.available) setTime(s.time) }}
                        className={`time${active ? ' sel' : ''}${!s.available ? ' off' : ''}`}
                      >
                        {s.time}
                        {s.available && (
                          <span className="free">{t('slotFree', { count: s.freeTables })}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="rs-state">
                  <span className="ms" aria-hidden="true">event_busy</span>
                  <span>{t('slotsEmpty')}</span>
                </div>
              )}

              {/* Party size (real guests) */}
              <p className="lab">{t('partyLabel')}</p>
              <div className="party" role="listbox" aria-label={t('partyLabel')}>
                {PARTY_OPTIONS.map((n) => {
                  const sel = guests === n
                  return (
                    <span
                      key={n}
                      role="option"
                      aria-selected={sel}
                      tabIndex={0}
                      className={sel ? 'sel' : undefined}
                      onClick={() => setGuests(n)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setGuests(n) } }}
                    >
                      {partyLabel(n)}
                    </span>
                  )
                })}
              </div>

              {/* Contact details (real) */}
              <div className="rs-fields">
                <div className="rs-field">
                  <label htmlFor="rs-name">{t('fieldName')}</label>
                  <input
                    id="rs-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('fieldNamePh')}
                    maxLength={100}
                  />
                </div>
                <div className="rs-field">
                  <label htmlFor="rs-email">{t('fieldEmail')}</label>
                  <input
                    id="rs-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('fieldEmailPh')}
                  />
                </div>
                <div className="rs-field">
                  <label htmlFor="rs-phone">{t('fieldPhone')}</label>
                  <input
                    id="rs-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder={t('fieldPhonePh')}
                  />
                </div>
              </div>

              {/* INERT AI hint (CD .ai, « bientôt ») */}
              <div className="rs-ai">
                <span className="ms" aria-hidden="true">auto_awesome</span>
                <p>{t('aiHint')}</p>
                <span className="soon">{t('aiSoon')}</span>
              </div>

              {submitError && (
                <div className="rs-state err" style={{ marginTop: 14, marginBottom: 0 }}>
                  <span className="ms" aria-hidden="true">error</span>
                  <span>{submitError}</span>
                </div>
              )}
            </>
          )}

          {/* ═══ CLICK&COLLECT — form step (no order backend on this page) ═══
              The real pickup flow is the cart → /api/orders (fulfillmentType:'pickup').
              We DO NOT fabricate an order summary nor a pickup code here. Explicit
              CD-skinned placeholder routing the guest to the menu to build a real order. */}
          {step === 'form' && mode === 'pickup' && (
            <>
              <div className="rs-cc-empty">
                <span className="ms" aria-hidden="true">shopping_bag</span>
                <h3>{t('ccEmptyTitle')}</h3>
                <p>{t('ccEmptyBody')}</p>
                <Link href={`/eat/r/${restaurantId}`}>
                  <span className="ms" aria-hidden="true">restaurant_menu</span>{t('ccEmptyCta')}
                </Link>
              </div>
              <div className="rs-ai">
                <span className="ms" aria-hidden="true">eco</span>
                <p>{t('ccInfo')}</p>
              </div>
            </>
          )}

          {/* ═══ DEPOSIT — Stripe empreinte (container re-skin only) ═══ */}
          {step === 'deposit' && reservation && (
            <div className="rs-deposit">
              <h3><span className="ms" aria-hidden="true">credit_card</span>{t('stepDeposit')}</h3>
              <StripeDepositForm
                reservationId={reservation.id}
                onAuthorized={() => setStep('done')}
              />
            </div>
          )}

          {/* ═══ DONE — success panel ═══ */}
          {step === 'done' && reservation && (
            <div className="rs-done">
              <span className="ok"><span className="ms" aria-hidden="true">check</span></span>
              <h2>{t('okTitle')}</h2>
              <p>{t('okBody', { date: longDate, time, guests })}</p>
              {/* Brique A — the session code (same code the operator sees). */}
              <div className="session">
                <small>{tSession('yourSessionNo')}</small>
                <SessionBadge reservationId={reservation.id} variant="large" />
              </div>
              <button
                type="button"
                className="rs-cta"
                onClick={() => router.push(`/eat/r/${restaurantId}`)}
              >
                <span className="ms" aria-hidden="true">arrow_back</span>{t('okBack')}
              </button>
            </div>
          )}
        </section>
      </div>

      {/* ── Sticky CTA footer (CD .foot) — only on the « Réserver » form step ──
          Réserve confirm calls the BYTE-IDENTICAL submit(). C&C has no order here,
          so no « Commander » CTA (the real order is placed from the cart). */}
      {step === 'form' && mode === 'reserve' && (
        <div className="rs-foot">
          <div className="rs-foot__in">
            <div className="rs-foot__sum">{footSummary}</div>
            <button
              type="button"
              className="rs-cta"
              onClick={submit}
              disabled={!canConfirm}
            >
              {submitting
                ? <span className="ms spin" aria-hidden="true">progress_activity</span>
                : <span className="ms" aria-hidden="true">check</span>}
              {t('submitBook')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
