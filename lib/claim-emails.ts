// ── T43 (vague 3) — emails du cycle RÉCLAMATION (le minimum vital) ─────────────
//
// Constat d'exécution fondateur : le cycle réclamation n'envoyait AUCUN email —
// un client refusé ne l'apprenait jamais, et Q5 (pas de fil d'échanges) fait de
// l'email l'INTÉGRALITÉ de la relation client sur ce canal.
//
// Rail : le pipeline central EXISTANT — sendTransactional(trigger, dedupeKey)
// → réclamation @@unique(trigger, dedupeKey) AVANT envoi (rejouer une décision
// = 'duplicate', zéro doublon) + EmailLog tracé. AUCUN mécanisme d'envoi inventé.
// Localisation : patron onboarding-nudge — Operator.locale (null ⇒ fr) →
// getTranslations({ locale, namespace: 'claimEmails' }), 5 locales, RTL pour ar.
//
// Ces senders sont appelés par les ROUTES en blocs ADDITIFS post-succès
// (best-effort, jamais bloquants) — la machine à états lib/claims, le moteur de
// remboursement et la logique de décision d'arbitrage sont INTOUCHÉS.
//
// Triggers (H01), all under dedupeKey claim:<id>:
//   claim_ack                    ouverture (montant demandé)
//   claim_decision_accepted      resto accepte (→ arbitrage Grubano)
//   claim_decision_refused       resto refuse
//   claim_decision_approved      Grubano tranche, remboursement pas encore émis
//   claim_decision_refunded      Grubano tranche + remboursement émis (moteur), OU avis de clôture « remboursée » (H06)
//   claim_decision_refused_final refus confirmé / refusée par Grubano (arbitrage, ou avis de clôture délégué)
//   claim_closed_by_support      avis de clôture sur déclaration (H06)
// The record trigger claim_closure_record (H05) is never sent: lib/claims writes it, this module only reads it.
//
// ROUND 13 (slice W6):
//   H02 / R-D7 — every claim sender takes `claimsOpen`, read by the caller immediately before the call: while claims are
//   closed nothing is sent, and the skip is traced (one EmailLog row « (non envoyé : claims_disabled) »).
//   H06 — sendClaimClosureEmail sends a closure notice only for a claim closed by THIS build (the H05 record), on
//   database facts and, for a refund, on Stripe's own refund object read in the same request — never an operator input.
//   H15 — this module imports only lib/claim-action-rules, lib/prisma, lib/transactional-emails, lib/order-ref,
//   lib/onboarding-nudge and next-intl/server: never lib/claims, lib/refund or lib/stripe, so no notice path can move money,
//   and the Stripe webhook (which imports lib/claims) never bundles a sender.
//   I-08 — exactly one EmailLog row per attempt that reaches a template: traceMiss when sendTransactional is never
//   reached, sendTransactional's own row otherwise. A claim that is not a closure (not_applicable) is not an attempt and
//   leaves none; a 'duplicate' leaves none (the earlier attempt's row stands).

import { orderRef } from '@/lib/order-ref'
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { sendTransactional, logEmailSkipped, type SendStatus } from '@/lib/transactional-emails'
import { resolveNudgeLocale } from '@/lib/onboarding-nudge'
import {
  claimClosureKind, refusalEmailKind, refundedRowProven, CLOSURE_TRIGGER, CLOSURE_RECORD_TRIGGER, closureRecordKey,
  type ClaimFacts, type ClosureKind,
} from '@/lib/claim-action-rules'

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')


/** Montant en euros dans la LOCALE du destinataire (revue : .toFixed(2) mettait
 *  un point décimal dans les emails FR/ES/IT). Les 5 codes sont des tags BCP-47. */
const euros = (locale: string, cents: number) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(cents / 100)

/** H03: why a claim e-mail did not go out. The closed set — I-08's no_address, not_eligible and duplicate are not in it. */
export type ClaimEmailWhy =
  | 'claims_disabled'
  | 'no_recipient'
  | 'smtp_disabled'
  | 'refunded_row_unproven'
  | 'refunded_row_failed'
  | 'stripe_not_confirmed'
  | 'claim_not_found'
  | 'no_closure_record'
  | 'not_a_closure'
  | 'sender_error'
/** H03: what a claim sender returns. */
export type ClaimEmailResult = { status: SendStatus | 'not_applicable'; why?: ClaimEmailWhy }
/** H06: the closure sender also says which closure it read. */
export type ClosureEmailResult = ClaimEmailResult & { kind: ClosureKind | null }
/** H06: evidence produced by the server in the same request — Stripe's refund object amount, never our row's. */
export type ClosureEvidence = { basis: 'stripe_read'; amountCents: number }

