// lib/claim-console-copy.ts — T-49 round 13, slice W7: the financial-verification card's French copy, as pure functions.
//
// F14 (reconcile toasts), AMF-1 (the settled re-verification toast), H10 (the two sections outside the red heading and the
// « Avis client non envoyés » blockers) and the D4 pre-click caption. The card is French-only (it renders these literals);
// the arbitration console reads messages/*.json. Pure: no I/O, no React, and no import of lib/claims, lib/refund,
// lib/stripe or lib/claim-emails, so tests can pin every sentence per outcome instead of scanning component source.
import { R0_TOASTS, refundStillStandingToast, type ClosureKind } from '@/lib/claim-action-rules'

/** What the reconcile route returns under `result` (lib/claims ClaimEvidenceOutcome, as the console receives it). */
export type ReconcileResultPayload = {
  outcome?: string
  reason?: string
  until?: string
  evidence?: string
  payableFrom?: string
  boundRowId?: string
  stripeStatus?: string
  detail?: string
} | null | undefined

export type ConsoleToast = { text: string; needsAttention: boolean }

const frDate = (iso: string) => new Date(iso).toLocaleString('fr-FR')

/** D5 / G10: the « no conclusion before <date> » toast (unconfirmed_within_window, and F14's not_at_stripe_yet). */
export function unconfirmedWithinWindowText(until: string | null | undefined, fmt: (iso: string) => string = frDate): string {
  return `Stripe ne connaît aucun remboursement pour la ligne en attente, mais il est trop tôt pour conclure qu’il n’existera pas (fenêtre d’idempotence du moteur, plus une marge). Rien n’a été modifié. Conclusion possible à partir du ${until ? fmt(until) : '—'} : relancez alors la réconciliation.`
}

/** F14: the payableFrom of a v13 proof, or the unreadable-instant phrase in place of the date. */
export const PAYABLE_FROM_UNREADABLE = 'instant illisible — relancez la réconciliation'

/** A-S29-3: a lost compare-and-set with no bind write of this action before it. */
export const CHANGED_DURING_READ_TEXT =
  'La réclamation ou les lignes de remboursement de sa commande ont changé pendant la lecture : rien n’a été écrit. Relisez sa ligne, puis relancez si la réconciliation est encore proposée.'

/** An outcome this console does not know: nothing is confirmed (F16 (7): no exit is named). */
export const UNKNOWN_RECONCILE_OUTCOME_TEXT = 'Réponse inattendue : rien n’est confirmé. Relisez sa ligne dans la file.'

/**
 * F14: the reconcile `said` map, keyed by outcome, and its tone. needsAttention ⊇ {no_refund_proven_rail_locked,
 * no_refund_proven_awaiting_finalization (the G8 name of F14's awaiting_finalization), reverted_after_refund}.
 */
