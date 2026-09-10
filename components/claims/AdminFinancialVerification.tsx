'use client'

import { useState, useEffect, useCallback } from 'react'
import { useLocale } from 'next-intl'
import { Button, Badge, useToast } from '@/components/design-system'
import { formatEuros } from '@/lib/format-money'

// ── T-49 — THE FINANCIAL VERIFICATION QUEUE (founder decision, 2026-09-10) ────────
//
// Fail-closed financially is only acceptable if it is fail-VISIBLE operationally. This is that
// visibility. It renders even when CLAIMS_ENABLED is off, because a claim whose money truth is
// unresolved must never disappear because a feature flag moved.
//
// Everything here obeys one rule: state ONLY what is proven. The whole reason a claim is in this
// queue is that nobody knows whether the customer was paid, so this component never says money
// left, never says money did not leave, and never offers an action that would move money.

type Row = {
  id: string
  orderId: string
  reason: string
  requestedAmountCents: number
  refundId: string | null
  refundError: string | null
  createdAt: string
  safety?: boolean
  ambiguity?: string
}

type Payload = {
  financialVerification: Row[]
  reconcileRequired: Row[]
  counts: { financialVerification: number; reconcileRequired: number; total: number }
}

/** Why attribution failed, in words an operator can act on. Never a money claim. */
const AMBIGUITY_LABEL: Record<string, string> = {
  stripe_unreadable:          'La vérité Stripe n’a pas pu être lue. Aucune conclusion tirée.',
  refund_moved_unattributed:  'Des remboursements existent sur la commande, mais aucun ne porte l’identité de cette réclamation.',
  multiple_candidate_refunds: 'Plusieurs remboursements portent l’identité de cette réclamation.',
  unknown:                    'Cause d’ambiguïté non renseignée.',
}

export default function AdminFinancialVerification() {
  const locale = useLocale()
  const toast = useToast()
  const [data, setData] = useState<Payload | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/claims/financial-verification')
      if (!res.ok) return
      setData((await res.json()) as Payload)
    } catch { /* a failed read must not blank the console */ }
  }, [])
  useEffect(() => { void load() }, [load])

  // The ONLY action offered here. It reads Stripe and our own refund rows, identifies which
  // refund belongs to this claim, and applies the truth that already exists. It cannot create a
  // refund: there is no engine call behind it. When evidence is inconclusive the claim stays
  // exactly where it is — pressing the button again will not invent an answer.
  const reconcile = useCallback(async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/claims/${id}/reconcile`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error((body as { error?: string }).error || 'Échec de la réconciliation.'); return }
      const outcome = (body as { result?: { outcome?: string } }).result?.outcome
      const said: Record<string, string> = {
        refunded:               'Preuve trouvée : le remboursement a abouti. Réclamation réconciliée sur son identité exacte.',
        refund_failed:          'Preuve trouvée : le remboursement a ÉCHOUÉ. La réclamation redevient traitable.',
        still_pending:          'Le remboursement est encore en attente chez Stripe. Rien n’est clos, aucun second remboursement.',
        no_refund_proven:       'Preuve d’absence : aucun remboursement n’existe et Stripe n’en rapporte aucun. La réclamation est de nouveau payable par le rail normal.',
        financial_verification: 'Toujours indéterminé. Aucune conclusion, aucun argent, aucune clôture. Escalade opérateur requise.',
      }
      toast.success(said[outcome ?? ''] ?? 'Réconciliation terminée.')
      await load()
    } catch {
      toast.error('Échec de la réconciliation.')
    } finally { setBusyId(null) }
  }, [load, toast])

  const rows = [
    ...(data?.reconcileRequired ?? []).map((r) => ({ ...r, kind: 'reconcile_required' as const })),
    ...(data?.financialVerification ?? []).map((r) => ({ ...r, kind: 'financial_verification' as const })),
  ]
  if (!rows.length) return null

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-red-800">
        Vérification financière requise ({rows.length})
      </h2>
      <p className="mb-3 text-[13px] text-grubano-ink-muted">
        La vérité argent de ces réclamations n’est pas établie. Le système ne dira pas que le
        client a été payé, ni qu’il ne l’a pas été : il ne le sait pas. Aucun nouveau
        remboursement ne peut être lancé et la commande reste verrouillée contre une seconde
        réclamation tant que la transaction existante n’est pas attribuée.
      </p>

      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="rounded-grubano-xl border border-red-300 bg-red-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold text-grubano-ink">
                Commande #{r.orderId.slice(-6)}
              </span>
              <span className="text-sm font-semibold text-grubano-primary">
                {formatEuros(r.requestedAmountCents / 100, locale)} demandés
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {r.safety && <Badge tone="danger">Allergène / sécurité</Badge>}
              <Badge tone="danger">
                {r.kind === 'reconcile_required'
                  ? 'Tentative interrompue — identité non liée'
                  : 'Attribution impossible'}
              </Badge>
            </div>

            <dl className="mt-2 space-y-1 text-[13px] text-grubano-ink-muted">
              {/* Deliberately NOT a money statement: that is the open question. */}
              <p><span className="font-semibold">Argent :</span> INDÉTERMINÉ — à établir par preuve Stripe.</p>
              <p><span className="font-semibold">Réclamation :</span> <code>{r.id}</code></p>
              <p>
                <span className="font-semibold">Ouverte depuis :</span>{' '}
                {new Date(r.createdAt).toLocaleString(locale)}
              </p>
              {r.kind === 'financial_verification' && (
                <p><span className="font-semibold">Cause :</span> {AMBIGUITY_LABEL[r.ambiguity ?? 'unknown'] ?? AMBIGUITY_LABEL.unknown}</p>
              )}
              <p><span className="font-semibold">Remboursement lié :</span> {r.refundId ? <code>{r.refundId}</code> : 'aucun'}</p>
            </dl>

            <Button
              size="sm"
              className="mt-3"
              disabled={busyId === r.id}
              onClick={() => reconcile(r.id)}
            >
              Réconcilier d’après la preuve
            </Button>
            <p className="mt-1 text-[12px] text-grubano-ink-muted">
              Lit Stripe et les lignes de remboursement existantes. Ne crée aucun remboursement,
              ne relance rien, ne déplace aucun argent.
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