/** Revue T43 (« aucun envoi sans ligne d'audit ») + H11 : un MISS hors rail — sendTransactional jamais atteint —
 *  laisse sa trace EmailLog via logEmailSkipped (lui-même best-effort, ne throw jamais), avec sa raison. */
async function traceMiss(trigger: string, claimId: string, why: ClaimEmailWhy) {
  try { await logEmailSkipped(trigger, `claim ${claimId}`, { claimId, reason: why }, why) } catch { /* best-effort */ }
}

/** H02: the lease is closed — nothing is sent, one traced skip. */
async function claimsClosedSkip(trigger: string, claimId: string): Promise<ClaimEmailResult> {
  await traceMiss(trigger, claimId, 'claims_disabled')
  return { status: 'skipped', why: 'claims_disabled' }
}

/** H03: sendTransactional's answer. Its own EmailLog row exists for skipped / failed: only a console line is added. */
function transportResult(trigger: string, claimId: string, r: { status: SendStatus }): ClaimEmailResult {
  if (r.status === 'skipped') {
    console.error(`[EMAIL MISS] [${trigger}] claim ${claimId} smtp_disabled`)
    return { status: 'skipped', why: 'smtp_disabled' }
  }
  if (r.status === 'failed') {
    console.error(`[EMAIL MISS] [${trigger}] claim ${claimId} sender_error`)
    return { status: 'failed', why: 'sender_error' }
  }
  return { status: r.status }
}

/** Gabarit sobre local (patron renderNudgeHtml / admin-alerts — shell() du rail
 *  est privé ; AUCUNE refonte de gabarit, juste le strict nécessaire + RTL ar). */
function claimShell(p: { title: string; bodyHtml: string; footer: string; rtl: boolean }): string {
  return `
    <div dir="${p.rtl ? 'rtl' : 'ltr'}" style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a2e">
      <h2 style="color:#F97316">${p.title}</h2>
      ${p.bodyHtml}
      <p style="font-size:12px;color:#9ca3af;margin-top:28px">${p.footer}</p>
    </div>`
}

/** Le client (Operator) destinataire : email + prénom + locale email préférée. */
async function resolveConsumer(consumerId: string) {
  const consumer = await prisma.operator.findUnique({
    where:  { id: consumerId },
    select: { email: true, name: true, locale: true },
  })
  if (!consumer?.email) return null
  return { to: consumer.email, name: consumer.name ?? '', locale: resolveNudgeLocale(consumer.locale) }
}

// ── (1) Accusé de réception — à l'OUVERTURE d'une réclamation ──────────────────
export async function sendClaimAckEmail(p: {
  claimId:              string
  consumerId:           string
  orderId:              string
  requestedAmountCents: number
  /** H02: isClaimsEnabled() read by the caller immediately before this call. */
  claimsOpen:           boolean
}): Promise<ClaimEmailResult> {
  if (!p.claimsOpen) return claimsClosedSkip('claim_ack', p.claimId)
  try {
    const consumer = await resolveConsumer(p.consumerId)
    if (!consumer) {
      await traceMiss('claim_ack', p.claimId, 'no_recipient')
      return { status: 'skipped', why: 'no_recipient' }
    }
    const t = await getTranslations({ locale: consumer.locale, namespace: 'claimEmails' })
    const ref = orderRef(p.orderId)
    const r = await sendTransactional({
      to:        consumer.to,
      subject:   t('ack.subject', { ref }),
      trigger:   'claim_ack',
      dedupeKey: `claim:${p.claimId}`,
      html: claimShell({
        rtl:   consumer.locale === 'ar',
        title: t('ack.title'),
        footer: t('footer'),
        bodyHtml:
          // Revue : pas de « Bonjour , » orphelin quand Operator.name est vide.
          (consumer.name ? `<p>${esc(t('greeting', { name: consumer.name }))}</p>` : '')
          + `<p>${esc(t('ack.body', { ref, euros: euros(consumer.locale, p.requestedAmountCents) }))}</p>`
          // H12: ack.next promises no later e-mail and carries the reference.
          + `<p style="font-size:13px;color:#6b7280">${esc(t('ack.next', { ref }))}</p>`,
      }),
    })
    return transportResult('claim_ack', p.claimId, r)
  } catch (e) {
    console.error('[EMAIL MISS] [claim-emails] ack failed (non-fatal):',
      p.claimId, e instanceof Error ? e.message : e)
    await traceMiss('claim_ack', p.claimId, 'sender_error')
    return { status: 'failed', why: 'sender_error' }
  }
}

