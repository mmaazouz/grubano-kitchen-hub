// lib/refund-dispute-guard.ts — PRE-MODE-B V1 : « une charge contestée échoue FERMÉE » sur les rails DIRECTS.
//
// LE DÉFAUT. `lib/refund.ts executeRefund` ne lit jamais `charge.disputed`. Le rail RÉCLAMATION est
// couvert AVANT le moteur et AVANT toute écriture par `reapprovalSafetyHolds` (lib/claims.ts) →
// `lib/claim-action-rules.ts` H5 'disputed'. Les rails DIRECTS ne l'étaient pas :
//   · POST /api/admin/refunds/run        (le déclencheur de la répétition Mode B)
//   · POST /api/orders/[id]/refund
//   · le webhook ghost-order (auto-refund)
//   · lib/refunds.ts refundPayment       (tickets + empreintes ; garde en ligne, la charge y est déjà lue)
// Un chargeback sort l'argent sur un rail que `amount_refunded` n'enregistre pas : rembourser en plus
// du débit du litige paie DEUX fois. La garde vit donc chez les APPELANTS et n'entre JAMAIS dans
// lib/refund.ts — le moteur est gelé et son empreinte est épinglée octet par octet
// (tests/claims-r13-engine-closed.test.ts). Le miroir G5 `engineRefusalOnReapproval` reste exact.
//
// NOUS NE PRÉTENDONS PAS que Stripe refuserait : c'est NOUS qui bloquons. `charge.disputed` reste vrai
// après la clôture du litige (le SDK ne déclare qu'un booléen sans sous-état), donc le refus peut
// survivre à un litige GAGNÉ : le message nomme la sortie humaine. Aucune ligne n'est écrite, aucune
// clé de cumul n'est prise — un refus, jamais un état absorbant.
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'

export type DisputeGuard = { ok: true } | { ok: false; status: 409 | 502; error: string }

/**
 * Message unique (rails directs + rail empreinte).
 *
 * VÉRACITÉ : on n'affirme RIEN sur ce que Stripe accepterait ou refuserait — le projet ne l'a pas
 * mesuré. On dit ce que NOUS savons : le litige a pu sortir l'argent sur un rail que `amount_refunded`
 * n'enregistre pas, donc aucun de nos plafonds ne le voit, donc nous ne payons pas par-dessus.
 * Le blocage peut survivre à un litige gagné (`charge.disputed` reste vrai) : la sortie humaine est
 * nommée, et elle commence par VÉRIFIER qu'aucun remboursement n'existe déjà — sinon la reprise
 * manuelle paierait deux fois ce que le garde-fou vient d'empêcher.
 */
export const DISPUTED_REFUND_REFUSAL =
  'Paiement contesté chez Stripe — remboursement bloqué par sécurité : le litige a pu sortir l’argent '
  + 'sans que `amount_refunded` l’enregistre, donc le montant remboursable n’est plus prouvable ici. '
  + 'Ce blocage subsiste après la clôture du litige (la charge reste marquée contestée) — reprise '
  + 'manuelle requise (Dashboard Stripe : vérifier d’abord qu’aucun remboursement n’existe déjà sur '
  + 'cette commande, puis l’issue du litige, avant de rembourser depuis Stripe).'

/** true ⇒ la charge est contestée. Lecture pure, jamais d'écriture. */
export function chargeIsDisputed(charge: Stripe.Charge | null): boolean {
  return charge?.disputed === true
}

/**
 * Refuse un remboursement sur une charge contestée, AVANT tout appel au moteur.
 *
 * FAIL-CLOSED, trois fois :
 *  · Stripe illisible ⇒ 502 (sans lecture, l'absence de litige n'est pas prouvable) ;
 *  · `latest_charge` renvoyé en CHAÎNE alors que l'expansion a été demandée ⇒ 502 : état impossible,
 *    donc l'expansion a été perdue (refactor, mauvais argument) et `disputed` n'a JAMAIS été lu.
 *    C'est le seul mode de défaillance SILENCIEUX de ce module, il échoue donc fermé ;
 *  · charge ABSENTE (`null`) ⇒ `ok: true` : il n'y a rien à contester, et c'est le moteur qui
 *    refusera lui-même une PI sans charge. La garde ne parle que du litige.
 */
export async function assertChargeNotDisputed(paymentIntentId: string): Promise<DisputeGuard> {
  let pi: Stripe.PaymentIntent
  try {
    pi = await getStripe().paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] })
  } catch {
    return { ok: false, status: 502, error: 'Vérification du litige impossible pour l’instant — réessayez.' }
  }
  if (typeof pi.latest_charge === 'string') {
    return { ok: false, status: 502, error: 'Vérification du litige impossible pour l’instant — réessayez.' }
  }
  const charge = pi.latest_charge ?? null
  if (!chargeIsDisputed(charge)) return { ok: true }
  return { ok: false, status: 409, error: DISPUTED_REFUND_REFUSAL }
}
