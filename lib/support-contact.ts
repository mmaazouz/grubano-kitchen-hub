// lib/support-contact.ts — PRE-L11 (founder arbitration T-78): ONE place that names the support channel.
//
// WHY THIS FILE EXISTS. The CGV had to point the customer at a way to reach us, and the founder's ruling was
// exact: « pour la bêta/staging, les CGV doivent pointer vers le CONTACT SUPPORT DÉJÀ CONFIGURÉ dans
// l'application. Réutilise la source de vérité existante du support. Ne crée pas une deuxième adresse en dur. »
//
// THE PROBLEM THAT SENTENCE NAMES. There was no single source. The same address was written, independently, in:
//   • lib/transactional-emails.ts — the `FROM` of every transactional e-mail, and the footer tells the customer
//     they may reply to it, so it IS the support channel in practice;
//   • messages/*.json `eat.help.refundOffBody` — « Écrivez-nous à contact@grubano.com », inside the sentence,
//     in five locales (so the address is fossilised in four translations);
//   • components/business/PartnerShell.tsx — a `mailto:` in the partner footer;
//   • four route files as the fallback of `process.env.SMTP_USER`.
// Adding a fifth literal for the CGV is exactly what the founder forbade. So this module declares it ONCE and
// the CGV reads it. It is the beginning of a migration, not a new fact: the value is the address the product
// already publishes, and the places above are recorded in T-85 rather than rewritten in a legal lot.
//
// WHY NOT `process.env.SMTP_USER`. That is an SMTP LOGIN. On o2switch it can legitimately be a mailbox name
// that is not the public address, and publishing a login on a legal page is the kind of small leak nobody
// notices until it matters. A published contact address is a DECISION, so it lives as a constant a human can
// read and change — not as whatever the mail transport happens to authenticate with.
//
// WHAT THIS IS NOT. It is not a legal identity. `LEGAL_INFO.editor.email` stays an unfilled placeholder,
// because the editor's contact on the mentions légales is a company fact the founder must supply and §12
// forbids inventing one — see T-78 in docs/ops/GO-LIVE-TICKETS.md. A support channel and a legal contact are
// two different things; the CGV state the first and link to the second.
//
// A LEAF: zero imports, so any surface may read it.

/**
 * The public support address the product already publishes to customers.
 *
 * Kept byte-identical to the address in `eat.help.refundOffBody` and in `lib/transactional-emails`'s `FROM`.
 * A test asserts that equality, so this constant cannot drift away from what the app actually tells people.
 */
export const SUPPORT_EMAIL = 'contact@grubano.com'

/** `mailto:` for a link. No subject, no body: a prefilled subject is a product decision, not a legal one. */
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`
