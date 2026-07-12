'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { CalendarDays, ArrowLeft, Loader2, Check, Plus, Trash2, CalendarOff, Briefcase } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button, Input, Badge, type BadgeTone } from '@/components/design-system'
import RoleSwitcher from '@/components/RoleSwitcher'
import { WEEKDAYS } from '@/lib/availability'

// ── /prestataire/calendar — « Mon calendrier » (P4, Agent 77) ─────────────────
// SIMPLE + DECLARATIVE. Two read+light-write sections:
//   1) « Mes disponibilités » — declare the worked weekdays + a free-text note + leave
//      periods (via /api/prestataire/availability, owner-scoped). NO bookable slots.
//   2) « Missions planifiées » — a READ-ONLY agenda of the prestataire's accepted/done
//      missions that carry a scheduledDate (P3). This view never writes scheduledDate.
// NO money. Rendered by the SERVER page.tsx, which 404s when the flag is OFF.

interface Period { id: string; startDate: string; endDate: string; reason: string | null }
interface Mission {
  id: string; status: string; scheduledDate: string | null
  restaurantOperator: { id: string; name: string } | null
  serviceOffering: { id: string; title: string; category: string } | null
}

const STATUS_TONE: Record<string, BadgeTone> = { accepted: 'success', done: 'success' }

