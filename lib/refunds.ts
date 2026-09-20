// ⚠️ TWO REFUND LIBS EXIST — scope settled by PHASE 2 (REFUND-FINANCIAL-CONTRACT §0/§4).
// THIS FILE, lib/refunds.ts (PLURAL) = the SIMPLE PI-keyed refund path for payments
// that have NO Order row and therefore NO franchise royalty: /api/tickets/[id]/refund
// (dine-in bills) and /api/reservations/[id]/refund-deposit. Both routes are ADMIN-only
// and GATED by REFUNDS_ENABLED at the route (P0-26) — this lib is NOT "ungated / live":
// no HTTP path reaches it while the flag is OFF. The ledger line is written by the
// charge.refunded webhook. The OTHER file, lib/refund.ts (SINGULAR), is the royalty-aware
// ENGINE keyed by orderId — since Phase 2 it is the ONLY engine on the ORDER path
// (/api/orders/[id]/refund, /api/admin/refunds/run, claims, ghost-order): an order
// refunded here would return the franchise royalty slice to the customer WITHOUT
// reducing FranchiseRoyalty.refundedCents → the settlement pays it again (double).
// NEVER route an Order refund through this file.
//
// Refunds (rail financier A5). A0 decision: refunding a payment TAKES BACK
// Grubano's commission PRO-RATA (refund_application_fee) and, on a routed
// destination charge, PULLS the funds back from the resto's connected account
// (reverse_transfer). Stripe handles the pro-rata natively: on a partial
// refund with refund_application_fee:true, the application fee is refunded
// "in an amount proportional to the amount of the charge refunded" (full
// refund → full fee). The REAL taken-back amount is read from Stripe's fee
// refunds by the webhook when writing the compensating ledger line — never
// recomputed from rates here.
import type Stripe from 'stripe'
import { chargeIsDisputed, DISPUTED_REFUND_REFUSAL } from '@/lib/refund-dispute-guard'
import { getStripe } from '@/lib/stripe'

export type RefundResult =
  | { ok: true; refund: Stripe.Refund; refundedCents: number; remainingCents: number; routed: boolean }
  | { ok: false; status: 400 | 409 | 500 | 502; error: string }

/** Refund a succeeded PaymentIntent, partially (amountCents) or fully (omit).
 *  Validates against what is actually still refundable on the live charge.
 *  Idempotent: the key is state-dependent (PI + amount + already-refunded), so
 *  a double-click retries the SAME Stripe refund instead of stacking two. */
export async function refundPayment(opts: {
  paymentIntentId: string
  amountCents?:    number
}): Promise<RefundResult> {
  let pi: Stripe.PaymentIntent
  try {
    pi = await getStripe().paymentIntents.retrieve(opts.paymentIntentId, { expand: ['latest_charge'] })
  } catch (err) {
    return fatal(err)
  }

  if (pi.status !== 'succeeded') {
    return { ok: false, status: 409, error: 'Paiement non débité — rien à rembourser.' }
  }
  const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
  if (!charge) {
    return { ok: false, status: 502, error: 'Charge introuvable sur le paiement.' }
  }

  // PRE-MODE-B V1 — charge CONTESTÉE : refus AVANT tout appel Stripe. Ce rail est ouvert par le MÊME
  // bail REFUNDS_ENABLED que le rail commande ; un chargeback sort l'argent sans toucher
  // `amount_refunded`, donc rembourser en plus paierait deux fois. La charge est déjà lue ici :
  // aucune lecture Stripe supplémentaire. Aucune ligne n'est écrite par ce lib — un refus, pas un état.
  if (chargeIsDisputed(charge)) {
    return { ok: false, status: 409, error: DISPUTED_REFUND_REFUSAL }
  }

  // PRE-MODE-B — Rail EMPREINTE = la SEULE capture partielle du projet (capture_method 'manual' +
  // amount_to_capture, lib/stripe.ts createDepositHold/captureDeposit) : le plafond est le CAPTURÉ,
  // jamais l'AUTORISÉ. Avant, /api/reservations/[id]/refund-deposit demandait à Stripe de rendre le
  // hold entier sur une empreinte partiellement capturée — refusé par Stripe, rail mort.
  // lib/refund.ts (rail commande) lit `charge.amount` À DESSEIN : capture automatique, donc
  // amount === amount_captured, et cette valeur y est AUSSI le dénominateur du prorata — ne pas aligner.
  const refundableCents = (charge.amount_captured ?? charge.amount) - (charge.amount_refunded ?? 0)
  const amountCents     = opts.amountCents ?? refundableCents
  if (refundableCents <= 0) {
    return { ok: false, status: 409, error: 'Paiement déjà intégralement remboursé.' }
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > refundableCents) {
    return {
      ok: false, status: 400,
      error: `Montant invalide — remboursable: ${(refundableCents / 100).toFixed(2)} €.`,
    }
  }

  // Routed destination charge → take the commission back pro-rata AND pull the
  // funds back from the connected account. Platform-flow charge → plain refund.
  const routed = !!pi.transfer_data

  try {
    const refund = await getStripe().refunds.create(
      {
        payment_intent: pi.id,
        amount:         amountCents,
        // PRE-MODE-B — les deux drapeaux répondent à des questions DIFFÉRENTES et ne sont plus
        // envoyés ensemble : on ne réclame une commission que s'il y en a eu une. Les empreintes
        // sont créées avec applicationFeeCents: 0 (app/api/reservations/[id]/deposit), et
        // lib/stripe.ts connectParams omet alors `application_fee_amount` — demander le
        // remboursement d'une commission inexistante est au mieux inutile, au pire un rejet.
        ...(routed ? { reverse_transfer: true } : {}),
        ...(routed && (charge.application_fee_amount ?? 0) > 0 ? { refund_application_fee: true } : {}),
      },
      // State-dependent determinism: same logical attempt → same key (no double
      // refund on a retry/race); once amount_refunded moved, a NEW refund of the
      // same amount gets a new key.
      { idempotencyKey: `refund-${pi.id}-${amountCents}-${charge.amount_refunded ?? 0}` },
    )
    return {
      ok: true, refund, routed,
      refundedCents:  amountCents,
      remainingCents: refundableCents - amountCents,
    }
  } catch (err) {
    return fatal(err)
  }
}

function fatal(err: unknown): RefundResult {
  if (err instanceof Error && err.message === 'stripe_not_configured') {
    return { ok: false, status: 500, error: 'Paiement non configuré.' }
  }
  console.error('[refunds] stripe error', err instanceof Error ? err.message : err)
  return { ok: false, status: 502, error: 'Erreur paiement, réessayez.' }
}
