// ── Admin operational alerts ───────────────────────────────────────────────────
// Admin-facing operational heads-ups (NOT consumer/resto transactional emails). Kept
// in a SEPARATE module from lib/transactional-emails on purpose: the Stripe webhook
// (money rail) is allowed to raise an ADMIN alert without importing the consumer/resto
// email senders — the golden-rule invariant "the webhook imports no order-email sender"
// (guarded by the email-* source-scan tests) stays intact and meaningful. Reuses the
// B0 sendOnce idempotency rail; never throws (best-effort); a missing ALERT_EMAIL is a
// clean no-op.
import { sendOnce, type SendStatus } from '@/lib/transactional-emails'

const escHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * WP-MONEY-01 — a card order lazily expired (>24h) but its payment landed AFTER
 * expiry → money captured on a dead order. One idempotent admin alert per order
 * (sendOnce trigger `admin_ghost_order`, dedupeKey `order:<id>`) so the captured
 * charge is reconciled (auto-refunded when REFUNDS_ENABLED, else via the manual queue).
 */
export async function sendAdminGhostOrderAlert(p: {
  orderId:         string
  paymentIntentId: string
  amountCents:     number
  refundsOn:       boolean
}): Promise<{ status: SendStatus }> {
  // FULLY internally try/catch'd (best-effort): an alert failure — SMTP down, a
  // sendOnce/DB hiccup, anything — must NEVER throw into the ghost-order webhook,
  // so it can never block the reconcile_manual/refunded marking nor 500 the webhook.
  try {
    const to = (process.env.ALERT_EMAIL || '').trim()
    if (!to) return { status: 'skipped' } // ALERT_EMAIL not configured → clean no-op
    const euros  = (p.amountCents / 100).toFixed(2)
    const action = p.refundsOn
      ? 'Un remboursement automatique a été émis via le moteur royalty-aware (à vérifier).'
      : 'Aucun remboursement automatique (REFUNDS désactivé) — à traiter dans la file manuelle.'
    const subject = '[Grubano] Commande expirée encaissée — réconciliation requise'
    const html =
      `<div style="font-family:system-ui,Arial,sans-serif;color:#111827;max-width:520px">`
      + `<h2 style="font-size:17px">Commande expirée encaissée</h2>`
      + `<p>Une commande <b>expirée</b> a été encaissée par Stripe (paiement arrivé après l'expiration). Elle n'est PAS servie au restaurant ; l'encaissement doit être réconcilié.</p>`
      + `<p style="font-size:14px">Commande : <b>${escHtml(p.orderId)}</b><br>PaymentIntent : <b>${escHtml(p.paymentIntentId)}</b><br>Montant : <b>${euros} €</b></p>`
      + `<p style="font-size:13px;color:#6b7280">${action} File de réconciliation : commandes avec paymentStatus « reconcile_manual ».</p>`
      + `</div>`
    return await sendOnce('admin_ghost_order', `order:${p.orderId}`, { to, subject, html })
  } catch {
    return { status: 'failed' } // never throws — the reconciliation proceeds regardless
  }
}

/**
 * M2-03 / M6-01 (money flow) — a SUCCEEDED PaymentIntent that is NOT the
 * current PI of its order/ticket was captured (orphan from a cancel+recreate
 * whose cancelIntent failed, or a lost /pay race). The immutable ledger line IS
 * written (ledger-first) but the confirmation is refused (stale_pi) — real
 * money captured with only a console.error as signal until now. ONE idempotent
 * alert per orphan PI (trigger `admin_stale_pi`, dedupeKey `pi:<id>`); the
 * refund of the orphan is a manual admin decision (dashboard Stripe or rails).
 */
export async function sendAdminStalePiAlert(p: {
  kind:            'order' | 'ticket'
  entityId:        string
  paymentIntentId: string
  currentPiId:     string | null
  amountCents:     number
}): Promise<{ status: SendStatus }> {
  try {
    const to = (process.env.ALERT_EMAIL || '').trim()
    if (!to) return { status: 'skipped' }
    const euros = (p.amountCents / 100).toFixed(2)
    const subject = '[Grubano] Paiement capturé sur un PaymentIntent périmé — réconciliation requise'
    const html =
      `<div style="font-family:system-ui,Arial,sans-serif;color:#111827;max-width:520px">`
      + `<h2 style="font-size:17px">Encaissement sur PI périmé (${p.kind === 'order' ? 'commande' : 'addition'})</h2>`
      + `<p>Un PaymentIntent <b>qui n'est plus le PI courant</b> a été encaissé. La ligne ledger est écrite, mais la ${p.kind === 'order' ? 'commande' : 'session'} n'a PAS été confirmée par cet encaissement — le client a pu payer deux fois.</p>`
      + `<p style="font-size:14px">${p.kind === 'order' ? 'Commande' : 'Addition'} : <b>${escHtml(p.entityId)}</b><br>PI encaissé (périmé) : <b>${escHtml(p.paymentIntentId)}</b><br>PI courant : <b>${escHtml(p.currentPiId ?? '(aucun)')}</b><br>Montant : <b>${euros} €</b></p>`
      + `<p style="font-size:13px;color:#6b7280">Vérifier dans le dashboard Stripe si les DEUX PIs sont encaissés ; rembourser l'orphelin le cas échéant (rail admin refund par PI, ou dashboard).</p>`
      + `</div>`
    return await sendOnce('admin_stale_pi', `pi:${p.paymentIntentId}`, { to, subject, html })
  } catch {
    return { status: 'failed' }
  }
}