export function reconcileSaid(result: ReconcileResultPayload, fmt: (iso: string) => string = frDate): Record<string, string> {
  return {
    // F14 / G2: « Stripe rapporte » only when Stripe's refund object was read for this conclusion.
    refunded: result?.evidence === 'stripe_read'
      ? 'Preuve trouvée : Stripe rapporte ce remboursement abouti. Réclamation réconciliée sur son identité exacte.'
      : 'Réclamation réconciliée sur son identité exacte d’après notre ligne liée (Stripe n’a pas été relu pour cette conclusion ; aucun avis client ne peut partir sans relecture Stripe).',
    // F14: « redevient traitable » is replaced — the detail says whether the engine now refuses the order.
    refund_failed: 'Preuve trouvée : Stripe rapporte cette ligne de remboursement ÉCHOUÉE ; elle n’a rien versé au titre de cette ligne (cela ne dit rien des autres remboursements de la commande). Le détail enregistré dit si le moteur refuse désormais tout remboursement sur cette commande ; « Clôturer ce dossier… » enregistre votre déclaration.',
    // C1 / C9: a lost compare-and-set. The toast renders what the server returned (the row this action bound first).
    changed_during_read: result?.boundRowId
      ? `Cette action a lié la réclamation à la ligne ${result.boundRowId}, puis la réclamation a changé d’état pendant la lecture des preuves : rien d’autre n’a été écrit. Relisez sa ligne dans la file.`
      : CHANGED_DURING_READ_TEXT,
    // D4 / G8 / F14 awaiting_finalization.
    no_refund_proven_awaiting_finalization:
      'Stripe rapporte ABOUTI le remboursement d’une ligne d’une AUTRE réclamation, encore en attente dans notre base ; tant qu’elle le reste, le moteur finaliserait cette ligne au lieu de payer cette réclamation. Rien n’a été payé par cette action. Relancez « Réconcilier d’après la preuve » lorsque cette ligne ne sera plus en attente ; « Clôturer ce dossier… » reste possible.',
    still_pending: 'Stripe rapporte ce remboursement EN ATTENTE : rien n’est clos, aucun second remboursement. Relancez « Réconcilier d’après la preuve » lorsqu’il sera terminal.',
    stripe_unreadable_retry: 'Stripe n’a pas pu être lu complètement : rien n’est conclu, rien n’a été modifié. Relancez la réconciliation.',
    // F14: replaces « rien ne sera payé par Grubano ».
    engine_row_dead: 'Stripe ne connaît aucun remboursement pour cette ligne, et le moteur ne la créera plus : elle n’a rien versé. Tant qu’elle reste en attente, le moteur ne lance aucun nouveau remboursement sur cette commande. Le dossier est désormais clôturable (« Clôturer ce dossier… »).',
    // F14 (v13 only): payableFrom is the reconcile result's C4 instant; absent → the unreadable phrase in place of the date.
    // W7: the round-12 legacy branch (a proof text without an instant) is deleted — every N8 proof returns payableFrom,
    // and its sentence is forbidden (F16 (1), G2).
    no_refund_proven: `Preuve d’absence : Stripe ne rapporte aujourd’hui aucun remboursement abouti ou en attente qui ne soit expliqué (liste complète lue), et aucune ligne de la commande n’arrête le moteur. La réclamation repasse en « approuvée, non payée ». Rien ne la paiera automatiquement : une nouvelle approbation admin, réclamations et remboursements ouverts, est acceptée au plus tôt le ${result?.payableFrom ? `${result.payableFrom} (UTC)` : `(${PAYABLE_FROM_UNREADABLE})`} ; juste avant le moteur, Stripe et nos lignes sont relus, et le paiement n’est lancé que si cette relecture confirme encore la preuve.`,
    // F14, with ER-R27's qualifier (IMPLEMENTATION NOTE (W7) on F14): an ownerless FAILED external refund can hold the lock
    // (H2, A-S08a), so « aucun remboursement non expliqué » is said of refunds « abouti ou en attente » only.
    no_refund_proven_rail_locked:
      'Stripe ne rapporte aucun remboursement abouti ou en attente non expliqué sur ce paiement, MAIS une nouvelle approbation ne paierait pas cette réclamation : refus du moteur ou blocage de sûreté, la cause est dans le détail de la réclamation. Rien n’a été payé par cette action. « Clôturer ce dossier… » enregistre votre déclaration ; « Réconcilier d’après la preuve » relit la preuve si la cause peut cesser.',
    financial_verification: 'Toujours indéterminé. Aucune conclusion, aucun argent, aucune clôture. Escalade opérateur requise.',
    // G10 (W5 note): R0a's evidence may be our failed row, so the G10 wording (« d’après Stripe, ou d’après notre ligne … »)
    // is used, not F14's « Stripe rapporte que … ».
    reverted_after_refund: R0_TOASTS.reverted_after_refund,
    // F14: split by the Stripe status read; not_at_stripe_yet reuses the unconfirmed toast — never « toujours ABOUTI ou en attente ».
    refund_still_standing: result?.stripeStatus === 'not_at_stripe_yet'
      ? unconfirmedWithinWindowText(result?.until, fmt)
      : refundStillStandingToast(result?.stripeStatus),
    refunded_row_unproven: `${R0_TOASTS.refunded_row_unproven}${result?.detail ? ` Détail : ${result.detail}` : ''}`,
    unconfirmed_within_window: unconfirmedWithinWindowText(result?.until, fmt),
  }
}

const NEEDS_ATTENTION = [
  'financial_verification', 'refund_failed', 'no_refund_proven_rail_locked', 'stripe_unreadable_retry', 'unconfirmed_within_window',
  'engine_row_dead', 'changed_during_read', 'no_refund_proven_awaiting_finalization', 'reverted_after_refund', 'refunded_row_unproven',
]

/** F14: the toast of one reconcile result. An outcome the map does not know is never rendered as a success. */
export function reconcileToast(result: ReconcileResultPayload, fmt: (iso: string) => string = frDate): ConsoleToast {
  const outcome = result?.outcome ?? ''
  const said = reconcileSaid(result, fmt)
  if (!Object.prototype.hasOwnProperty.call(said, outcome)) return { text: UNKNOWN_RECONCILE_OUTCOME_TEXT, needsAttention: true }
  const stillStandingNotYet = outcome === 'refund_still_standing' && result?.stripeStatus === 'not_at_stripe_yet'
  return { text: said[outcome], needsAttention: NEEDS_ATTENTION.includes(outcome) || stillStandingNotYet }
}