// ── (1-bis) P0-08 — annulation d'une commande PAYÉE par le restaurant ──────────
// Remplace, POUR LES COMMANDES PAYÉES SEULEMENT, l'email d'annulation générique
// (qui ne disait RIEN de l'argent — constat d'exécution du 06/08). Contenu
// VÉRIDIQUE : la commande est annulée, une demande de remboursement a été
// transmise à Grubano (createSystemClaim — file d'arbitrage, réel).
// AUCUNE promesse de remboursement déjà effectué, AUCUN délai, AUCUNE promesse d'un
// e-mail ultérieur (H12). Même trigger `order_cancelled` + dedupeKey `order:<id>` que
// l'email générique → UNE seule annulation notifiée par commande, rejeu = duplicate.
// Not a claim e-mail (H13): the ROUTE chooses this variant only while the lease is still open at send time.
export async function sendOrderCancelledPaidEmail(p: {
  orderId:        string
  consumerId:     string
  restaurantName: string
  /** Revue P0-08 : true = AUCUNE demande système créée (une réclamation était
   *  déjà ACTIVE sur la commande) — le corps dit alors que la réclamation EN
   *  COURS porte la question du remboursement, au lieu d'annoncer une demande
   *  qui n'existe pas. */
  existingClaim?: boolean
}): Promise<{ status: SendStatus }> {
  try {
    const consumer = await resolveConsumer(p.consumerId)
    if (!consumer) {
      await traceMiss('order_cancelled', p.orderId, 'no_recipient')
      return { status: 'skipped' }
    }
    const t = await getTranslations({ locale: consumer.locale, namespace: 'claimEmails' })
    const ref = orderRef(p.orderId)
    return await sendTransactional({
      to:        consumer.to,
      subject:   t('orderCancelledPaid.subject', { ref }),
      trigger:   'order_cancelled',
      dedupeKey: `order:${p.orderId}`,
      html: claimShell({
        rtl:    consumer.locale === 'ar',
        title:  t('orderCancelledPaid.title'),
        footer: t('footer'),
        bodyHtml:
          (consumer.name ? `<p>${esc(t('greeting', { name: consumer.name }))}</p>` : '')
          + `<p>${esc(t(p.existingClaim ? 'orderCancelledPaid.bodyExisting' : 'orderCancelledPaid.body', { ref, resto: p.restaurantName }))}</p>`
          + `<p style="font-size:13px;color:#6b7280">${esc(t('orderCancelledPaid.next', { ref }))}</p>`,
      }),
    })
  } catch (e) {
    console.error('[EMAIL MISS] [claim-emails] cancelled-paid failed (non-fatal):',
      p.orderId, e instanceof Error ? e.message : e)
    await traceMiss('order_cancelled', p.orderId, 'sender_error')
    return { status: 'failed' }
  }
}

// ── (1-ter) LOT C (P-1 M7) — annulation d'une commande PAYÉE, CLAIMS OFF ───────
// Réglage bêta (décision fondateur D4) : CLAIMS_ENABLED=false → l'annulation
// d'une commande payée ne crée AUCUNE demande système. L'email (1-bis) ci-dessus
// MENTIRAIT (« demande transmise ») et le générique de lib/transactional-emails
// est muet sur l'argent (« contactez directement le restaurant »). Cette variante
// dit la vérité opérationnelle : commande payée annulée, remboursement instruit
// par le SUPPORT — AUCUNE promesse de remboursement déjà effectué, AUCUN délai, et
// AUCUNE réclamation nommée : elle reste vraie qu'une demande système cachée existe
// ou non (H13). MÊME trigger `order_cancelled` + dedupeKey `order:<id>` que les deux
// emails qu'elle remplace → UNE seule notification d'annulation par commande.
export async function sendOrderCancelledPaidOffEmail(p: {
  orderId:        string
  consumerId:     string
  restaurantName: string
}): Promise<{ status: SendStatus }> {
  try {
    const consumer = await resolveConsumer(p.consumerId)
    if (!consumer) {
      await traceMiss('order_cancelled', p.orderId, 'no_recipient')
      return { status: 'skipped' }
    }
    const t = await getTranslations({ locale: consumer.locale, namespace: 'claimEmails' })
    const ref = orderRef(p.orderId)
    return await sendTransactional({
      to:        consumer.to,
      subject:   t('orderCancelledPaidOff.subject', { ref }),
      trigger:   'order_cancelled',
      dedupeKey: `order:${p.orderId}`,
      html: claimShell({
        rtl:    consumer.locale === 'ar',
        // Le titre du gabarit réutilise la clé existante « Commande annulée »
        // (orderCancelledPaid.title, déjà traduite ×5) — le sujet porte l'angle argent.
        title:  t('orderCancelledPaid.title'),
        footer: t('footer'),
        bodyHtml:
          (consumer.name ? `<p>${esc(t('greeting', { name: consumer.name }))}</p>` : '')
          + `<p>${esc(t('orderCancelledPaidOff.body', { ref, resto: p.restaurantName }))}</p>`
          + `<p style="font-size:13px;color:#6b7280">${esc(t('orderCancelledPaidOff.next', { ref }))}</p>`,
      }),
    })
  } catch (e) {
    console.error('[EMAIL MISS] [claim-emails] cancelled-paid-off failed (non-fatal):',
      p.orderId, e instanceof Error ? e.message : e)
    await traceMiss('order_cancelled', p.orderId, 'sender_error')
    return { status: 'failed' }
  }
}