/**
 * P0-39 (vague 3) — a claim has been AWAITING the restaurant's answer past its
 * response deadline. The 24h auto-approval (the circuit's relief valve) was
 * removed by P0-07/P0-25 per Q3 with nothing replacing it — without this alert
 * a claim a restaurant ignores stays stuck, invisible to everyone (the founder
 * is a single operator with no backup). ONE idempotent alert per claim, EVER
 * (sendOnce trigger `admin_stale_claim`, dedupeKey `claim:<id>` — the @@unique
 * makes daily re-runs a no-op, no daily reminder loop). READ-ONLY signal: the
 * admin SEES (console /admin/claims, section « En attente du restaurant ») —
 * no automatic action of any kind (Q3 forbids automated financial effects).
 */
export async function sendAdminStaleClaimAlert(p: {
  claimId:              string
  orderId:              string
  requestedAmountCents: number
  ageHours:             number
}): Promise<{ status: SendStatus }> {
  try {
    const to = (process.env.ALERT_EMAIL || '').trim()
    if (!to) return { status: 'skipped' } // ALERT_EMAIL not configured → clean no-op
    const euros = (p.requestedAmountCents / 100).toFixed(2)
    const subject = '[Grubano] Réclamation sans réponse du restaurant — délai dépassé'
    const html =
      `<div style="font-family:system-ui,Arial,sans-serif;color:#111827;max-width:520px">`
      + `<h2 style="font-size:17px">Réclamation en attente — délai de réponse dépassé</h2>`
      + `<p>Une réclamation attend la réponse du restaurant depuis <b>${Math.floor(p.ageHours)} h</b> — le délai de réponse est dépassé. Sans votre œil, elle resterait bloquée indéfiniment (l'auto-approbation a été retirée, décision Q3).</p>`
      + `<p style="font-size:14px">Réclamation : <b>${escHtml(p.claimId)}</b><br>Commande : <b>${escHtml(p.orderId)}</b><br>Montant demandé : <b>${euros} €</b></p>`
      + `<p style="font-size:13px;color:#6b7280">Aucune action automatique n'a été prise. Elle est visible dans la console d'arbitrage (/admin/claims, section « En attente du restaurant ») — la décision reste au restaurant, puis à vous en arbitrage.</p>`
      + `</div>`
    return await sendOnce('admin_stale_claim', `claim:${p.claimId}`, { to, subject, html })
  } catch {
    return { status: 'failed' } // never throws
  }
}

/**
 * WP-OPS-01 — daily digest of orders awaiting ghost-order reconciliation (expired +
 * captured/flagged). Best-effort, one digest per day (dedupeKey `reconcile:<YYYY-MM-DD>`).
 * READ-ONLY signal — no money action. Never throws.
 */
export async function sendAdminReconcileDigest(p: {
  count:          number
  sampleOrderIds: string[]
  dayKey:         string // YYYY-MM-DD
}): Promise<{ status: SendStatus }> {
  try {
    const to = (process.env.ALERT_EMAIL || '').trim()
    if (!to) return { status: 'skipped' }
    const sample = p.sampleOrderIds.map(escHtml).join(', ')
    const subject = `[Grubano] ${p.count} commande(s) à réconcilier`
    const html =
      `<div style="font-family:system-ui,Arial,sans-serif;color:#111827;max-width:520px">`
      + `<h2 style="font-size:17px">File de réconciliation</h2>`
      + `<p><b>${p.count}</b> commande(s) expirée(s) encaissée(s) attendent une décision (status « expired », paymentStatus « paid »/« reconcile_manual »). Aucune action automatique n'a été prise.</p>`
      + `<p style="font-size:13px;color:#6b7280">Échantillon : ${sample || '—'}</p>`
      + `</div>`
    return await sendOnce('admin_reconcile_digest', `reconcile:${p.dayKey}`, { to, subject, html })
  } catch {
    return { status: 'failed' }
  }
}
