'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, Loader2, Clock, XCircle } from 'lucide-react'
import { Button, Modal, Badge } from '@/components/design-system'

// ── BrandJoinCTA — a restaurateur joins THIS brand with their restaurant (B7) ────────
// Distinct from the hero "become a franchisor" CTA (→ /franchise/apply). This opens the
// FRANCHISEE-join flow: pick one of MY eligible restaurants → POST a candidacy to this
// open brand. Auth is inferred from the API (401 → redirect to login), so no client
// SessionProvider is needed. Read/owner-scoped server-side; the UI only ever shows / sends
// the caller's own restaurants.

type Resto = { id: string; name: string; city: string }
type App   = { brandId: string; status: string }

const fieldClass =
  'w-full rounded-grubano-lg border border-grubano-line bg-white px-3 py-2.5 text-sm text-grubano-ink focus:border-grubano-primary focus:outline-none'

export default function BrandJoinCTA({ brandId, brandName }: { brandId: string; brandName: string }) {
  const t = useTranslations('franchise.join')

  const [open, setOpen]             = useState(false)
  const [loading, setLoading]       = useState(false)
  const [restos, setRestos]         = useState<Resto[]>([])
  const [existing, setExisting]     = useState<string | null>(null) // status of an existing candidacy for THIS brand
  const [sel, setSel]               = useState('')
  const [message, setMessage]       = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone]             = useState(false)
  const [error, setError]           = useState('')

  async function openFlow() {
    setOpen(true); setLoading(true); setError(''); setDone(false)
    try {
      const res = await fetch('/api/franchisee/applications')
      if (res.status === 401) { window.location.href = '/login'; return }
      const d = await res.json()
      const apps: App[] = d.applications ?? []
      const mine = apps.find(a => a.brandId === brandId)
      // A 'rejected' candidacy can be re-submitted → treat as no blocking candidacy.
      setExisting(mine && mine.status !== 'rejected' ? mine.status : null)
      const eligible: Resto[] = d.restaurants ?? []
      setRestos(eligible)
      setSel(eligible[0]?.id ?? '')
    } catch {
      setError(t('errorGeneric'))
    } finally {
      setLoading(false)
    }
  }

  async function submit() {
    if (!sel) return
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/franchisee/applications', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ restaurantId: sel, brandId, message: message.trim() || undefined }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? t('errorGeneric')); return }
      setDone(true)
    } catch {
      setError(t('errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = !existing && restos.length > 0 && !done

  return (
    <>
      <Button variant="primary" size="sm" fullWidth leftIcon={<CheckCircle2 size={13} />} onClick={openFlow}>
        {t('cta')}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('modalTitle', { name: brandName })}
        footer={
          canSubmit ? (
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>{t('cancel')}</Button>
              <Button variant="primary" size="sm" onClick={submit} disabled={submitting || !sel}>
                {submitting ? t('submitting') : t('submit')}
              </Button>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>{t('close')}</Button>
            </div>
          )
        }
      >
        {loading ? (
          <div className="flex items-center justify-center py-6 text-grubano-ink-muted">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : done ? (
          <div className="py-2">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 size={18} className="text-grubano-success" />
              <p className="font-bold text-sm">{t('successTitle')}</p>
            </div>
            <p className="text-sm text-grubano-ink-muted">{t('successBody')}</p>
          </div>
        ) : existing === 'pending' ? (
          <div className="flex items-center gap-2 py-2 text-sm">
            <Clock size={16} className="text-grubano-warning" /> {t('alreadyPending')}
          </div>
        ) : existing === 'approved' ? (
          <div className="flex items-center gap-2 py-2 text-sm">
            <CheckCircle2 size={16} className="text-grubano-success" /> {t('alreadyApproved')}
          </div>
        ) : restos.length === 0 ? (
          <div className="flex items-start gap-2 py-2 text-sm text-grubano-ink-muted">
            <XCircle size={16} className="mt-0.5 shrink-0" /> {t('noEligible')}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label htmlFor="join-resto" className="block text-xs font-semibold text-grubano-ink mb-1">{t('pickRestaurant')}</label>
              <select id="join-resto" className={fieldClass} value={sel} onChange={e => setSel(e.target.value)}>
                {restos.map(r => (
                  <option key={r.id} value={r.id}>{r.name}{r.city ? ` — ${r.city}` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="join-msg" className="block text-xs font-semibold text-grubano-ink mb-1">{t('messageLabel')}</label>
              <textarea
                id="join-msg" rows={3} className={fieldClass}
                placeholder={t('messagePlaceholder')}
                value={message} onChange={e => setMessage(e.target.value)} maxLength={1000}
              />
            </div>
            {error && (
              <p className="rounded-grubano-lg border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2 text-sm text-grubano-danger">{error}</p>
            )}
          </div>
        )}
        {error && !loading && (existing || restos.length === 0) && (
          <p className="mt-2 rounded-grubano-lg border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2 text-sm text-grubano-danger">{error}</p>
        )}
      </Modal>
    </>
  )
}

// Status badge used by the applications banner (re-exported helper kept local to B7 UI).
export function JoinStatusBadge({ status }: { status: string }) {
  const t = useTranslations('franchise.join')
  if (status === 'approved') return <Badge tone="success" size="sm">{t('statusApproved')}</Badge>
  if (status === 'rejected') return <Badge tone="danger"  size="sm">{t('statusRejected')}</Badge>
  return <Badge tone="warning" size="sm">{t('statusPending')}</Badge>
}
