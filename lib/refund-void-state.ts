// lib/refund-void-state.ts — MODE B commit B : l'ÉTAT « ligne libérée », sans aucune dépendance.
//
// FEUILLE VOLONTAIRE (zéro import). lib/claims.ts doit pouvoir reconnaître une ligne libérée sans
// importer le prouveur (lib/refund-row-void.ts), qui lui-même importe lib/claims.ts pour réutiliser
// refundRowTruth. Séparer l'ÉTAT du PROUVEUR casse ce cycle.
//
// L'ÉTAT. Le défaut prouvé en Phase 1 : le moteur insère une ligne `Refund` 'pending' AVANT d'appeler
// Stripe ; si Stripe ne crée jamais rien (processus tué, rejet terminal), la ligne reste 'pending' à
// vie et sa clé @unique `refund:<orderId>:<cumul>` — le CURSEUR DE CUMUL — reste prise, ce qui tue le
// rail de remboursement de la commande (P2002 sur toute tentative, quel que soit le montant).
//
// LA LIBÉRATION n'invente PAS un quatrième statut : elle écrit la PAIRE (status 'failed',
// stripeRefundId NULL) et marque la clé. Pourquoi la paire plutôt qu'un statut neuf : la cascade de
// lib/claims.ts se termine par un `else` qui rendrait un statut inconnu comme « Remboursement réussi
// chez Stripe » — un statut neuf échouerait OUVERT chez tout lecteur oublié. La paire échoue FERMÉE
// partout (« ne verse rien », aucun e-mail, `refunded_row_unproven`).
//
// LE TROISIÈME DISCRIMINANT est la marque de clé : une ligne (failed, NULL) SANS marque est une ligne
// historique quelconque (il en existe en fixture) et ne doit JAMAIS être lue comme libérée.
//
// CE QUE « libérée » VEUT DIRE, exactement : il est PROUVÉ qu'aucun remboursement Stripe n'a jamais
// existé pour cette ligne ⇒ elle n'a rien versé au client ⇒ elle ne doit plus bloquer la commande.
// Ce n'est PAS « Stripe a échoué » (cela, c'est la paire (failed, re_…), qui verrouille la commande
// via E2 et garde son chemin humain intact).

/** Marque insérée dans idempotencyKey. La clé de base est ainsi libérée pour un nouveau cumul. */
export const VOID_KEY_MARK = ':void:'

/**
 * Âge minimal avant libération = 26 h.
 * 20 h (RESUME_CREATE_WINDOW_MS, lib/refund.ts) : au-delà, driveRefund LÈVE ResumeIdempotencyExpired
 *   avant tout create ⇒ aucune création concurrente ne peut exister sous cette clé.
 * + 1 h (ENGINE_DEAD_MARGIN_MS, lib/claims.ts) : au-delà, refundRowTruth dit `absent_dead` ⇒ on ne
 *   libère QUE ce que le moteur a définitivement abandonné.
 * + 5 h de marge : Stripe documente une rétention d'idempotence « d'au moins 24 h » — un PLANCHER,
 *   jamais une garantie de purge. Si Stripe tient encore la clé, la tentative suivante REJOUE
 *   l'erreur d'origine : sûr (aucun second remboursement), mais une nouvelle ligne peut se bloquer.
 *   Ce n'est donc pas éliminé : c'est borné, détecté, documenté et la sortie est répétable.
 * Un test épingle 26 h ≥ RESUME_CREATE_WINDOW_MS + ENGINE_DEAD_MARGIN_MS + 4 h et > 24 h.
 */
export const VOID_MIN_AGE_MS = 26 * 60 * 60 * 1000

/** Une clé de cumul NON marquée : `refund:<orderId>:<cumulCents>`. */
export const REFUND_CURSOR_KEY = /^refund:([^:]+):(\d+)$/

/** Marque la clé — la clé de base redevient libre pour une nouvelle tentative au même cumul. */
export function voidedKey(base: string, at: Date): string {
  return `${base}${VOID_KEY_MARK}${at.toISOString()}`
}

/** Les TROIS discriminants. Une ligne historique (failed, NULL) sans marque n'est PAS libérée. */
export function isReleasedRow(row: { status: string; stripeRefundId: string | null; idempotencyKey?: string | null } | null | undefined): boolean {
  if (!row) return false
  return row.status === 'failed' && row.stripeRefundId === null && (row.idempotencyKey ?? '').includes(VOID_KEY_MARK)
}