// ── (2) Notification de DÉCISION au client ─────────────────────────────────────
export type ClaimDecisionKind =
  | 'accepted'           // le RESTAURANT accepte → transmise à Grubano (P0-24)
  | 'refused'            // le RESTAURANT refuse
  | 'refunded'           // GRUBANO tranche en faveur du client, remboursement ÉMIS (moteur, H03)
  | 'approved'           // GRUBANO tranche en faveur du client, remboursement pas encore émis
  | 'refused_final'      // GRUBANO confirme le refus DU RESTAURANT — définitif (kind refused_confirmed only)
  | 'refused_by_grubano' // GRUBANO refuse, sans refus du restaurant au dossier — définitif (H03, F02)

/** H03: the trigger of each decision kind — also the tag of every traceMiss. */
export const DECISION_TRIGGER: Record<ClaimDecisionKind, string> = {
  accepted:           'claim_decision_accepted',
  refused:            'claim_decision_refused',
  refunded:           'claim_decision_refunded',
  approved:           'claim_decision_approved',
  refused_final:      'claim_decision_refused_final',
  refused_by_grubano: 'claim_decision_refused_final',
}

/** The template keys of each decision kind. refused_by_grubano reuses the final-decision subject (H03). */
const DECISION_TEMPLATE: Record<ClaimDecisionKind, { subject: string; title: string; body: string }> = {
  accepted:           { subject: 'accepted.subject',     title: 'accepted.title',         body: 'accepted.body' },
  refused:            { subject: 'refused.subject',      title: 'refused.title',          body: 'refused.body' },
  refunded:           { subject: 'refunded.subject',     title: 'refunded.title',         body: 'refunded.body' },
  approved:           { subject: 'approved.subject',     title: 'approved.title',         body: 'approved.body' },
  refused_final:      { subject: 'refusedFinal.subject', title: 'refusedFinal.title',     body: 'refusedFinal.body' },
  refused_by_grubano: { subject: 'refusedFinal.subject', title: 'refusedByGrubano.title', body: 'refusedByGrubano.body' },
}