// ══ AMF-1 — « Revérifier les remboursements soldés (35 jours) » ═══════════════════════════════════════════════════════

export const SETTLED_REVERIFY_BUTTON = 'Revérifier les remboursements soldés (35 jours)'
// W7 fixer (AMF-1): reverifySettledClaimRefunds has no cursor — it reads the eligible claims oldest first, and a claim still
// standing stays eligible — so no text may imply that a new pass reaches the claims a truncated pass did not read.
export const SETTLED_REVERIFY_CAPTION =
  'Relit chez Stripe, sans rien y écrire, au plus les 100 réclamations remboursées les plus anciennes des 35 derniers jours, et marque celles dont Stripe rapporte le remboursement échoué ou annulé ; lance aussi le rattrapage des réclamations en cours liées à une ligne de remboursement. Aucune action ici ne déplace d’argent.'
/** AMF-1, truncated pass: what a new pass does (the same oldest claims first), and what it does not reach. */
export const SETTLED_REVERIFY_TRUNCATED =
  'Liste incomplète : ce passage relit au plus les 100 réclamations remboursées les plus anciennes de la fenêtre ; un nouveau passage relit les mêmes en premier tant qu’elles restent soldées, et ne relit pas les plus récentes — vérifiez-les dans Stripe.'
export const NO_MONEY_HERE = 'Aucune action ici ne déplace d’argent.'

export type SettledReverifyPayload = {
  ok?: boolean
  scanned?: number
  reconciled?: number
  settledReverify?: { checked: number; reverted: number; standing: number; unreadable: number; unproven: number; truncated: boolean }
  error?: string
} | null | undefined

/** AMF-1: the toast states the settledReverify counts and « Aucune action ici ne déplace d’argent. ». */
export function settledReverifyToast(body: SettledReverifyPayload): ConsoleToast {
  const sr = body?.settledReverify
  // W7 fixer (AMF-1): `scanned` is every refunding / approved claim bound to a row with no recorded error (a pending or
  // missing row included), and `reconciled` also counts a reversal marking — so neither is qualified by « terminale ».
  const stranded = typeof body?.scanned === 'number' && typeof body?.reconciled === 'number'
    ? ` Rattrapage des réclamations en cours liées à une ligne de remboursement : ${body.reconciled} réconciliée(s) ou marquée(s) sur ${body.scanned} examinée(s).`
    : ''
  if (!sr) {
    return { text: `Revérification des remboursements soldés : aucun résultat reçu, rien n’est établi.${stranded} ${NO_MONEY_HERE}`, needsAttention: true }
  }
  // W7 fixer (AMF-1): `checked` is incremented before the read, so it includes a read that threw (counted unreadable) and a
  // lost compare-and-set: « examinée(s) », never « relue(s) chez Stripe ».
  const text = `Revérification des remboursements soldés (35 jours) : ${sr.checked} réclamation(s) examinée(s) — ${sr.reverted} marquée(s) (remboursement échoué ou annulé chez Stripe), ${sr.standing} toujours rapportée(s) aboutie(s) ou en attente, ${sr.unproven} non établie(s), ${sr.unreadable} illisible(s).${sr.truncated ? ` ${SETTLED_REVERIFY_TRUNCATED}` : ''}${stranded} ${NO_MONEY_HERE}`
  return { text, needsAttention: sr.reverted > 0 || sr.unreadable > 0 || sr.truncated }
}

// ══ D4 — the caption shown before « Réconcilier d’après la preuve » on an approved proof, lock or hold ══════════════════

export const D4_PRECLICK_CAPTION =
  'Relire la preuve peut placer la réclamation en vérification financière (si un remboursement n’y est pas rattaché ou si Stripe ne peut pas être lu entièrement) ; « Clôturer ce dossier… » n’y est alors plus proposé.'

// ══ H10 — the two sections outside the red heading ═══════════════════════════════════════════════════════════════════

export const LIST_UNREADABLE_TEXT = 'Liste illisible pour l’instant — rechargez.'

/** total null = the list could not be read (the count is unknown, never 0). */
export const refundedUnprovenHeading = (total: number | null, truncated: boolean) =>
  `Réclamations remboursées dont la ligne liée n’est pas établie (${total === null ? '?' : total}${truncated ? '+' : ''})`
