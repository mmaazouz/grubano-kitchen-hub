// lib/refund-row-void.ts — MODE B commit B : LIBÉRER une ligne de remboursement prouvée inexistante.
//
// LE DÉFAUT (Phase 1, prouvé et contre-vérifié). `lib/refund.ts:808` insère une ligne `Refund`
// 'pending' AVANT `stripe.refunds.create`. Si Stripe ne crée jamais rien — processus tué (o2switch
// redémarre Passenger), ou rejet TERMINAL — la ligne reste 'pending' à vie : seul
// `markRefundRowFailed` écrit 'failed' et il EXIGE un objet Stripe Refund réel ; aucune ligne n'est
// jamais supprimée. Sa clé @unique `refund:<orderId>:<cumul>` reste prise ⇒ P2002 sur toute tentative
// ultérieure, pour TOUT montant et TOUT rail, et passé 20 h la reprise elle-même refuse. Le rail de
// remboursement de la COMMANDE est alors mort, et `lib/claims.ts` le dit verbatim. La réclamation, elle,
// se referme par déclaration — mais le client n'est jamais payé PAR L'APPLICATION.
//
// CE QUE FAIT LA LIBÉRATION : elle ne verse rien, elle ne touche pas Stripe, elle ne touche aucune
// Claim. Elle écrit UNE ligne, en une seule opération compare-and-set, et rend la clé de base au
// cumul pour qu'un NOUVEAU remboursement soit possible. C'est une RÉPARATION, pas une prévention :
// le moteur gelé continue d'insérer avant d'appeler Stripe (voir lib/refund-preflight.ts, commit A,
// qui supprime la seule cause de rejet terminal que le dépôt prouve).
//
// UN SEUL PROUVEUR. G8 délègue à `refundRowTruth` (lib/claims.ts) — la MÊME fonction qui a produit le
// verdict `engine_row_dead` que l'opérateur est en train de traiter. Elle pagine, échoue fermée sur
// une liste tronquée, et fait une correspondance d'IDENTITÉ EXACTE (metadata.grubano_refund_row),
// jamais par montant. Écrire un second prouveur du même fait serait exactement la divergence contre
// laquelle ce dépôt épingle partout ailleurs.
//
// Comme lib/refund-dispute-guard.ts et lib/refund-preflight.ts, ce module vit HORS du moteur gelé :
// lib/refund.ts ne change pas d'un octet (son SHA-256 est épinglé).
import { prisma } from '@/lib/prisma'
import { refundRowTruth } from '@/lib/claims'
import { assertChargeNotDisputed } from '@/lib/refund-dispute-guard'
import { REFUND_CURSOR_KEY, VOID_MIN_AGE_MS, isReleasedRow, voidedKey } from '@/lib/refund-void-state'

export { VOID_MIN_AGE_MS, isReleasedRow, voidedKey, VOID_KEY_MARK, REFUND_CURSOR_KEY } from '@/lib/refund-void-state'

export type VoidRefusalCode =
  | 'gated' | 'not_found' | 'order_mismatch' | 'not_pending' | 'has_stripe_id' | 'key_not_cursor'
  | 'too_young' | 'disputed' | 'unreadable' | 'at_stripe' | 'contradiction' | 'absent_within_window'
  | 'cursor_moved' | 'claim_shows_refunded' | 'key_echo_mismatch' | 'changed_during_read'

export type VoidProof = {
  rowId: string
  orderId: string
  amountCents: number
  createdAt: string
  voidableFrom: string
  idempotencyKey: string
  cursorCents: number
  stripeAmountRefundedCents: number | null
  truthKind: string
  otherPendingRowIds: string[]
  boundClaimIds: string[]
}

export type VoidRefusal = { ok: false; status: 400 | 403 | 404 | 409 | 502; code: VoidRefusalCode; error: string; proof: VoidProof | null }
export type VoidProved = { ok: true; proof: VoidProof }
export type VoidDone = { ok: true; proof: VoidProof; keyBefore: string; keyAfter: string }

export const VOID_KEY_ECHO_REFUSAL =
  'La ligne a changé depuis votre lecture (clé d’idempotence différente) — relisez la preuve avant de libérer. Rien n’a été écrit.'
export const VOID_CHANGED_DURING_READ_REFUSAL =
  'La ligne a changé pendant la vérification — rien n’a été écrit. Relisez la preuve.'
export const VOID_SUCCESS_NOTE =
  'Ligne LIBÉRÉE : il est prouvé qu’aucun remboursement Stripe n’a jamais existé pour elle. Rien n’a été versé au client par cette libération. '
  + 'Le rail de remboursement de la commande est rouvert : pour payer le client, relancez un remboursement depuis les outils admin, puis clôturez la réclamation en déclarant qu’il a été payé autrement.'

const ROW_SELECT = {
  id: true, orderId: true, status: true, stripeRefundId: true,
  idempotencyKey: true, amountCents: true, createdAt: true,
} as const

