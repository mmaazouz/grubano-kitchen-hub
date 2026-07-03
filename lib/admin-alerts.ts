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