/** H10 section A text. IMPLEMENTATION NOTE (W7 fixer) on H10 / E-13 (ER-C22, second half): the list also carries a same-order
 *  row whose status is none of succeeded, pending or failed, so « a un statut inconnu » joins the frozen cause list. */
export const REFUNDED_UNPROVEN_TEXT =
  'La réclamation est clôturée « remboursée », mais sa ligne liée est absente, porte sur une autre commande, est échouée sans identifiant Stripe, a un statut inconnu, ou n’a pas de montant exploitable. Quand les réclamations sont ouvertes, le client lit « Remboursement non confirmé par nos registres ». Aucune action ici ne déplace d’argent.'
export const REFUNDED_UNPROVEN_RECONCILE_CAPTION = 'relit ce remboursement chez Stripe, sans rien y écrire'
export const REFUNDED_UNPROVEN_NO_ACTION = 'Aucune action de l’application : vérifiez la commande dans Stripe.'
export const REFUNDED_UNPROVEN_TRUNCATED = 'Liste incomplète : plus de 5000 réclamations remboursées ont été parcourues.'
/** H10 (W7 fixer): both sections return at most 200 items of a larger total — the section says which part it shows. */
export const itemsCappedText = (shown: number, total: number, order: 'oldest' | 'newest') =>
  `${shown} premières affichées sur ${total} (${order === 'oldest' ? 'les plus anciennes' : 'les plus récemment clôturées'}) — les autres sont comptées dans le titre mais ne sont pas listées ici.`

export const closureNoticesHeading = (total: number | null, truncated: boolean) => `Avis client non envoyés (${total === null ? '?' : total}${truncated ? '+' : ''})`
/** H10 intro, as Track B I3 (ER-C18: this is the one intro text; E-18 adds none). */
export const CLOSURE_NOTICES_INTRO =
  'Ces réclamations ont été clôturées par cette version de l’application (remboursées, refusées ou clôturées sur déclaration), et aucun e-mail correspondant n’est enregistré comme envoyé au client : envoi en échec, e-mails désactivés, client sans adresse, réclamations fermées au moment de la clôture, relecture Stripe non concluante, ou réclamation soldée automatiquement (webhook Stripe ou récupération), qui n’envoie aucun e-mail. Les clôtures antérieures à cette version ne sont pas listées et ne recevront aucun avis. Envoyer l’avis n’agit sur aucun argent ; son contenu est tiré de la base, jamais de votre saisie. Pour une réclamation remboursée, le serveur relit d’abord le remboursement chez Stripe (sans rien y écrire) et n’envoie l’avis que si Stripe le rapporte abouti ; s’il rapporte un échec, la réclamation est marquée à la place. Rien n’est envoyé tant que les réclamations sont fermées.'
export const CLOSURE_NOTICE_BUTTON = 'Envoyer l’avis au client'
export const CLOSURE_NOTICES_TRUNCATED = 'Liste incomplète : plus de 5000 clôtures enregistrées ont été parcourues.'

export const CLOSURE_KIND_LABEL: Record<ClosureKind, string> = {
  refunded:               'Remboursée',
  settled_by_declaration: 'Clôturée sur déclaration',
  closed_by_declaration:  'Clôturée sur déclaration',
  refused_confirmed:      'Refus confirmé',
  refused_by_grubano:     'Refusée par Grubano',
}

/** H10 blockers. IMPLEMENTATION NOTE (W7) on H10 / ER-C22: refunded_row_ambiguous (two or more binders, A-S43) is listed in
 *  neither section, so its line names no section. */
export type ClosureNoticeBlocker = 'refunded_row_failed' | 'refunded_row_unproven' | 'refunded_row_ambiguous'
export const CLOSURE_BLOCKER_LINE: Record<ClosureNoticeBlocker, string> = {
  refunded_row_unproven:  'Non envoyable : la ligne de remboursement liée n’est pas établie (voir « Réclamations remboursées dont la ligne liée n’est pas établie »).',
  refunded_row_failed:    'Non envoyable : la ligne de remboursement liée est ÉCHOUÉE (voir « Vérification financière requise », où « Réconcilier d’après la preuve » la relit).',
  refunded_row_ambiguous: 'Non envoyable : la ligne de remboursement liée est liée à plusieurs réclamations — rien ne peut être annoncé au client pour aucune d’elles. Aucune action de l’application ne la rattache : vérifiez la commande dans Stripe.',
}
