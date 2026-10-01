'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import {
  Clock, Plus, X, Copy, Check, Loader2, AlertCircle, CalendarOff, Trash2,
  AlertTriangle,
} from 'lucide-react'
import SessionBadge from '@/components/session/SessionBadge'

// ── <OpeningHoursSection /> — Chantier horaires étape 2, blocs A + B ──────────
//
// Owner UI over Agent 2's endpoints (consumed as-is, never modified):
//   GET/PUT  /api/restaurants/[id]/hours              — atomic weekly set
//   GET/POST /api/restaurants/[id]/closures           — exceptional closures
//   DELETE   /api/restaurants/[id]/closures/[closureId]
//
// Weekly grid: 7 days displayed Monday→Sunday (dayOfWeek stays the JS getDay
// convention 0=dimanche). Each day holds 0..n ranges {open, close}; zero range
// = closed that day. Overnight ranges (close < open, e.g. 19:00→01:00) are
// valid and labelled "(lendemain)"; "24:00" is accepted as a close. Edits are
// local until « Enregistrer » does ONE atomic PUT (full replacement) — server
// validation errors (intra-day overlap…) are surfaced as-is.
//
// Conflict flow (T3.Q1 + fix 6a6e6a3): POST closure WITHOUT confirm → when the
// server answers {created:false, conflicts:{…}, ongoing:{…}} we open the recap
// modal. conflicts = CANCELLABLE future 'confirmed' reservations (« X seront
// annulées » counts ONLY these); ongoing = 'arrived' sessions IN PROGRESS —
// purely informative, NEVER cancelled (even with confirm:true), the guests
// finish normally (ordering/paying stay available). The operator confirms →
// re-POST the same body with confirm:true → recap toast (cancelled / released
// / surfaced errors). Nothing to show → direct creation.

type Range = { open: string; close: string }
type WeekState = Record<number, Range[]> // dayOfWeek (0..6) → ranges

type Closure = {
  id:        string
  type:      string
  dateStart: string
  dateEnd:   string
  startTime: string | null
  endTime:   string | null
  reason:    string | null
}

type ConflictReservation = {
  id:            string
  customerName:  string
  date:          string
  status:        string
  depositStatus: string | null
}

// Display order Monday→Sunday over the JS getDay convention.
const DAYS_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10))
  return h * 60 + m
}

/** Tolerant "HH:mm" normalisation: "9" → "09:00", "19h30" → "19:30",
 *  "24" → "24:00". Returns null when it can't make sense of the input. */
function normalizeTime(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace('h', ':').replace(';', ':')
  if (!s) return null
  const m = s.match(/^(\d{1,2})(?::(\d{1,2}))?$/)
  if (!m) return null
  const h = parseInt(m[1], 10)
  const min = m[2] ? parseInt(m[2], 10) : 0
  if (h === 24 && min === 0) return '24:00'
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

const emptyWeek = (): WeekState => ({ 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] })

