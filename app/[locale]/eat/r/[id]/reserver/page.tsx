'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import {
  ArrowLeft, Calendar, Clock, Users, Loader2, Check, AlertCircle, CreditCard,
} from 'lucide-react'

// ── /eat/r/[id]/reserver ──────────────────────────────────────────────────────
//
// Payment-V1 consumer reservation flow (Agent 13). 4 steps in a single scrolly
// page on the existing /eat shell (already public via the middleware matcher):
//   1) date picker
//   2) slot picker (GET /api/reservations/availability)
//   3) guests + contact details
//   4) optional Stripe Elements card hold (when restaurant has depositAmount>0)
//
// Step 4's actual Stripe wiring lands in sub-commit 2 — this sub-commit ships
// the orchestration scaffold + the "no deposit → done" branch so the end-to-end
// flow already books a table successfully.

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
  tableName:     string
  date:          string
  endTime:       string
  status:        string
  guests:        number
  customerName:  string
  depositAmount: number
}

type Step = 'date' | 'slot' | 'details' | 'deposit' | 'done'

export default function ReservePage() {
  return (
    <Suspense fallback={<ScreenFallback />}>
      <ReserveInner />
    </Suspense>
  )
}

function ScreenFallback() {
  return (
    <div className="mx-auto flex max-w-md items-center justify-center px-5 py-20 text-muted-foreground">
      <Loader2 size={16} className="me-2 animate-spin" />
    </div>
  )
}

function ReserveInner() {
  const t = useTranslations('eat.reservation')
  const locale = useLocale()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const restaurantId = params?.id ?? ''

  // ── State ────────────────────────────────────────────────────────────────
  const today = useMemo(() => new Date().toISOString().split('T')[0], [])
  const [step,     setStep]     = useState<Step>('date')
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

  // ── Availability fetch ───────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'slot') return
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
  }, [step, date, restaurantId, t])

  // ── Submit ───────────────────────────────────────────────────────────────
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
        else                           setSubmitError(t('errCreate'))
        return
      }
      const resa: CreatedReservation = data.reservation
      setReservation(resa)
      if (resa.depositAmount > 0) {
        // Stripe Elements wiring arrives in sub-commit 2. For now we still
        // surface the deposit step, but its inner form will land then.
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

  // ── Render ───────────────────────────────────────────────────────────────
  const currencyFmt = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }),
    [locale],
  )
  const longDate = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' })
        .format(new Date(date + 'T12:00:00'))
    } catch { return date }
  }, [date, locale])

  return (
    <div className="mx-auto min-h-screen max-w-md bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <button
          onClick={() => router.back()}
          aria-label={t('headerBack')}
          className="grid h-9 w-9 place-items-center rounded-xl bg-muted"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-base font-bold">{t('headerTitle')}</h1>
      </header>

      {/* Step 1 — Date */}
      {(step === 'date' || step === 'slot' || step === 'details') && (
        <section className="px-4 pt-4">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Calendar size={12} className="text-primary" /> {t('stepDate')}
          </p>
          <input
            type="date"
            min={today}
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              setTime('')
              if (step !== 'date') setStep('slot')
            }}
            className="w-full rounded-xl border border-border bg-card px-3 py-3 text-sm focus:border-primary focus:outline-none"
          />
          {step === 'date' && (
            <button
              type="button"
              onClick={() => setStep('slot')}
              className="mt-3 w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground"
            >
              {t('submitBook')} →
            </button>
          )}
        </section>
      )}

      {/* Step 2 — Slot */}
      {(step === 'slot' || step === 'details') && (
        <section className="mt-4 px-4">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Clock size={12} className="text-primary" /> {t('stepSlot')}
          </p>
          {availability && (
            <p className="mb-2 text-[11px] text-muted-foreground">
              {t('slotsCaption', { guests, minutes: availability.durationMin })}
            </p>
          )}
          {availabilityErr ? (
            <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>{availabilityErr}</span>
            </p>
          ) : loadingSlots ? (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-4 text-[12px] text-muted-foreground">
              <Loader2 size={13} className="animate-spin" /> {t('slotsLoading')}
            </div>
          ) : availability && availability.slots.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {availability.slots.map((s) => {
                const active = time === s.time
                return (
                  <button
                    key={s.time}
                    type="button"
                    onClick={() => {
                      if (!s.available) return
                      setTime(s.time)
                      setStep('details')
                    }}
                    disabled={!s.available}
                    className={`flex flex-col items-center rounded-xl border px-2 py-2 text-[11px] font-bold transition ${
                      active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : s.available
                          ? 'border-border bg-card text-foreground hover:border-primary'
                          : 'border-border bg-muted text-muted-foreground/60 line-through'
                    }`}
                  >
                    <span className="text-sm">{s.time}</span>
                    {s.available && (
                      <span className="mt-0.5 text-[9px] font-medium opacity-80">
                        {t('slotFree', { count: s.freeTables })}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="rounded-xl border border-border bg-card px-3 py-4 text-center text-[12px] text-muted-foreground">
              {t('slotsEmpty')}
            </p>
          )}
        </section>
      )}

      {/* Step 3 — Details */}
      {step === 'details' && (
        <section className="mt-4 px-4">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Users size={12} className="text-primary" /> {t('stepDetails')}
          </p>
          <div className="space-y-2">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t('guestsLabel')}
              </label>
              <input
                type="number"
                min={1}
                max={30}
                value={guests}
                onChange={(e) => setGuests(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
              />
              <p className="mt-0.5 text-[10px] text-muted-foreground">{t('guestsHint')}</p>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t('fieldName')}
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('fieldNamePh')}
                maxLength={100}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t('fieldEmail')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('fieldEmailPh')}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t('fieldPhone')}
              </label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t('fieldPhonePh')}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          {submitError && (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </p>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={submitting || !name.trim() || !time}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            {t('submitBook')}
          </button>
        </section>
      )}

      {/* Step 4 — Deposit placeholder (Stripe Elements lands in sub-commit 2) */}
      {step === 'deposit' && reservation && (
        <section className="mt-4 px-4">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <CreditCard size={12} className="text-primary" /> {t('stepDeposit')}
          </p>
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-bold text-foreground">{t('depositTitle')}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {t('depositIntro', { amount: currencyFmt.format(reservation.depositAmount) })}
            </p>
            <p className="mt-2 text-[10px] text-muted-foreground">{t('depositHint')}</p>
            {/* Stripe Elements wiring lands in sub-commit 2 (this card will
                embed <StripeDepositForm reservationId={...} /> there). For
                now we accept the reservation as-is so the dashboard flow
                can already be exercised end-to-end. */}
            <button
              type="button"
              onClick={() => setStep('done')}
              className="mt-3 w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground"
            >
              {t('depositSubmit')}
            </button>
          </div>
        </section>
      )}

      {/* Done */}
      {step === 'done' && reservation && (
        <section className="mt-4 px-4">
          <div className="rounded-2xl border border-success/40 bg-success/5 p-4 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success text-white">
              <Check size={20} />
            </span>
            <p className="mt-3 text-base font-bold text-foreground">{t('okTitle')}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {t('okBody', {
                date:   longDate,
                time:   time,
                guests: guests,
              })}
            </p>
            <button
              type="button"
              onClick={() => router.push(`/eat/r/${restaurantId}`)}
              className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground"
            >
              {t('okBack')}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