export async function sendClaimDecisionEmail(p: {
  claimId:    string
  consumerId: string
  orderId:    string
  decision:   ClaimDecisionKind
  /** Motif saisi par le décideur (resto ou admin) — affiché s'il existe. */
  reason?:        string | null
  /** Nom du restaurant (décisions resto) — dit PAR QUI la décision est prise. */
  restaurantName?: string | null
  /** Montant remboursé (décision 'refunded'), en centimes — celui du moteur, jamais le montant demandé. */
  refundedCents?:  number | null
  /** H02: isClaimsEnabled() read by the caller immediately before this call. */
  claimsOpen:      boolean
}): Promise<ClaimEmailResult> {
  const trigger = DECISION_TRIGGER[p.decision]
  if (!p.claimsOpen) return claimsClosedSkip(trigger, p.claimId)
  try {
    const consumer = await resolveConsumer(p.consumerId)
    if (!consumer) {
      await traceMiss(trigger, p.claimId, 'no_recipient')
      return { status: 'skipped', why: 'no_recipient' }
    }
    const t = await getTranslations({ locale: consumer.locale, namespace: 'claimEmails' })
    const ref = orderRef(p.orderId)
    const resto = p.restaurantName ?? t('theRestaurant')
    const tpl = DECISION_TEMPLATE[p.decision]
    const body =
      // Revue : pas de « Bonjour , » orphelin quand Operator.name est vide.
      (consumer.name ? `<p>${esc(t('greeting', { name: consumer.name }))}</p>` : '')
      + `<p>${esc(t(tpl.body, { ref, resto, euros: euros(consumer.locale, p.refundedCents ?? 0) }))}</p>`
      + (p.reason ? `<p style="font-size:13px;color:#6b7280">${esc(t('reasonLabel'))} ${esc(p.reason)}</p>` : '')
      // H12: the contest sentence is conditional (the 48 h window or a closed lease can withhold it) and carries the reference.
      + (p.decision === 'refused' ? `<p style="font-size:13px;color:#6b7280">${esc(t('refused.contest', { ref }))}</p>` : '')
    const r = await sendTransactional({
      to:        consumer.to,
      subject:   t(tpl.subject, { ref }),
      trigger,
      dedupeKey: `claim:${p.claimId}`,
      html: claimShell({
        rtl:      consumer.locale === 'ar',
        title:    t(tpl.title),
        footer:   t('footer'),
        bodyHtml: body,
      }),
    })
    return transportResult(trigger, p.claimId, r)
  } catch (e) {
    console.error('[EMAIL MISS] [claim-emails] decision failed (non-fatal):',
      p.claimId, p.decision, e instanceof Error ? e.message : e)
    await traceMiss(trigger, p.claimId, 'sender_error')
    return { status: 'failed', why: 'sender_error' }
  }
}

// ── (3) ROUND 13 (H06) — AVIS DE CLÔTURE ─────────────────────────────────────────
/** The EmailLog tag of a notice attempt whose closure kind was not read (claim missing, or a failed read). */
const CLOSURE_NOTICE_UNREAD_TRIGGER = 'claim_closure_notice'
/** F03 (binders): the claims bound to a row that count as its owners — a resume_mismatch binding is disowned. */
const binderWhere = (rowId: string) => ({
  refundId: rowId,
  OR: [{ refundError: null }, { NOT: { refundError: { startsWith: 'resume_mismatch' } } }],
})

/**
 * H06 sendClaimClosureEmail. It receives only a claim id, evidence the SERVER produced in this request, and the gate —
 * never an operator amount, outcome or note. Check order:
 *   (1) the claim → claim_not_found; (2) its closure kind → not_applicable (REVERTED_AFTER_REFUND included);
 *   (3) THE closure record of this build (H05, AMF-2 — never AdminAuditLog) → no_closure_record;
 *   (4) the gate → claims_disabled; (5) refusal kinds → the decision sender, kind from provenance, reason from the DB;
 *   (6) refunded → the bound row: failed → refunded_row_failed; not proven, or two or more binders → refunded_row_unproven;
 *   (7) refunded → Stripe evidence: an integer amount > 0 read at Stripe, else stripe_not_confirmed; equal to the row's
 *       amount → refundedLinked (with the amount), otherwise refundRecorded (no amount);
 *   (8) the recipient → no_recipient; (9) declarations → closedBySupport (no refund sentence, no amount, no note);
 *   (10) sendTransactional under CLOSURE_TRIGGER[kind], claim:<id>.
 * It never throws.
 */
