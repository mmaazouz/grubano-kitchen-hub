// ── T43 (vague 3) — emails du cycle RÉCLAMATION (le minimum vital) ─────────────
//
// Constat d'exécution fondateur : le cycle réclamation n'envoyait AUCUN email —
// un client refusé ne l'apprenait jamais, et Q5 (pas de fil d'échanges) fait de
// l'email l'INTÉGRALITÉ de la relation client sur ce canal.
//
// Périmètre STRICT : (1) accusé de réception à l'ouverture, au client ;
// (2) notification de décision au client (acceptée / refusée / arbitrage).
// RIEN d'autre (pas de notification resto, pas d'email admin d'ouverture).
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
// Triggers (un par décision → « exactement 1 ligne EmailLog par décision », et
// rejouer la MÊME décision retombe sur la même clé → aucun doublon) :
//   claim_ack                    claim:<id>   ouverture
//   claim_decision_accepted      claim:<id>   resto accepte (→ arbitrage Grubano)
//   claim_decision_refused       claim:<id>   resto refuse
//   claim_decision_refunded      claim:<id>   Grubano tranche + remboursement émis
//   claim_decision_approved      claim:<id>   Grubano tranche, remboursement pas encore émis
//   claim_decision_refused_final claim:<id>   Grubano confirme le refus (définitif)

import { orderRef } from '@/lib/order-ref'
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { sendTransactional, logEmailSkipped, type SendStatus } from '@/lib/transactional-emails'
import { resolveNudgeLocale } from '@/lib/onboarding-nudge'

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')


/** Montant en euros dans la LOCALE du destinataire (revue : .toFixed(2) mettait
 *  un point décimal dans les emails FR/ES/IT). Les 5 codes sont des tags BCP-47. */
const euros = (locale: string, cents: number) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(cents / 100)

/** Revue T43 (« aucun envoi sans ligne d'audit ») : un MISS hors rail — pas de
 *  destinataire, ou panne avant sendTransactional — laisse quand même sa trace
 *  EmailLog via logEmailSkipped (lui-même best-effort, ne throw jamais). */
async function traceMiss(trigger: string, claimId: string, reason: string) {
  try { await logEmailSkipped(trigger, `claim ${claimId}`, { claimId, reason }) } catch { /* best-effort */ }
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
}): Promise<{ status: SendStatus }> {
  try {
    const consumer = await resolveConsumer(p.consumerId)
    if (!consumer) {
      await traceMiss('claim_ack', p.claimId, 'no_recipient')
      return { status: 'skipped' }
    }
    const t = await getTranslations({ locale: consumer.locale, namespace: 'claimEmails' })
    return await sendTransactional({
      to:        consumer.to,
      subject:   t('ack.subject', { ref: orderRef(p.orderId) }),
      trigger:   'claim_ack',
      dedupeKey: `claim:${p.claimId}`,
      html: claimShell({
        rtl:   consumer.locale === 'ar',
        title: t('ack.title'),
        footer: t('footer'),
        bodyHtml:
          // Revue : pas de « Bonjour , » orphelin quand Operator.name est vide.
          (consumer.name ? `<p>${esc(t('greeting', { name: consumer.name }))}</p>` : '')
          + `<p>${esc(t('ack.body', { ref: orderRef(p.orderId), euros: euros(consumer.locale, p.requestedAmountCents) }))}</p>`
          + `<p style="font-size:13px;color:#6b7280">${esc(t('ack.next'))}</p>`,
      }),
    })
  } catch (e) {
    console.error('[EMAIL MISS] [claim-emails] ack failed (non-fatal):',
      p.claimId, e instanceof Error ? e.message : e)
    await traceMiss('claim_ack', p.claimId, 'sender_error')
    return { status: 'failed' }
  }
}