function refuse(status: VoidRefusal['status'], code: VoidRefusalCode, error: string, proof: VoidProof | null = null): VoidRefusal {
  return { ok: false, status, code, error, proof }
}

/**
 * G2..G10 — LECTURE SEULE, n'écrit JAMAIS rien. Sert la pré-visualisation (GET) ET est rejouée à
 * l'intérieur de l'écriture (POST), pour que la preuve et l'acte portent sur le même état.
 */
export async function proveRowStranded(input: { rowId: string; orderId: string; nowMs?: number }): Promise<VoidProved | VoidRefusal> {
  const now = input.nowMs ?? Date.now()
  const row = await prisma.refund.findUnique({ where: { id: input.rowId }, select: ROW_SELECT })
  if (!row) return refuse(404, 'not_found', 'Ligne de remboursement introuvable.')
  // G5 — recoupement anti-faute de frappe : l'opérateur nomme la commande qu'il croit réparer.
  if (row.orderId !== input.orderId) return refuse(400, 'order_mismatch', 'Cette ligne n’appartient pas à la commande indiquée — rien n’a été lu de plus.')
  // G2/G3 — seul l'état « rien n'a jamais été établi chez Stripe » est libérable.
  if (row.status !== 'pending') {
    return refuse(409, 'not_pending', isReleasedRow(row)
      ? 'Cette ligne a DÉJÀ été libérée — la clé de cumul est rendue, le rail de la commande est rouvert. Rien à refaire.'
      : `Cette ligne n’est pas « en attente » (statut « ${row.status} ») : seule une ligne dont aucun remboursement Stripe n’a jamais existé peut être libérée.`)
  }
  if (row.stripeRefundId) {
    return refuse(409, 'has_stripe_id', `Cette ligne enregistre le remboursement Stripe ${row.stripeRefundId} : le moteur A atteint Stripe. Ce n’est pas un cas de libération — utilisez la réconciliation.`)
  }
  // G4 — une clé déjà marquée (:failed: / :void:) n'est plus un curseur.
  const m = REFUND_CURSOR_KEY.exec(row.idempotencyKey ?? '')
  if (!m) return refuse(409, 'key_not_cursor', 'La clé d’idempotence de cette ligne n’est pas un curseur de cumul intact — rien n’a été écrit.')
  const cursorCents = Number(m[2])

  const createdAtMs = new Date(row.createdAt).getTime()
  const voidableFromMs = createdAtMs + VOID_MIN_AGE_MS
  const base: Omit<VoidProof, 'stripeAmountRefundedCents' | 'truthKind' | 'otherPendingRowIds' | 'boundClaimIds'> = {
    rowId: row.id, orderId: row.orderId, amountCents: row.amountCents,
    createdAt: new Date(createdAtMs).toISOString(), voidableFrom: new Date(voidableFromMs).toISOString(),
    idempotencyKey: row.idempotencyKey as string, cursorCents,
  }
  // G6 — un instant illisible ou futur n'est JAMAIS lu comme ancien (miroir de la règle D5 du rail).
  if (!Number.isFinite(createdAtMs) || createdAtMs > now) {
    return refuse(409, 'too_young', 'La date de création de cette ligne n’est pas exploitable — rien n’a été écrit.')
  }
  if (now < voidableFromMs) {
    return refuse(409, 'too_young',
      `Trop tôt : cette ligne ne peut être libérée qu’à partir du ${new Date(voidableFromMs).toISOString()}. `
      + 'Avant cet instant, le moteur peut encore reprendre la ligne et créer le remboursement d’origine — libérer maintenant risquerait un second remboursement. Rien n’a été écrit.')
  }

  const order = await prisma.order.findUnique({ where: { id: row.orderId }, select: { stripePaymentIntentId: true } })
  const piId = order?.stripePaymentIntentId ?? null
  if (!piId) return refuse(409, 'unreadable', 'Cette commande ne porte aucun paiement Stripe : impossible de prouver quoi que ce soit. Rien n’a été écrit.')

  // G7 — une charge contestée n'est jamais un terrain de réparation (garde partagée, commit 689f8b9).
  const notDisputed = await assertChargeNotDisputed(piId)
  if (!notDisputed.ok) {
    return refuse(notDisputed.status, notDisputed.status === 502 ? 'unreadable' : 'disputed', notDisputed.error)
  }

  // G8 — LE prouveur du dépôt, pas un second. Identité exacte, liste paginée, échec fermé si tronquée.
  const truth = await refundRowTruth({ id: row.id, status: row.status, stripeRefundId: row.stripeRefundId, createdAt: row.createdAt }, row.orderId, {}, piId)
  const proofPartial = { ...base, truthKind: truth.kind }
  if (truth.kind === 'unreadable') {
    return refuse(502, 'unreadable', 'Vérité Stripe illisible (liste indisponible ou tronquée) : l’absence n’est pas prouvable. Rien n’a été écrit.', { ...proofPartial, stripeAmountRefundedCents: null, otherPendingRowIds: [], boundClaimIds: [] })
  }
  if (truth.kind === 'at_stripe') {
    return refuse(409, 'at_stripe', `Un remboursement Stripe porte l’identité de cette ligne (${truth.refund.id}, statut « ${truth.refund.status ?? 'inconnu'} ») : elle n’est donc PAS libérable — c’est un cas de réconciliation. Rien n’a été écrit.`, { ...proofPartial, stripeAmountRefundedCents: null, otherPendingRowIds: [], boundClaimIds: [] })
  }
  if (truth.kind === 'contradiction') {
    return refuse(409, 'contradiction', `${truth.detail} Rien n’a été écrit.`, { ...proofPartial, stripeAmountRefundedCents: null, otherPendingRowIds: [], boundClaimIds: [] })
  }
  if (truth.kind !== 'absent_dead') {
    return refuse(409, 'absent_within_window', 'Le moteur peut encore reprendre cette ligne : elle n’est pas abandonnée. Rien n’a été écrit.', { ...proofPartial, stripeAmountRefundedCents: null, otherPendingRowIds: [], boundClaimIds: [] })
  }

  // G9 — preuve indépendante des metadata, au centime : le cumul Stripe n'a pas bougé depuis la
  // réservation du curseur ⇒ rendre la clé ne peut faire sauter aucun cumul.
  let amountRefunded: number | null = null
  try {
    const { getStripe } = await import('@/lib/stripe')
    const pi = await getStripe().paymentIntents.retrieve(piId, { expand: ['latest_charge'] })
    const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
    amountRefunded = charge ? (charge.amount_refunded ?? 0) : null
  } catch { amountRefunded = null }
  if (amountRefunded === null) {
    return refuse(502, 'unreadable', 'Cumul Stripe illisible — rien n’a été écrit.', { ...proofPartial, stripeAmountRefundedCents: null, otherPendingRowIds: [], boundClaimIds: [] })
  }
  if (amountRefunded !== cursorCents) {
    return refuse(409, 'cursor_moved',
      `Le cumul remboursé chez Stripe (${amountRefunded} c) ne correspond plus au curseur réservé par cette ligne (${cursorCents} c) : de l’argent a bougé sur cette commande. Réconciliation manuelle requise — rien n’a été écrit.`,
      { ...proofPartial, stripeAmountRefundedCents: amountRefunded, otherPendingRowIds: [], boundClaimIds: [] })
  }

  const others = await prisma.refund.findMany({ where: { orderId: row.orderId, status: 'pending', NOT: { id: row.id } }, select: { id: true } })
  const claims = await prisma.claim.findMany({ where: { refundId: row.id }, select: { id: true, status: true, refundError: true } })
  const proof: VoidProof = {
    ...proofPartial, stripeAmountRefundedCents: amountRefunded,
    otherPendingRowIds: others.map((o) => o.id), boundClaimIds: claims.map((c) => c.id),
  }
  // G10 — une réclamation qui affiche « Remboursée » sur CETTE ligne interdit la libération : le client
  // lirait une contradiction. (Doublement impossible après G8/G9 — asserté quand même.)
  if (claims.some((c) => c.status === 'refunded' && c.refundError === null)) {
    return refuse(409, 'claim_shows_refunded', 'Une réclamation affiche « Remboursée » sur cette ligne : libérer la contredirait. Rien n’a été écrit.', proof)
  }
  return { ok: true, proof }
}

