// lib/claim-email-toast.ts — ROUND 13 (H11): the operator toast for a customer e-mail result.
//
// Pure: no I/O, and no import of lib/claims, lib/refund, lib/stripe or lib/claim-emails. The consoles bundle this module,
// and H15 keeps the senders server-only; the why union below is pinned equal to lib/claim-emails' ClaimEmailWhy by a test.
// CUSTOMER_EMAIL_FR is pinned equal to messages/fr.json claims.admin.customerEmail (the financial-verification card is
// French-only, the arbitration console reads the messages).

/** The ClaimEmailWhy set of lib/claim-emails (H03), restated here so the client bundle never imports the senders. */
export type CustomerEmailWhy =
  | 'claims_disabled'
  | 'no_recipient'
  | 'smtp_disabled'
  | 'refunded_row_unproven'
  | 'refunded_row_failed'
  | 'stripe_not_confirmed'
  | 'claim_not_found'
  | 'no_closure_record'
  | 'not_a_closure'
  /**
   * D′ L8 (T-46, §16): the RESTAURANT's financial notice was withheld because the ledger cannot state the
   * figures. Restated here because this union is pinned EQUAL to lib/claim-emails' ClaimEmailWhy by a test —
   * that equality is what lets the console bundle a copy table without importing the senders (H15), so the
   * two must move together. It maps to its own toast key rather than to `notSent`: « not sent » would put it
   * with the transport failures, and this one is not a failure — the mail is correctly withheld until an
   * accounting line exists, and the operator needs to read exactly that.
   */
  | 'ledger_incomplete'
  | 'sender_error'

export type CustomerEmailKey =
  | 'sent' | 'duplicate' | 'claimsDisabled' | 'noRecipient' | 'smtpDisabled' | 'rowUnproven' | 'stripeNotConfirmed' | 'notSent' | 'failed'
export type CustomerEmailTone = 'success' | 'info' | 'error'
export type CustomerEmailLine = { tone: CustomerEmailTone; key: CustomerEmailKey }

export const CUSTOMER_EMAIL_FR: Record<CustomerEmailKey, string> = {
  sent: 'E-mail client transmis au serveur d’envoi.',
  duplicate: 'Aucun nouvel e-mail : un e-mail de même nature est déjà enregistré pour cette réclamation (envoyé ou en cours d’envoi) — vérifiez le journal e-mail.',
  claimsDisabled: 'E-mail client NON envoyé : les réclamations sont fermées, et aucun e-mail de réclamation n’est envoyé tant qu’elles le sont.',
  noRecipient: 'E-mail client NON envoyé : ce client n’a pas d’adresse e-mail enregistrée. Informez-le par un autre moyen.',
  smtpDisabled: 'E-mail client NON envoyé : l’envoi d’e-mails est désactivé sur ce serveur. Informez le client par un autre moyen.',
  // W7 (ER-C22): a row with two or more binders (A-S43) also answers refunded_row_unproven (H06 W6 note) — the cause is named.
  rowUnproven: 'E-mail client NON envoyé : la ligne de remboursement liée est absente, porte sur une autre commande, est liée à plusieurs réclamations, est échouée, n’est ni aboutie ni en attente, ou n’a pas de montant exploitable — rien ne peut être annoncé au client.',
  stripeNotConfirmed: 'E-mail client NON envoyé : Stripe n’a pas été relu, ou ne rapporte pas dans cette lecture ce remboursement comme abouti (en attente ou illisible) — rien n’est annoncé au client. Réessayez « Envoyer l’avis au client » plus tard.',
  notSent: 'E-mail client NON envoyé (trace dans le journal e-mail) : informez le client par un autre moyen.',
  failed: 'E-mail client NON envoyé (erreur lors de la préparation ou de l’envoi — trace dans le journal e-mail ou les journaux du serveur) : informez le client par un autre moyen.',
}

const SKIP_KEY: Partial<Record<CustomerEmailWhy, CustomerEmailKey>> = {
  claims_disabled:       'claimsDisabled',
  no_recipient:          'noRecipient',
  smtp_disabled:         'smtpDisabled',
  refunded_row_unproven: 'rowUnproven',
  refunded_row_failed:   'rowUnproven',
  stripe_not_confirmed:  'stripeNotConfirmed',
  // D′ L8: `ledger_incomplete` is produced by the RESTAURANT sender, whose result never reaches this
  // function — the closure-notice route returns it separately and the console renders it through
  // RESTAURANT_NOTICE_LINE, where the wording can say « restaurant » and not « client ». It is listed in the
  // union above ONLY because that union is pinned equal to lib/claim-emails' ClaimEmailWhy, which is what
  // lets the console bundle a copy table without importing the senders (H15). Mapped to the generic key so
  // the frozen 9-key H11 copy table is untouched, and so an unexpected arrival here still says « not sent »
  // rather than nothing.
  ledger_incomplete:     'notSent',
  claim_not_found:       'notSent',
  no_closure_record:     'notSent',
}

/**
 * H11 customerEmailLine: the toast for `body.customerEmail`. sent → success; duplicate → info; every other non-null key
 * → error. not_applicable, null, undefined and an unknown status → null (no toast: nothing was attempted to say).
 */
export function customerEmailLine(r: { status?: string | null; why?: string | null } | null | undefined): CustomerEmailLine | null {
  if (!r || typeof r.status !== 'string') return null
  if (r.status === 'sent') return { tone: 'success', key: 'sent' }
  if (r.status === 'duplicate') return { tone: 'info', key: 'duplicate' }
  if (r.status === 'failed') return { tone: 'error', key: 'failed' }
  if (r.status === 'skipped') {
    const key = r.why ? SKIP_KEY[r.why as CustomerEmailWhy] : undefined
    return { tone: 'error', key: key ?? 'notSent' }
  }
  return null
}