export default function OpeningHoursSection({ restaurantId }: { restaurantId: string }) {
  const t = useTranslations('hours')
  const locale = useLocale()

  // ── Weekly grid state ───────────────────────────────────────────────────────
  const [week,      setWeek]      = useState<WeekState>(emptyWeek())
  const [configured, setConfigured] = useState(false)
  const [loading,   setLoading]   = useState(true)
  const [loadError, setLoadError] = useState('')
  const [dirty,     setDirty]     = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [saveError, setSaveError] = useState('')
  const [savedAt,   setSavedAt]   = useState<number | null>(null)
  const [copiedNote, setCopiedNote] = useState(false)

  // ── Closures state ──────────────────────────────────────────────────────────
  const [closures,        setClosures]        = useState<Closure[]>([])
  const [closuresError,   setClosuresError]   = useState('')
  const [closureFormOpen, setClosureFormOpen] = useState(false)
  const today = useMemo(() => new Date().toISOString().split('T')[0], [])
  const [cForm, setCForm] = useState({ dateStart: today, dateEnd: today, partial: false, startTime: '12:00', endTime: '14:00', reason: '' })
  const [cSaving,  setCSaving]  = useState(false)
  const [cError,   setCError]   = useState('')
  const [cToast,   setCToast]   = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── Conflict modal (bloc B) ─────────────────────────────────────────────────
  // cancellable = conflicts{} (future 'confirmed'); ongoing = 'arrived'
  // sessions in progress, informative only.
  const [conflicts, setConflicts] = useState<{
    count: number
    reservations: ConflictReservation[]
    ongoing: { count: number; reservations: ConflictReservation[] }
  } | null>(null)
  const [confirming, setConfirming] = useState(false)

  const loadHours = useCallback(async () => {
    setLoadError('')
    try {
      const r = await fetch(`/api/restaurants/${restaurantId}/hours`, { cache: 'no-store' })
      if (!r.ok) throw new Error('load_failed')
      const d = await r.json() as { hours: Array<{ dayOfWeek: number; openTime: string; closeTime: string }>; configured: boolean }
      const next = emptyWeek()
      for (const h of d.hours ?? []) {
        if (next[h.dayOfWeek]) next[h.dayOfWeek].push({ open: h.openTime, close: h.closeTime })
      }
      setWeek(next)
      setConfigured(Boolean(d.configured))
      setDirty(false)
    } catch {
      setLoadError(t('errLoad'))
    } finally {
      setLoading(false)
    }
  }, [restaurantId, t])

  const loadClosures = useCallback(async () => {
    setClosuresError('')
    try {
      const r = await fetch(`/api/restaurants/${restaurantId}/closures`, { cache: 'no-store' })
      if (!r.ok) throw new Error('load_failed')
      const d = await r.json() as { closures: Closure[] }
      setClosures(d.closures ?? [])
    } catch {
      setClosuresError(t('errClosureLoad'))
    }
  }, [restaurantId, t])

  useEffect(() => { loadHours(); loadClosures() }, [loadHours, loadClosures])

  // Auto-clear the saved pill / copied note.
  useEffect(() => {
    if (!savedAt) return
    const id = setTimeout(() => setSavedAt(null), 2500)
    return () => clearTimeout(id)
  }, [savedAt])
  useEffect(() => {
    if (!copiedNote) return
    const id = setTimeout(() => setCopiedNote(false), 3500)
    return () => clearTimeout(id)
  }, [copiedNote])
  useEffect(() => {
    if (!cToast) return
    const id = setTimeout(() => setCToast(''), 6000)
    return () => clearTimeout(id)
  }, [cToast])

  // ── Grid edits (local until save) ───────────────────────────────────────────
  function mutate(fn: (w: WeekState) => WeekState) {
    setWeek((prev) => fn(structuredClone(prev)))
    setDirty(true)
    setSaveError('')
  }

  function addRange(day: number) {
    mutate((w) => { w[day].push({ open: '19:00', close: '22:00' }); return w })
  }
  function removeRange(day: number, idx: number) {
    mutate((w) => { w[day].splice(idx, 1); return w })
  }
  function setTime(day: number, idx: number, field: 'open' | 'close', value: string) {
    mutate((w) => { w[day][idx][field] = value; return w })
  }
  function clearDay(day: number) {
    mutate((w) => { w[day] = []; return w })
  }
  function applyToAll(day: number) {
    mutate((w) => {
      const src = w[day].map((r) => ({ ...r }))
      for (let d = 0; d < 7; d++) w[d] = src.map((r) => ({ ...r }))
      return w
    })
    setCopiedNote(true)
  }

  // ── Atomic save (PUT full set) ──────────────────────────────────────────────
  async function save() {
    if (saving) return
    setSaveError('')
    // Client-side normalisation BEFORE the round-trip — the server stays the
    // authority (overlaps, coherence) and its messages are shown as-is.
    const payload: Array<{ dayOfWeek: number; openTime: string; closeTime: string }> = []
    const normalized = emptyWeek()
    for (let d = 0; d < 7; d++) {
      for (const r of week[d]) {
        const open = normalizeTime(r.open)
        const close = normalizeTime(r.close)
        if (!open || !close || open === '24:00') { setSaveError(t('errInvalidTime')); return }
        normalized[d].push({ open, close })
        payload.push({ dayOfWeek: d, openTime: open, closeTime: close })
      }
    }
    setSaving(true)
    try {
      const r = await fetch(`/api/restaurants/${restaurantId}/hours`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ hours: payload }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        setSaveError((d?.error as string) || t('errSave'))
        return
      }
      setWeek(normalized)
      setConfigured(Boolean(d?.configured))
      setDirty(false)
      setSavedAt(Date.now())
    } catch {
      setSaveError(t('errSave'))
    } finally {
      setSaving(false)
    }
  }

  // ── Closure creation — preview → conflicts modal → confirm (bloc B) ────────
  function closureBody(confirm: boolean) {
    return {
      dateStart: cForm.dateStart,
      dateEnd:   cForm.dateEnd,
      ...(cForm.partial ? { startTime: normalizeTime(cForm.startTime) ?? cForm.startTime, endTime: normalizeTime(cForm.endTime) ?? cForm.endTime } : {}),
      ...(cForm.reason.trim() ? { reason: cForm.reason.trim().slice(0, 140) } : {}),
      ...(confirm ? { confirm: true } : {}),
    }
  }

  async function submitClosure(confirm: boolean) {
    if (cSaving || confirming) return
    setCError('')
    if (confirm) setConfirming(true); else setCSaving(true)
    try {
      const r = await fetch(`/api/restaurants/${restaurantId}/closures`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(closureBody(confirm)),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        const msg = (d?.error as string) || t('errClosureSave')
        if (confirm) { setConflicts(null); setCError(msg) } else setCError(msg)
        return
      }
      // Preview branch: cancellable conflicts AND/OR ongoing sessions exist,
      // nothing created → recap modal (the server previews as soon as there is
      // anything to show — fix 6a6e6a3).
      if (d?.created === false) {
        setConflicts({
          count:        Number(d?.conflicts?.count) || 0,
          reservations: Array.isArray(d?.conflicts?.reservations) ? d.conflicts.reservations : [],
          ongoing: {
            count:        Number(d?.ongoing?.count) || 0,
            reservations: Array.isArray(d?.ongoing?.reservations) ? d.ongoing.reservations : [],
          },
        })
        return
      }
      // Created (directly, or after confirm) → recap toast + refresh.
      setConflicts(null)
      setClosureFormOpen(false)
      setCForm({ dateStart: today, dateEnd: today, partial: false, startTime: '12:00', endTime: '14:00', reason: '' })
      const cancelled = Number(d?.cancelled) || 0
      const released  = Number(d?.depositsReleased) || 0
      let toast = cancelled > 0
        ? t('conflictDone', { cancelled, released })
        : t('closureCreated')
      const errCount = Array.isArray(d?.errors) ? d.errors.length : 0
      if (errCount > 0) toast += ` — ${t('conflictErrors', { count: errCount })}`
      setCToast(toast)
      loadClosures()
    } catch {
      setCError(t('errClosureSave'))
    } finally {
      setCSaving(false)
      setConfirming(false)
    }
  }

  async function deleteClosure(id: string) {
    if (deletingId) return
    setDeletingId(id)
    setClosuresError('')
    try {
      const r = await fetch(`/api/restaurants/${restaurantId}/closures/${id}`, { method: 'DELETE' })
      if (!r.ok) { setClosuresError(t('errClosureDelete')); return }
      setCToast(t('closureDeleted'))
      loadClosures()
    } catch {
      setClosuresError(t('errClosureDelete'))
    } finally {
      setDeletingId(null)
    }
  }

  // ── Formatting helpers ──────────────────────────────────────────────────────
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }),
    [locale],
  )
  const dayLabel = (d: number) => t(`day${d}` as 'day0')
  const isOvernight = (r: Range) => {
    const o = normalizeTime(r.open), c = normalizeTime(r.close)
    return o !== null && c !== null && c !== '24:00' && toMin(c) < toMin(o)
  }
  const closureDates = (c: Closure) => {
    const s = dateFmt.format(new Date(c.dateStart))
    const e = dateFmt.format(new Date(c.dateEnd))
    return s === e ? s : `${s} → ${e}`
  }
  const resaDateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    [locale],
  )

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <section id="horaires" className="scroll-mt-16">
      {/* ── Weekly grid ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-primary" />
          <h2 className="text-sm font-bold text-foreground">{t('sectionTitle')}</h2>
          {saving && <Loader2 size={11} className="ms-auto animate-spin text-muted-foreground" />}
          {!saving && savedAt && (
            <span className="ms-auto inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-success">
              <Check size={9} /> {t('saved')}
            </span>
          )}
          {!saving && !savedAt && dirty && (
            <span className="ms-auto inline-flex items-center rounded-full bg-warning/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-warning">
              {t('unsaved')}
            </span>
          )}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{t('sectionIntro')}</p>

        {/* Empty/never-configured guidance — never a blank screen (T1.Q3). */}
        {!loading && !configured && !dirty && (
          <p className="mt-3 rounded-xl border border-primary/30 bg-accent px-3 py-2 text-[11px] text-foreground">
            {t('notConfigured')}
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
          </div>
        ) : loadError ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{loadError}</span>
          </p>
        ) : (
          <div className="mt-3 divide-y divide-border">
            {DAYS_ORDER.map((day) => {
              const ranges = week[day]
              const closed = ranges.length === 0
              return (
                <div key={day} className="py-2.5">
                  <div className="flex items-center gap-2">
                    <p className="w-24 shrink-0 text-[12px] font-bold text-foreground">{dayLabel(day)}</p>
                    {closed && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {t('dayClosed')}
                      </span>
                    )}
                    <div className="ms-auto flex items-center gap-1">
                      {/* Apply this day everywhere (also copies a closed day). */}
                      <button
                        type="button"
                        onClick={() => applyToAll(day)}
                        title={t('applyToAll')}
                        aria-label={t('applyToAll')}
                        className="grid h-7 w-7 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                      >
                        <Copy size={12} />
                      </button>
                      {!closed && (
                        <button
                          type="button"
                          onClick={() => clearDay(day)}
                          title={t('dayClosed')}
                          aria-label={t('dayClosed')}
                          className="grid h-7 w-7 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
                        >
                          <X size={12} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => addRange(day)}
                        title={t('addRange')}
                        aria-label={t('addRange')}
                        className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-foreground"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  </div>

                  {!closed && (
                    <div className="mt-2 space-y-1.5">
                      {ranges.map((r, idx) => (
                        <div key={idx} className="flex flex-wrap items-center gap-1.5">
                          <input
                            value={r.open}
                            onChange={(e) => setTime(day, idx, 'open', e.target.value)}
                            onBlur={(e) => { const n = normalizeTime(e.target.value); if (n && n !== '24:00') setTime(day, idx, 'open', n) }}
                            inputMode="numeric"
                            placeholder="19:00"
                            aria-label={t('openLabel')}
                            className="w-[4.5rem] rounded-lg border border-border bg-background px-2 py-1.5 text-center text-[12px] font-semibold focus:border-primary focus:outline-none"
                          />
                          <span className="text-[11px] text-muted-foreground">–</span>
                          <input
                            value={r.close}
                            onChange={(e) => setTime(day, idx, 'close', e.target.value)}
                            onBlur={(e) => { const n = normalizeTime(e.target.value); if (n) setTime(day, idx, 'close', n) }}
                            inputMode="numeric"
                            placeholder="22:00"
                            aria-label={t('closeLabel')}
                            className="w-[4.5rem] rounded-lg border border-border bg-background px-2 py-1.5 text-center text-[12px] font-semibold focus:border-primary focus:outline-none"
                          />
                          {/* Overnight range = explicit "(lendemain)" so 19:00–01:00 reads clearly. */}
                          {isOvernight(r) && (
                            <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                              {t('nextDay')}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeRange(day, idx)}
                            title={t('removeRange')}
                            aria-label={t('removeRange')}
                            className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:text-destructive"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!loading && !loadError && (
          <>
            <p className="mt-2 text-[10px] text-muted-foreground">{t('timeHint')}</p>
            {copiedNote && (
              <p className="mt-2 rounded-lg bg-accent px-2 py-1 text-[10px] font-semibold text-primary">
                {t('applyToAllDone')}
              </p>
            )}
            {saveError && (
              <p className="mt-2 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>{saveError}</span>
              </p>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : null}
              {saving ? t('saving') : t('save')}
            </button>
          </>
        )}
      </div>

      {/* ── Exceptional closures ────────────────────────────────────────────── */}
      <div className="mt-4 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <CalendarOff size={14} className="text-primary" />
          <h2 className="text-sm font-bold text-foreground">{t('closuresTitle')}</h2>
          {!closureFormOpen && (
            <button
              type="button"
              onClick={() => { setCError(''); setClosureFormOpen(true) }}
              className="ms-auto inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-bold text-primary-foreground"
            >
              <Plus size={11} /> {t('closureAdd')}
            </button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{t('closuresIntro')}</p>

        {cToast && (
          <p className="mt-3 rounded-xl border border-success/40 bg-success/5 px-3 py-2 text-[12px] font-semibold text-success">
            {cToast}
          </p>
        )}
        {closuresError && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{closuresError}</span>
          </p>
        )}

        {/* Add form */}
        {closureFormOpen && (
          <div className="mt-3 rounded-xl border border-border bg-background p-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t('closureDateStart')}</label>
                <input
                  type="date"
                  value={cForm.dateStart}
                  onChange={(e) => setCForm((f) => ({ ...f, dateStart: e.target.value, dateEnd: f.dateEnd < e.target.value ? e.target.value : f.dateEnd }))}
                  className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[12px] focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t('closureDateEnd')}</label>
                <input
                  type="date"
                  min={cForm.dateStart}
                  value={cForm.dateEnd}
                  onChange={(e) => setCForm((f) => ({ ...f, dateEnd: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[12px] focus:border-primary focus:outline-none"
                />
              </div>
            </div>

            <label className="mt-2.5 flex items-center gap-2 text-[12px] font-semibold text-foreground">
              <input
                type="checkbox"
                checked={cForm.partial}
                onChange={(e) => setCForm((f) => ({ ...f, partial: e.target.checked }))}
                className="h-3.5 w-3.5 accent-[var(--primary,#F97316)]"
              />
              {t('closurePartial')}
            </label>
            {cForm.partial && (
              <div className="mt-2 flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">{t('closureTimeFrom')}</span>
                <input
                  value={cForm.startTime}
                  onChange={(e) => setCForm((f) => ({ ...f, startTime: e.target.value }))}
                  inputMode="numeric"
                  placeholder="12:00"
                  className="w-[4.5rem] rounded-lg border border-border bg-card px-2 py-1.5 text-center text-[12px] font-semibold focus:border-primary focus:outline-none"
                />
                <span className="text-[11px] text-muted-foreground">{t('closureTimeTo')}</span>
                <input
                  value={cForm.endTime}
                  onChange={(e) => setCForm((f) => ({ ...f, endTime: e.target.value }))}
                  inputMode="numeric"
                  placeholder="14:00"
                  className="w-[4.5rem] rounded-lg border border-border bg-card px-2 py-1.5 text-center text-[12px] font-semibold focus:border-primary focus:outline-none"
                />
              </div>
            )}

            <div className="mt-2.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t('closureReason')}</label>
              <input
                value={cForm.reason}
                onChange={(e) => setCForm((f) => ({ ...f, reason: e.target.value }))}
                maxLength={140}
                placeholder={t('closureReasonPh')}
                className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[12px] focus:border-primary focus:outline-none"
              />
            </div>

            {cError && (
              <p className="mt-2 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>{cError}</span>
              </p>
            )}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => { setClosureFormOpen(false); setCError('') }}
                disabled={cSaving}
                className="flex-1 rounded-xl border border-border py-2 text-[12px] font-semibold disabled:opacity-60"
              >
                {t('conflictCancel')}
              </button>
              <button
                type="button"
                onClick={() => submitClosure(false)}
                disabled={cSaving}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-2 text-[12px] font-bold text-primary-foreground disabled:opacity-60"
              >
                {cSaving ? <Loader2 size={12} className="animate-spin" /> : null}
                {cSaving ? t('closureCreating') : t('closureCreate')}
              </button>
            </div>
          </div>
        )}

        {/* List */}
        {closures.length === 0 && !closureFormOpen ? (
          <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">
            {t('closuresEmpty')}
          </p>
        ) : closures.length > 0 ? (
          <ul className="mt-3 space-y-1.5">
            {closures.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-bold text-foreground">{closureDates(c)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {c.startTime && c.endTime ? `${c.startTime} – ${c.endTime}` : t('closureWholeDay')}
                    {c.reason ? ` · ${c.reason}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => deleteClosure(c.id)}
                  disabled={deletingId === c.id}
                  title={t('closureDelete')}
                  aria-label={t('closureDelete')}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50"
                >
                  {deletingId === c.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* ── Conflicts modal (bloc B) ────────────────────────────────────────── */}
      {conflicts && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
          <div className="flex max-h-[88vh] w-full max-w-md flex-col rounded-t-3xl bg-background p-5 sm:rounded-2xl">
            <div className="mb-3 flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-warning/15 text-warning">
                <AlertTriangle size={15} />
              </span>
              <p className="text-base font-bold">{t('conflictTitle')}</p>
            </div>

            {/* « X seront annulées » counts ONLY the cancellable conflicts —
                never the ongoing sessions. */}
            {conflicts.count > 0 && (
              <p className="text-[13px] text-muted-foreground">
                {t('conflictBody', { count: conflicts.count })}
              </p>
            )}

            {/* Sessions EN COURS — informative, calm, no action: they are
                never cancelled, the guests finish (order + pay) normally. */}
            {conflicts.ongoing.count > 0 && (
              <p className="mt-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
                {t('ongoingInfo', { count: conflicts.ongoing.count })}
              </p>
            )}

            <ul className="mt-3 flex-1 space-y-1.5 overflow-y-auto">
              {conflicts.reservations.map((r) => (
                <li key={r.id} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SessionBadge reservationId={r.id} />
                      <p className="truncate text-[12px] font-bold text-foreground">{r.customerName}</p>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {resaDateFmt.format(new Date(r.date))}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                      r.depositStatus === 'authorized'
                        ? 'bg-warning/15 text-warning'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {r.depositStatus === 'authorized' ? t('conflictDepositHeld') : t('conflictDepositNone')}
                  </span>
                </li>
              ))}
            </ul>

            {cError && (
              <p className="mt-2 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>{cError}</span>
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConflicts(null)}
                disabled={confirming}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm disabled:opacity-60"
              >
                {t('conflictCancel')}
              </button>
              <button
                type="button"
                onClick={() => submitClosure(true)}
                disabled={confirming}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold disabled:opacity-60 ${
                  conflicts.count > 0
                    ? 'bg-destructive text-destructive-foreground'
                    : 'bg-primary text-primary-foreground'
                }`}
              >
                {confirming ? <Loader2 size={13} className="animate-spin" /> : null}
                {confirming ? t('conflictConfirming') : t('conflictConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
