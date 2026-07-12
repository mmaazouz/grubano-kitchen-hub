'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/navigation'
import './franchise-candidatures.css'

// ── FR4 · Candidatures — franchisor reviews join requests (CD Vague 2) ────────────
// Rendered inside FranchiseShell. READS /api/franchise/applications (owner-scoped server
// side — a franchisor only sees candidacies to its OWN brands). Approve → the server
// atomically creates the PointOfSale + links the applicant's restaurant (1:1); reject →
// status only. The two REAL actions are preserved verbatim; the mock's 4-stage pipeline,
// financing plan and "schedule interview" are BUILD-NEW (no model backing) → dropped. No
// money moves here. All fields (candidate, city, brand, date, motivation) are real.

type App = {
  id: string; status: string; message: string | null
  createdAt: string; decidedAt: string | null
  brandName: string; brandEmoji: string
  restaurantName: string; restaurantCity: string
}
type Tab = 'all' | 'pending' | 'approved' | 'rejected'

const INITIALS = (s: string) =>
  (s.trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2) || '–').toUpperCase()

export default function FranchiseCandidaturesPage() {
  const t = useTranslations('franchise.applications')
  const locale = useLocale()
  const [apps, setApps] = useState<App[] | null>(null)
  const [error, setError] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [actErr, setActErr] = useState('')

  function load() {
    fetch('/api/franchise/applications')
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => setApps(d.applications ?? []))
      .catch(() => setError(true))
  }
  useEffect(load, [])

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' }), [locale])
  const day = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : '—')
  const rel = (iso: string) => t('relDays', { days: Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) })
  const statusLabel = (s: string) => (s === 'approved' ? t('statusApproved') : s === 'rejected' ? t('statusRejected') : t('statusPending'))

  async function decide(id: string, action: 'approve' | 'reject') {
    setBusy(id + action); setActErr('')
    try {
      const res = await fetch('/api/franchise/applications', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, action }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setActErr(d.error ?? t('errorNetwork')); return }
      setApps(prev => (prev ?? []).map(a => (a.id === id ? { ...a, status: action === 'approve' ? 'approved' : 'rejected', decidedAt: new Date().toISOString() } : a)))
    } catch {
      setActErr(t('errorNetwork'))
    } finally {
      setBusy(null)
    }
  }

  const counts = useMemo(() => {
    const all = apps ?? []
    return {
      all: all.length,
      pending: all.filter(a => a.status === 'pending').length,
      approved: all.filter(a => a.status === 'approved').length,
      rejected: all.filter(a => a.status === 'rejected').length,
    }
  }, [apps])
  const filtered = (apps ?? []).filter(a => tab === 'all' ? true : a.status === tab)
  const detail = (apps ?? []).find(a => a.id === sel) ?? null

  if (!apps && !error) {
    return (
      <section aria-busy="true">
        <span className="op-sk" style={{ width: 240, height: 26, marginBottom: 18 }} />
        <span className="op-sk" style={{ width: 300, height: 40, borderRadius: 999, marginBottom: 18, display: 'block' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span className="op-sk" style={{ width: '100%', height: 130, borderRadius: 12 }} />
          <span className="op-sk" style={{ width: '100%', height: 130, borderRadius: 12 }} />
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section><div className="op-center">
        <div className="op-error__card">
          <span className="ms" aria-hidden="true">cloud_off</span>
          <h2>{t('errorTitle')}</h2>
          <p>{t('errorBody')}</p>
          <button className="op-btn-primary" onClick={() => location.reload()}><span className="ms" aria-hidden="true">refresh</span>{t('retry')}</button>
        </div>
      </div></section>
    )
  }

  if ((apps ?? []).length === 0) {
    return (
      <section>
        <div className="op-dash__head"><div><h1 className="op-dash__title">{t('title')}</h1></div></div>
        <div className="op-card op-empty">
          <span className="ic"><span className="ms" aria-hidden="true">how_to_reg</span></span>
          <b>{t('empty')}</b>
          <span>{t('emptyDesc')}</span>
        </div>
      </section>
    )
  }

  // ── DETAIL / DOSSIER ──
  if (detail) {
    const a = detail
    const pending = a.status === 'pending'
    return (
      <section>
        <button className="op-back" onClick={() => { setSel(null); setActErr('') }}><span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('title')}</button>

        <div className="op-card ap-dt-top">
          <span className="ap-dt-av">{INITIALS(a.restaurantName || '–')}</span>
          <div className="ap-dt-m">
            <h2>{a.restaurantName || '—'}</h2>
            <div className="sub">
              {a.restaurantCity && <span><span className="ms" aria-hidden="true">place</span>{a.restaurantCity}</span>}
              <span><span className="ms" aria-hidden="true">sell</span>{a.brandEmoji} {a.brandName}</span>
              <span><span className="ms" aria-hidden="true">schedule</span>{t('submittedOn', { date: day(a.createdAt) })}</span>
              <span className={`ap-stage ${a.status}`}><i className="dot" />{statusLabel(a.status)}</span>
            </div>
          </div>
        </div>

        <div className="ap-cols">
          <div>
            {a.message ? (
              <div className="op-card ap-sec">
                <h3><span className="ms" aria-hidden="true">format_quote</span>{t('motivationTitle')}</h3>
                <p>« {a.message} »</p>
              </div>
            ) : (
              <div className="op-card ap-sec">
                <h3><span className="ms" aria-hidden="true">format_quote</span>{t('motivationTitle')}</h3>
                <p>{t('noMessage')}</p>
              </div>
            )}
          </div>

          <div>
            <div className="op-card ap-sec ap-decide">
              <h3>{t('progressTitle')}</h3>
              <div className="hint">{t('progressHint')}</div>
              <div className="ap-stage-track">
                <div className="ap-st done"><span className="d"><span className="ms" aria-hidden="true">check</span></span><div className="m"><b>{t('stepReceived')}</b><span>{day(a.createdAt)}</span></div></div>
                <div className={`ap-st ${a.status === 'approved' ? 'done' : a.status === 'rejected' ? 'rej' : 'current'}`}>
                  <span className="d"><span className="ms" aria-hidden="true">{a.status === 'approved' ? 'handshake' : a.status === 'rejected' ? 'close' : 'visibility'}</span></span>
                  <div className="m"><b>{t('stepDecision')}</b><span>{a.status === 'pending' ? t('decisionPending') : day(a.decidedAt)}</span></div>
                </div>
              </div>

              {pending && (
                <div className="acts">
                  <button className="op-btn-primary" disabled={busy !== null} onClick={() => decide(a.id, 'approve')}>
                    <span className="ms" aria-hidden="true">check</span>{busy === a.id + 'approve' ? t('processing') : t('approveCta')}
                  </button>
                  <button className="op-btn-danger" disabled={busy !== null} onClick={() => decide(a.id, 'reject')}>
                    <span className="ms" aria-hidden="true">close</span>{busy === a.id + 'reject' ? t('processing') : t('rejectCta')}
                  </button>
                </div>
              )}
              {actErr && <p className="ap-err" role="alert">{actErr}</p>}
            </div>
          </div>
        </div>
      </section>
    )
  }

  // ── LIST ──
  return (
    <section>
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('title')}</h1>
          <p className="op-dash__sub">{t('listSub')}</p>
        </div>
      </div>

      <div className="ap-toolbar">
        <div className="ap-tabs">
          {(['all', 'pending', 'approved', 'rejected'] as Tab[]).map(k => (
            <button key={k} type="button" className={tab === k ? 'is-active' : undefined} onClick={() => setTab(k)}>
              {k === 'all' ? t('tabAll') : k === 'pending' ? t('statusPending') : k === 'approved' ? t('statusApproved') : t('statusRejected')}
              <span className="cnt">{counts[k]}</span>
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="op-card"><div className="op-empty" style={{ padding: '48px 20px' }}><span className="ms" aria-hidden="true">filter_list_off</span><b>{t('noneInTab')}</b></div></div>
      ) : (
        <div className="ap-list">
          {filtered.map(a => (
            <button className="ap-card" key={a.id} onClick={() => { setSel(a.id); setActErr('') }}>
              <div className="ap-card__top">
                <span className="ap-av">{INITIALS(a.restaurantName || '–')}</span>
                <div className="ap-card__m">
                  <h3>{a.restaurantName || '—'}</h3>
                  <div className="ap-card__meta">
                    {a.restaurantCity && <span><span className="ms" aria-hidden="true">place</span>{a.restaurantCity}</span>}
                    <span><span className="ms" aria-hidden="true">sell</span>{a.brandEmoji} {a.brandName}</span>
                    <span><span className="ms" aria-hidden="true">schedule</span>{t('submittedAgo', { ago: rel(a.createdAt) })}</span>
                  </div>
                </div>
                <span className={`ap-stage ${a.status}`}><i className="dot" />{statusLabel(a.status)}</span>
              </div>
              <div className="ap-foot">
                <span className="ap-foot__msg">{a.message ? `« ${a.message} »` : t('noMessage')}</span>
                <span className="ap-foot__go">{t('examineFile')}<span className="ms flip-rtl" aria-hidden="true">arrow_forward</span></span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
