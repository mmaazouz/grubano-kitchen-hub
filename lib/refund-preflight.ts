// lib/refund-preflight.ts — MODE B, commit A : refuser AVANT que le moteur n'écrive quoi que ce soit.
//
// LE DÉFAUT DE FOND (audit Phase 1, prouvé et contre-vérifié). `lib/refund.ts:808` insère une ligne
// `Refund` 'pending' AVANT `stripe.refunds.create` (:355). Si Stripe REJETTE de façon terminale, la
// ligne reste 'pending' pour toujours : 'failed' n'est écrit que par `markRefundRowFailed`, qui EXIGE
// un objet Stripe Refund réel ; la clé `refund:<orderId>:<cumul>` est @unique et devient un curseur
// pris ⇒ toute tentative ultérieure meurt sur P2002, pour TOUT montant et TOUT rail. Passé 20 h, la
// reprise elle-même refuse (fenêtre d'idempotence) : le rail de remboursement de la commande est mort.
//
// CE QUE CE FICHIER FAIT. Il supprime la SEULE cause de rejet terminal que le dépôt prouve, avant
// toute écriture : une charge ROUTÉE (destination Connect) SANS commission. `lib/stripe.ts` omet
// `application_fee_amount` quand la commission vaut 0 (offre fondateurs, crédit fidélité ≥ commission,
// empreinte) ; `lib/refunds.ts` conditionne déjà `refund_application_fee` à `fee > 0` ; mais le moteur
// GELÉ (`lib/refund.ts:359`) envoie ce drapeau sans condition dès que la charge est routée.
//
// CE QU'IL NE FAIT PAS, et pourquoi. Il ne vérifie PAS le solde du compte connecté : `balance_insufficient`
// n'existe nulle part dans ce dépôt, le seuil BRUT est une convention maison (T-42), Stripe tolère
// couramment une réversion qui rend le solde négatif, et la course lecture/création rendrait le contrôle
// consultatif de toute façon. Un 409 à tort sur le rail admin arrêterait la répétition pour rien : ce
// point reste l'AVERTISSEMENT mesuré de `scripts/server/phase2-refund-gate.js` + une précondition de
// runbook (planning de versement du compte connecté en `manual`).
//
// Comme `lib/refund-dispute-guard.ts`, ce garde-fou vit CHEZ LES APPELANTS et n'entre JAMAIS dans
// lib/refund.ts : le moteur est gelé et son empreinte est épinglée octet par octet
// (tests/claims-r13-engine-closed.test.ts).
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'

export type FundingPreflight =
  | { ok: true }
  | { ok: false; status: 409 | 502; cause: 'unreadable' | 'routed_without_fee'; error: string }

/** Véracité : on n'affirme PAS ce que Stripe répondrait — on dit que nous ne l'avons pas mesuré. */
export const ROUTED_WITHOUT_FEE_REFUSAL =
  'Paiement routé vers le compte du restaurant SANS commission Grubano : le moteur demanderait à Stripe '
  + 'de rembourser une commission inexistante. Nous n’avons pas mesuré ce que Stripe répond dans ce cas — '
  + 'nous refusons donc AVANT toute écriture plutôt que de risquer une ligne de remboursement définitivement '
  + 'bloquée. Aucune ligne n’a été créée, aucune clé de cumul n’a été prise. Reprise manuelle (Dashboard '
  + 'Stripe : vérifier d’abord qu’aucun remboursement n’existe déjà sur cette commande, puis rembourser '
  + 'depuis Stripe).'

export const PREFLIGHT_UNREADABLE_REFUSAL =
  'Vérification du financement impossible pour l’instant — réessayez.'

/** true ⇒ le moteur enverrait `refund_application_fee` sur une charge qui ne porte aucune commission. */
export function routedWithoutFee(pi: Stripe.PaymentIntent, charge: Stripe.Charge | null): boolean {
  if (!pi.transfer_data) return false                 // pas de rail Connect ⇒ aucun drapeau envoyé
  if (!charge) return false                           // pas de charge ⇒ le moteur refuse lui-même
  return (charge.application_fee_amount ?? 0) <= 0
}

/**
 * Refuse un remboursement dont le moteur ferait un rejet terminal, AVANT sa première écriture.
 *
 * FAIL-CLOSED : Stripe illisible ⇒ 502 ; `latest_charge` renvoyé en CHAÎNE (expansion perdue) ⇒ 502,
 * car sans la charge on ne peut RIEN prouver sur la commission. Charge absente ⇒ `ok` : c'est le
 * moteur qui refuse (et il refuse avant d'insérer).
 */
export async function preflightRefundFunding(input: { paymentIntentId: string }): Promise<FundingPreflight> {
  let pi: Stripe.PaymentIntent
  try {
    pi = await getStripe().paymentIntents.retrieve(input.paymentIntentId, { expand: ['latest_charge'] })
  } catch {
    return { ok: false, status: 502, cause: 'unreadable', error: PREFLIGHT_UNREADABLE_REFUSAL }
  }
  if (typeof pi.latest_charge === 'string') {
    return { ok: false, status: 502, cause: 'unreadable', error: PREFLIGHT_UNREADABLE_REFUSAL }
  }
  const charge = pi.latest_charge ?? null
  if (routedWithoutFee(pi, charge)) {
    return { ok: false, status: 409, cause: 'routed_without_fee', error: ROUTED_WITHOUT_FEE_REFUSAL }
  }
  return { ok: true }
}