export default function CalendarClient() {
  const t  = useTranslations('prestataire')           // weekday short labels (wdMon…)
  const tc = useTranslations('prestataire.calendar')  // page copy
  const tm = useTranslations('prestataire.missions')  // mission status labels (reused, read-only)
  const locale = useLocale()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  // availability
  const [weekdays, setWeekdays] = useState<string[]>([])
  const [note, setNote]         = useState('')
  const [savingAvail, setSavingAvail] = useState(false)
  const [savedOk, setSavedOk]   = useState(false)

  // leave periods
  const [periods, setPeriods]   = useState<Period[]>([])
  const [pStart, setPStart]     = useState('')
  const [pEnd, setPEnd]         = useState('')
  const [pReason, setPReason]   = useState('')
  const [addingLeave, setAddingLeave] = useState(false)
  const [leaveError, setLeaveError]   = useState('')

  // planned missions (read-only, from P3)
  const [missions, setMissions] = useState<Mission[]>([])

  function loadAll() {
    setLoading(true)
    Promise.all([
      fetch('/api/prestataire/availability', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch('/api/prestataire/missions', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject())),
    ])
      .then(([a, m]) => {
        setWeekdays(Array.isArray(a.availableWeekdays) ? a.availableWeekdays : [])
        setNote(a.availabilityNote ?? '')
        setPeriods(Array.isArray(a.unavailabilities) ? a.unavailabilities : [])
        setMissions(Array.isArray(m.missions) ? m.missions : [])
      })
      .catch(() => setLoadError(tc('errLoad')))
      .finally(() => setLoading(false))
  }
  useEffect(loadAll, []) // eslint-disable-line react-hooks/exhaustive-deps

  const wdLabel = (d: string) => t((`wd${d.charAt(0).toUpperCase()}${d.slice(1)}`) as 'wdMon')
  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString(locale) : '')
  const toggleDay = (d: string) => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]))

  async function saveAvailability() {
    if (savingAvail) return
    setSavingAvail(true); setSavedOk(false)
    try {
      const res = await fetch('/api/prestataire/availability', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availableWeekdays: weekdays, availabilityNote: note.trim() || null }),
      })
      if (res.ok) { setSavedOk(true); setTimeout(() => setSavedOk(false), 2500) }
    } finally {
      setSavingAvail(false)
    }
  }

  async function addLeave(e: React.FormEvent) {
    e.preventDefault()
    if (addingLeave) return
    if (!pStart || !pEnd) return
    if (new Date(pEnd).getTime() < new Date(pStart).getTime()) { setLeaveError(tc('leaveErrDates')); return }
    setAddingLeave(true); setLeaveError('')
    try {
      const res = await fetch('/api/prestataire/availability', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: new Date(pStart).toISOString(),
          endDate:   new Date(pEnd).toISOString(),
          reason:    pReason.trim() || null,
        }),
      })
      if (!res.ok) { const d = await res.json().catch(() => null); setLeaveError(d?.error || tc('errSave')); return }
      const d = await res.json()
      if (d?.period) setPeriods((prev) => [...prev, d.period].sort((a, b) => a.startDate.localeCompare(b.startDate)))
      setPStart(''); setPEnd(''); setPReason('')
    } catch {
      setLeaveError(tc('errSave'))
    } finally {
      setAddingLeave(false)
    }
  }

  async function deleteLeave(id: string) {
    const res = await fetch(`/api/prestataire/availability?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (res.ok) setPeriods((prev) => prev.filter((p) => p.id !== id))
  }

  // Read-only agenda: only missions that carry a scheduledDate (accepted / done in P3).
  const plannedMissions = useMemo(
    () => missions.filter((m) => m.scheduledDate).sort((a, b) => (a.scheduledDate ?? '').localeCompare(b.scheduledDate ?? '')),
    [missions],
  )

  return (
    <div className="min-h-screen bg-grubano-bg">
      <header className="bg-grubano-ink text-white">
        <div className="mx-auto max-w-4xl px-5 py-5 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-grubano-lg bg-grubano-primary/20">
            <CalendarDays size={18} className="text-grubano-primary" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-widest text-white/40">Grubano</p>
            <h1 className="font-display text-lg font-bold leading-tight truncate">{tc('title')}</h1>
          </div>
          <Link href="/prestataire/dashboard" className="inline-flex items-center gap-1 text-sm font-medium text-white/70 hover:text-white">
            <ArrowLeft size={15} /> {tc('back')}
          </Link>
        </div>
      </header>

      <RoleSwitcher tone="light" />

      <main className="mx-auto max-w-4xl px-5 py-6 space-y-5">
        <p className="text-sm text-grubano-ink-muted">{tc('subtitle')}</p>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-grubano-primary" /></div>
        ) : loadError ? (
          <Card elevation="sm" padding="lg"><p className="text-sm text-grubano-danger">{loadError}</p></Card>
        ) : (
          <>
            {/* ── 1) Declared availability ── */}
            <Card elevation="sm" padding="lg">
              <h2 className="mb-3 font-display text-lg font-bold text-grubano-ink">{tc('availabilityTitle')}</h2>

              <p className="mb-1.5 text-sm font-medium text-grubano-ink">{tc('weekdaysLabel')}</p>
              <div className="mb-4 flex flex-wrap gap-2">
                {WEEKDAYS.map((d) => {
                  const on = weekdays.includes(d)
                  return (
                    <button key={d} type="button" onClick={() => toggleDay(d)} aria-pressed={on}
                      className={[
                        'rounded-grubano-pill border px-3 py-1.5 text-sm font-semibold transition-colors',
                        on ? 'border-grubano-primary bg-grubano-primary text-white' : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted hover:border-grubano-primary/40',
                      ].join(' ')}>
                      {wdLabel(d)}
                    </button>
                  )
                })}
              </div>

              <label className="mb-1.5 block text-sm font-medium text-grubano-ink">{tc('noteLabel')}</label>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tc('notePlaceholder')}
                className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2 text-sm text-grubano-ink focus:border-grubano-primary focus:outline-none focus:ring-4 focus:ring-grubano-primary/20" />

              <div className="mt-3 flex items-center gap-3">
                <Button variant="primary" size="sm" loading={savingAvail} leftIcon={savingAvail ? undefined : <Check size={15} />} onClick={saveAvailability}>
                  {savingAvail ? tc('saving') : tc('saveAvailability')}
                </Button>
                {savedOk && <span className="text-sm font-medium text-grubano-success">{tc('savedOk')}</span>}
              </div>
            </Card>

            {/* ── Leave / holiday periods ── */}
            <Card elevation="sm" padding="lg">
              <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-grubano-ink">
                <CalendarOff size={18} className="text-grubano-ink-muted" /> {tc('leaveTitle')}
              </h2>

              {periods.length === 0 ? (
                <p className="mb-3 text-sm text-grubano-ink-muted">{tc('leaveEmpty')}</p>
              ) : (
                <ul className="mb-3 space-y-2">
                  {periods.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 rounded-grubano-md bg-grubano-surface-muted px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-grubano-ink">{fmtDate(p.startDate)} → {fmtDate(p.endDate)}</p>
                        {p.reason && <p className="text-xs text-grubano-ink-muted truncate">{p.reason}</p>}
                      </div>
                      <button onClick={() => deleteLeave(p.id)} aria-label={tc('leaveDelete')} className="grid h-8 w-8 shrink-0 place-items-center rounded-grubano-md text-grubano-danger hover:bg-grubano-danger-tint">
                        <Trash2 size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <form onSubmit={addLeave} className="space-y-2 border-t border-grubano-border pt-3">
                {leaveError && <p className="rounded-grubano-lg bg-grubano-danger-tint px-3 py-2 text-sm text-grubano-danger">{leaveError}</p>}
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input label={tc('leaveStart')} type="date" required value={pStart} onChange={(e) => setPStart(e.target.value)} />
                  <Input label={tc('leaveEnd')} type="date" required value={pEnd} onChange={(e) => setPEnd(e.target.value)} />
                </div>
                <Input label={tc('leaveReason')} value={pReason} onChange={(e) => setPReason(e.target.value)} placeholder={tc('leaveReasonPlaceholder')} />
                <Button type="submit" variant="secondary" size="sm" loading={addingLeave} leftIcon={addingLeave ? undefined : <Plus size={15} />}>
                  {addingLeave ? tc('leaveAdding') : tc('addLeave')}
                </Button>
              </form>
            </Card>

            {/* ── 2) Planned missions (READ-ONLY, from P3) ── */}
            <Card elevation="sm" padding="lg">
              <h2 className="mb-1 flex items-center gap-2 font-display text-lg font-bold text-grubano-ink">
                <Briefcase size={18} className="text-grubano-ink-muted" /> {tc('missionsTitle')}
              </h2>
              <p className="mb-3 text-[12px] text-grubano-ink-faint">{tc('missionsHint')}</p>

              {plannedMissions.length === 0 ? (
                <p className="text-sm text-grubano-ink-muted">{tc('missionsEmpty')}</p>
              ) : (
                <ul className="space-y-2">
                  {plannedMissions.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 rounded-grubano-md border border-grubano-border px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-grubano-ink">{fmtDate(m.scheduledDate)}</p>
                        <p className="text-xs text-grubano-ink-muted truncate">
                          {m.restaurantOperator?.name ?? '—'}{m.serviceOffering ? ` · ${m.serviceOffering.title}` : ''}
                        </p>
                      </div>
                      <Badge tone={STATUS_TONE[m.status] ?? 'neutral'} size="sm">{tm((`status_${m.status}`) as 'status_accepted')}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </main>
    </div>
  )
}
