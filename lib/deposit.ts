// Shared deposit-settlement logic (server-only). Stripe is the SOURCE OF TRUTH:
// every settle reads the LIVE PaymentIntent and acts on its real status — never on
// the stored depositStatus (which can lag, e.g. stay "none" while the card is
// actually authorised). Used by BOTH the dedicated /deposit/release|capture
// endpoints AND the PATCH /api/reservations status transition, so "Client arrivé"
// (whatever path the UI takes) always settles the empreinte.

import {
  retrieveIntent, releaseDeposit, captureDeposit, eurosToCents, type DepositStatus,
} from '@/lib/stripe'

/** V4-1 (vague 4) — décision fondateur, motif JURIDIQUE : débiter une carte à
 *  titre de SANCTION (pénalité no-show, walk-out impayé) exige une base
 *  contractuelle que le pilote n'a pas (information préalable, consentement
 *  exprès, droit de contestation — conseil hors budget). La capture punitive
 *  est donc INOPÉRANTE par défaut. Flag DÉDIÉ plutôt que retrait : la capacité
 *  doit pouvoir revenir après le pilote sans réécriture (le code testé reste,
 *  seule la bascule d'env change — convention maison, seul 'true' active).
 *  ⚠️ L'EMPREINTE N'EST PAS TOUCHÉE : la pré-autorisation (garantie) et sa
 *  libération (releaseHold) fonctionnent exactement comme avant. */
export function isPunitiveCaptureEnabled(): boolean {
  return process.env.PUNITIVE_CAPTURE_ENABLED === 'true'
}

export type SettleResult =
  | { ok: true;  depositStatus?: DepositStatus; capturedAmount?: number }
  | { ok: false; status: 400 | 403 | 409 | 500 | 502; error: string }

// PaymentIntent statuses that can still be cancelled (released).
const CANCELLABLE = new Set([
  'requires_capture', 'requires_payment_method', 'requires_confirmation',
  'requires_action', 'processing',
])

function fatal(err: unknown): SettleResult {
  if (err instanceof Error && err.message === 'stripe_not_configured') {
    return { ok: false, status: 500, error: 'Paiement non configuré.' }
  }
  console.error('[deposit] stripe error', err instanceof Error ? err.message : err)
  return { ok: false, status: 502, error: 'Erreur paiement, réessayez.' }
}

/** ARRIVAL: cancel the hold (nothing charged). Reads the live PI. */
export async function releaseHold(piId: string | null | undefined): Promise<SettleResult> {
  if (!piId) return { ok: true } // no hold → nothing to cancel (caller leaves depositStatus as-is)

  let status: string
  try { status = (await retrieveIntent(piId)).status } catch (err) { return fatal(err) }

  if (status === 'succeeded') {
    return { ok: false, status: 409, error: 'Empreinte déjà capturée, libération impossible.' }
  }
  if (status === 'canceled') return { ok: true, depositStatus: 'released' } // idempotent
  if (!CANCELLABLE.has(status)) {
    return { ok: false, status: 409, error: `Empreinte non annulable (état ${status}).` }
  }

  try { await releaseDeposit(piId) } catch (err) { return fatal(err) }
  return { ok: true, depositStatus: 'released' }
}

/** NO-SHOW: capture the penalty (≤ the authorised hold). Reads the live PI.
 *  V4-1 : POINT D'ÉTRANGLEMENT — le flag est vérifié ICI, dans la lib partagée,
 *  pour qu'AUCUN chemin (PATCH no-show, /deposit/capture, tickets/close, tout
 *  futur appelant) ne puisse capturer à titre de pénalité pendant le pilote. */
export async function captureHold(
  piId: string | null | undefined,
  penaltyEur: number,
  depositEur: number,
): Promise<SettleResult> {
  if (!isPunitiveCaptureEnabled()) {
    console.warn('[deposit] [V4-1] capture de pénalité REFUSÉE — PUNITIVE_CAPTURE_ENABLED est OFF (pilote) ; l\'empreinte reste intacte.')
    return { ok: false, status: 403, error: 'Capture de pénalité désactivée pendant le pilote.' }
  }
  if (!piId) return { ok: false, status: 400, error: 'Aucune empreinte à capturer.' }

  let status: string
  let amountCapturable = 0
  try {
    const pi = await retrieveIntent(piId)
    status = pi.status
    amountCapturable = pi.amount_capturable ?? 0
  } catch (err) {
    return fatal(err)
  }

  if (status === 'canceled') {
    return { ok: false, status: 409, error: 'Empreinte déjà libérée, capture impossible.' }
  }
  if (status === 'succeeded') return { ok: true, depositStatus: 'captured' } // idempotent
  if (status !== 'requires_capture') {
    return { ok: false, status: 409, error: 'Empreinte non autorisée (carte non confirmée).' }
  }

  // Penalty defaults to the full deposit; capped at what Stripe actually holds.
  const wanted = Math.min(eurosToCents(penaltyEur > 0 ? penaltyEur : depositEur), eurosToCents(depositEur))
  const captureCents = amountCapturable > 0 ? Math.min(wanted, amountCapturable) : wanted
  if (captureCents < 50) {
    return { ok: false, status: 400, error: 'Montant de pénalité trop faible.' }
  }

  try { await captureDeposit(piId, captureCents) } catch (err) { return fatal(err) }
  return { ok: true, depositStatus: 'captured', capturedAmount: captureCents }
}