/**
 * L'UNIQUE ÉCRIVAIN. Re-prouve, puis UN compare-and-set. N'écrit ni `reason` (écrit une seule fois),
 * ni `stripeRefundId` (ce serait forger le verrou E2 et détruire le discriminant), ni `settledAt`
 * (rien n'a été réglé). Ne supprime rien. Ne touche aucune Claim, aucun ledger, aucune fidélité.
 */
export async function voidStrandedRefundRow(input: {
  rowId: string; orderId: string; expectedIdempotencyKey: string; nowMs?: number
}): Promise<VoidDone | VoidRefusal> {
  const proved = await proveRowStranded({ rowId: input.rowId, orderId: input.orderId, nowMs: input.nowMs })
  if (!proved.ok) return proved
  const { proof } = proved
  // G11 — l'opérateur doit avoir LU la ligne : il rejoue la clé qu'il a vue.
  if (input.expectedIdempotencyKey !== proof.idempotencyKey) {
    return refuse(409, 'key_echo_mismatch', VOID_KEY_ECHO_REFUSAL, proof)
  }
  const keyAfter = voidedKey(proof.idempotencyKey, new Date(input.nowMs ?? Date.now()))
  const done = await prisma.refund.updateMany({
    where: { id: proof.rowId, status: 'pending', stripeRefundId: null, idempotencyKey: proof.idempotencyKey },
    data:  { status: 'failed', idempotencyKey: keyAfter },
  })
  if (done.count !== 1) return refuse(409, 'changed_during_read', VOID_CHANGED_DURING_READ_REFUSAL, proof)
  return { ok: true, proof, keyBefore: proof.idempotencyKey, keyAfter }
}