// ── (1-bis) P0-08 — annulation d'une commande PAYÉE par le restaurant ──────────
// Remplace, POUR LES COMMANDES PAYÉES SEULEMENT, l'email d'annulation générique
// (qui ne disait RIEN de l'argent — constat d'exécution du 06/08). Contenu
// VÉRIDIQUE : la commande est annulée, une demande de remboursement a été
// transmise à Grubano (createSystemClaim — file d'arbitrage, réel), elle sera
// examinée par un humain (l'admin arbitre — réel, T43 notifiera la décision).
// AUCUNE promesse de remboursement déjà effectué, AUCUN délai. Même trigger
// `order_cancelled` + dedupeKey `order:<id>` que l'email générique → UNE seule
// annulation notifiée par commande, quel que soit le chemin, rejeu = duplicate.
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
          + `<p style="font-size:13px;color:#6b7280">${esc(t('orderCancelledPaid.next'))}</p>`,
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
// par le SUPPORT (traitement humain pendant la bêta) — AUCUNE promesse de
// remboursement déjà effectué, AUCUN délai. MÊME trigger `order_cancelled` +
// dedupeKey `order:<id>` que les deux emails qu'elle remplace → UNE seule
// notification d'annulation par commande, quel que soit le chemin emprunté.
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
  | 'accepted'       // le RESTAURANT accepte → transmise à Grubano (P0-24)
  | 'refused'        // le RESTAURANT refuse
  | 'refunded'       // GRUBANO tranche en faveur du client, remboursement ÉMIS
  | 'approved'       // GRUBANO tranche en faveur du client, remboursement pas encore émis
  | 'refused_final'  // GRUBANO confirme le refus — définitif

export async function sendClaimDecisionEmail(p: {
  claimId:    string
  consumerId: string
  orderId:    string
  decision:   ClaimDecisionKind
  /** Motif saisi par le décideur (resto ou admin) — affiché s'il existe. */
  reason?:        string | null
  /** Nom du restaurant (décisions resto) — dit PAR QUI la décision est prise. */
  restaurantName?: string | null
  /** Montant remboursé (décision 'refunded'), en centimes. */
  refundedCents?:  number | null
}): Promise<{ status: SendStatus }> {
  try {
    const consumer = await resolveConsumer(p.consumerId)
    if (!consumer) {
      await traceMiss(`claim_decision_${p.decision}`, p.claimId, 'no_recipient')
      return { status: 'skipped' }
    }
    const t = await getTranslations({ locale: consumer.locale, namespace: 'claimEmails' })
    const ref = orderRef(p.orderId)
    const resto = p.restaurantName ?? t('theRestaurant')
    const key = {
      accepted:      'accepted',
      refused:       'refused',
      refunded:      'refunded',
      approved:      'approved',
      refused_final: 'refusedFinal',
    }[p.decision]
    const body =
      // Revue : pas de « Bonjour , » orphelin quand Operator.name est vide.
      (consumer.name ? `<p>${esc(t('greeting', { name: consumer.name }))}</p>` : '')
      + `<p>${esc(t(`${key}.body`, { ref, resto, euros: euros(consumer.locale, p.refundedCents ?? 0) }))}</p>`
      + (p.reason ? `<p style="font-size:13px;color:#6b7280">${esc(t('reasonLabel'))} ${esc(p.reason)}</p>` : '')
      + (p.decision === 'refused' ? `<p style="font-size:13px;color:#6b7280">${esc(t('refused.contest'))}</p>` : '')
    return await sendTransactional({
      to:        consumer.to,
      subject:   t(`${key}.subject`, { ref }),
      trigger:   `claim_decision_${p.decision}`,
      dedupeKey: `claim:${p.claimId}`,
      html: claimShell({
        rtl:      consumer.locale === 'ar',
        title:    t(`${key}.title`),
        footer:   t('footer'),
        bodyHtml: body,
      }),
    })
  } catch (e) {
    console.error('[EMAIL MISS] [claim-emails] decision failed (non-fatal):',
      p.claimId, p.decision, e instanceof Error ? e.message : e)
    await traceMiss(`claim_decision_${p.decision}`, p.claimId, 'sender_error')
    return { status: 'failed' }
  }
}