export async function sendClaimClosureEmail(p: {
  claimId:    string
  evidence?:  ClosureEvidence
  /** H02: isClaimsEnabled() read by the caller immediately before this call. */
  claimsOpen: boolean
}): Promise<ClosureEmailResult> {
  let trigger = CLOSURE_NOTICE_UNREAD_TRIGGER
  let kind: ClosureKind | null = null
  const skip = async (why: ClaimEmailWhy): Promise<ClosureEmailResult> => {
    await traceMiss(trigger, p.claimId, why)
    return { status: 'skipped', kind, why }
  }
  try {
    // (1)
    const c = await prisma.claim.findUnique({
      where:  { id: p.claimId },
      select: {
        id: true, status: true, consumerId: true, orderId: true, refundId: true, refundError: true,
        arbitrationDecision: true, restaurantResponse: true, arbitrationReason: true,
      },
    })
    if (!c) return await skip('claim_not_found')
    // (2)
    kind = claimClosureKind(c as ClaimFacts)
    if (!kind) return { status: 'not_applicable', kind: null, why: 'not_a_closure' }
    trigger = CLOSURE_TRIGGER[kind]
    // (3) H05 / AMF-2: the only eligibility source. A legacy closure has none and is never sent (R-D6 (d), E-18).
    const record = await prisma.emailDispatch.findFirst({
      where:  { trigger: CLOSURE_RECORD_TRIGGER, dedupeKey: closureRecordKey(c.id) },
      select: { id: true },
    })
    if (!record) return await skip('no_closure_record')
    // (4) R-D7
    if (!p.claimsOpen) return await skip('claims_disabled')
    // (5) the refusal notice is the decision e-mail of its kind.
    if (kind === 'refused_confirmed' || kind === 'refused_by_grubano') {
      const r = await sendClaimDecisionEmail({
        claimId:    c.id,
        consumerId: c.consumerId,
        orderId:    c.orderId,
        decision:   refusalEmailKind(c as ClaimFacts),
        reason:     c.arbitrationReason ?? null,
        claimsOpen: p.claimsOpen,
      })
      return { ...r, kind }
    }
    let linkedCents: number | null = null
    if (kind === 'refunded') {
      // (6) F03 on the bound row, and the binder count of A-S43.
      const row = c.refundId
        ? await prisma.refund.findUnique({ where: { id: c.refundId }, select: { orderId: true, status: true, amountCents: true, stripeRefundId: true } })
        : null
      // IMPLEMENTATION NOTE (W6) on H06 step 6: the binder count precedes the failed-row check. A row with two or more
      // binders (A-S43) is not this claim's evidence whatever its status, and the customer reads the manual review there
      // (F03 refundedRowTruth null) — so the sender answers refunded_row_unproven, the J-C25 parity. Both answers map to
      // the same operator toast (rowUnproven).
      const binders = c.refundId ? await prisma.claim.count({ where: binderWhere(c.refundId) }) : 0
      if (binders >= 2) return await skip('refunded_row_unproven')
      if (row && row.status === 'failed') return await skip('refunded_row_failed')
      if (!row || !refundedRowProven(row, c.orderId)) return await skip('refunded_row_unproven')
      // (7) Stripe's refund object, read in this request — never row.amountCents.
      const ev = p.evidence
      if (!ev || ev.basis !== 'stripe_read' || !Number.isInteger(ev.amountCents) || ev.amountCents <= 0) {
        return await skip('stripe_not_confirmed')
      }
      linkedCents = ev.amountCents === row.amountCents ? ev.amountCents : null
    }
    // (8)
    const consumer = await resolveConsumer(c.consumerId)
    if (!consumer) return await skip('no_recipient')
    const t = await getTranslations({ locale: consumer.locale, namespace: 'claimEmails' })
    const ref = orderRef(c.orderId)
    // (9) declarations → closedBySupport; refunded → linked (Stripe amount = row amount) or recorded (no amount).
    const tpl = kind === 'refunded'
      ? (linkedCents !== null
        ? { subject: t('refunded.subject', { ref }), title: t('refunded.title'), body: t('refundedLinked.body', { ref, euros: euros(consumer.locale, linkedCents) }), next: t('refundedLinked.next', { ref }) }
        : { subject: t('refundRecorded.subject', { ref }), title: t('refundRecorded.title'), body: t('refundRecorded.body', { ref }), next: t('refundRecorded.next', { ref }) })
      : { subject: t('closedBySupport.subject', { ref }), title: t('closedBySupport.title'), body: t('closedBySupport.body', { ref }), next: t('closedBySupport.next', { ref }) }
    // (10)
    const r = await sendTransactional({
      to:        consumer.to,
      subject:   tpl.subject,
      trigger,
      dedupeKey: `claim:${c.id}`,
      html: claimShell({
        rtl:      consumer.locale === 'ar',
        title:    tpl.title,
        footer:   t('footer'),
        bodyHtml:
          (consumer.name ? `<p>${esc(t('greeting', { name: consumer.name }))}</p>` : '')
          + `<p>${esc(tpl.body)}</p>`
          + `<p style="font-size:13px;color:#6b7280">${esc(tpl.next)}</p>`,
      }),
    })
    return { ...transportResult(trigger, c.id, r), kind }
  } catch (e) {
    console.error('[EMAIL MISS] [claim-emails] closure notice failed (non-fatal):',
      p.claimId, e instanceof Error ? e.message : e)
    await traceMiss(trigger, p.claimId, 'sender_error')
    return { status: 'failed', kind, why: 'sender_error' }
  }
}
