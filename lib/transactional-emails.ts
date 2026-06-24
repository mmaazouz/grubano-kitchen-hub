import nodemailer from 'nodemailer'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

// ── Transactional emails v1 (Agent 13) ─────────────────────────────────────────
//
// ONE shared transport + ONE best-effort sender + the v1 templates (FR only,
// sober design matching the consumer welcome email of app/api/auth/register).
//
// Transport = the app-wide convention (same as partners/register, suppliers,
// email-agent, auth/register): port 587 hardcoded, secure:false, only
// SMTP_HOST / SMTP_USER / SMTP_PASS are read, from "Grubano" <contact@grubano.com>.
// No new env var, no new dependency.
//
// GOLDEN RULES:
//   - Sending is ALWAYS post-success and BEST-EFFORT: sendTransactional() never
//     throws. A failure logs `[EMAIL MISS]` with a re-sendable context (trigger,
//     recipient, subject, payload) + an EmailLog row (sent | failed | skipped).
//   - NEVER called from the Stripe webhook.

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'mail.grubano.com',
  port:   587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'contact@grubano.com',
    pass: process.env.SMTP_PASS,
  },
})

const FROM = '"Grubano" <contact@grubano.com>'

/** fr-FR date+time label pinned to the establishment timezone (Europe/Paris),
 *  server-TZ independent — "mercredi 11 juin à 19:30". */
export function formatDateFr(d: Date): string {
  try {
    const date = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long',
    }).format(d)
    const time = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit',
    }).format(d)
    return `${date} à ${time}`
  } catch {
    return d.toISOString()
  }
}

/** Euro label from CENTS — "12,50 €". */
export function eurosFromCents(cents: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

/** Sober shell shared by every template — mirrors the welcome email's design
 *  (Inter stack, navy text, orange accents, 480px column). */
function shell(title: string, bodyHtml: string): string {
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a2e">
      <h2 style="color:#F97316">${title}</h2>
      ${bodyHtml}
      <p style="font-size:12px;color:#9ca3af;margin-top:28px">Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.</p>
    </div>`
}

const row = (label: string, value: string) =>
  `<tr>
     <td style="padding:6px 12px 6px 0;font-size:13px;color:#6b7280;white-space:nowrap">${label}</td>
     <td style="padding:6px 0;font-size:13px;font-weight:600;color:#1a1a2e">${value}</td>
   </tr>`

const table = (rows: string) =>
  `<table style="border-collapse:collapse;margin:14px 0">${rows}</table>`

/** Minimal HTML escaping for user-provided strings injected in templates. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Recipient resolution + traced skip (Emails v2, FIX 1) ───────────────────────

/** Client-destined reservation emails: the reservation's typed email when
 *  present, OTHERWISE the linked consumer ACCOUNT's email (userId →
 *  Operator.email — same source as order_confirmation). null = nobody. */
export async function resolveReservationRecipient(r: {
  email: string | null
  userId: string | null
}): Promise<string | null> {
  if (r.email) return r.email
  if (!r.userId) return null
  try {
    const account = await prisma.operator.findUnique({
      where:  { id: r.userId },
      select: { email: true },
    })
    return account?.email ?? null
  } catch {
    return null
  }
}

/** No recipient at all → we still leave a TRACE (EmailLog status='skipped')
 *  so a silently-missing send is visible in the audit table. */
export async function logEmailSkipped(trigger: string, subject: string, context: Record<string, unknown>): Promise<void> {
  console.error(`[EMAIL MISS] [${trigger}] no recipient — SKIPPED`, JSON.stringify(context))
  try {
    await prisma.emailLog.create({
      data: { recipient: '(aucun destinataire)', subject, trigger, status: 'skipped' },
    })
  } catch { /* audit log is best-effort */ }
}

// ── Core best-effort sender ─────────────────────────────────────────────────────

export type SendStatus = 'sent' | 'skipped' | 'failed' | 'duplicate'

export async function sendTransactional(opts: {
  to:      string
  subject: string
  html:    string
  /** EmailLog trigger key — also the [EMAIL MISS] context tag. */
  trigger: string
  /** Email B0 (Agent 141) — when set, the send is IDEMPOTENT: a prior (trigger,dedupeKey)
   *  already claimed in EmailDispatch → return {status:'duplicate'} WITHOUT resending.
   *  Race-safe via the @@unique([trigger,dedupeKey]) constraint (a unique INSERT, not a
   *  read-then-write). Omitted → unchanged behaviour (always sends + logs, as before). */
  dedupeKey?: string
}): Promise<{ status: SendStatus }> {
  // ── Idempotency claim (race-safe) ──────────────────────────────────────────
  // Claim BEFORE sending via a UNIQUE INSERT: concurrent callers race here and exactly
  // one wins; the losers get P2002 → 'duplicate' (no send). A non-P2002 failure (e.g. the
  // table not yet db-pushed → P2021) DEGRADES to a normal send so a real transactional
  // email is never swallowed by an idempotency-store hiccup. Never throws to the caller.
  if (opts.dedupeKey) {
    try {
      await prisma.emailDispatch.create({ data: { trigger: opts.trigger, dedupeKey: opts.dedupeKey } })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { status: 'duplicate' } // already dispatched → skip cleanly, never resend
      }
      console.error(`[EMAIL DEDUP] [${opts.trigger}] claim failed — sending WITHOUT idempotency`,
        JSON.stringify({ dedupeKey: opts.dedupeKey }), err instanceof Error ? err.message : err)
      // fall through: degrade to a normal (non-deduped) send
    }
  }

  let status: Exclude<SendStatus, 'duplicate'> = 'sent'
  try {
    if (!process.env.SMTP_PASS) {
      status = 'skipped'
      console.error(`[EMAIL MISS] [${opts.trigger}] SMTP_PASS missing — SKIPPED`, JSON.stringify({ to: opts.to, subject: opts.subject }))
    } else {
      await transporter.sendMail({ from: FROM, to: opts.to, subject: opts.subject, html: opts.html })
    }
  } catch (err) {
    status = 'failed'
    // Re-sendable context: trigger + recipient + subject (the payload is
    // reconstructible from the DB ids logged by each call-site).
    console.error(`[EMAIL MISS] [${opts.trigger}] send FAILED`,
      JSON.stringify({ to: opts.to, subject: opts.subject }),
      err instanceof Error ? err.message : err)
  }
  try {
    await prisma.emailLog.create({
      data: { recipient: opts.to, subject: opts.subject, trigger: opts.trigger, status },
    })
  } catch { /* audit log is best-effort */ }

  // Release the idempotency claim when the email did NOT actually go out (failed / skipped),
  // so a later attempt can re-send instead of being permanently suppressed (best-effort).
  if (opts.dedupeKey && status !== 'sent') {
    try {
      await prisma.emailDispatch.deleteMany({ where: { trigger: opts.trigger, dedupeKey: opts.dedupeKey } })
    } catch { /* best-effort: the registry release is non-critical */ }
  }

  return { status }
}

// ── sendOnce — idempotent transactional send (Email B0, Agent 141) ──────────────
// Named convenience over sendTransactional({dedupeKey}): a 2nd call with the same
// (trigger, dedupeKey) returns {status:'duplicate'} WITHOUT resending. Race-safe
// (DB unique constraint, not findFirst) + best-effort (never throws to the caller).
export async function sendOnce(
  trigger:   string,
  dedupeKey: string,
  email:     { to: string; subject: string; html: string },
): Promise<{ status: SendStatus }> {
  return sendTransactional({ to: email.to, subject: email.subject, html: email.html, trigger, dedupeKey })
}

// ── 1) Reservation confirmation (consumer booking) ──────────────────────────────

export async function sendReservationConfirmation(p: {
  dedupeKey?:     string  // Email B0 (Agent 141) — at-most-once when set (e.g. `resv:<id>`)
  to:             string
  customerName:   string
  restaurantName: string
  date:           Date
  guests:         number
  /** Short session code (#XXXX) — derived by the caller via lib/reservation-code. */
  code:           string
  /** Euros (reservation.depositAmount). 0 = no empreinte mention. */
  depositEur:     number
}): Promise<void> {
  const rows =
    row('Restaurant', esc(p.restaurantName)) +
    row('Date', formatDateFr(p.date)) +
    row('Couverts', String(p.guests)) +
    row('N° de session', esc(p.code))
  const deposit = p.depositEur > 0
    ? `<p style="font-size:13px;color:#6b7280">Une empreinte de ${p.depositEur.toFixed(2).replace('.', ',')} € est associée à cette réservation —
       elle reste active jusqu’au paiement de l’addition et est libérée automatiquement au paiement.
       Vous ne serez débité qu’en cas de no-show ou de départ sans règlement de l’addition.</p>`
    : ''
  await sendTransactional({
    to:      p.to,
    subject: `Réservation confirmée — ${p.restaurantName}`,
    trigger: 'reservation_confirmation',
    dedupeKey: p.dedupeKey,
    html: shell(`Réservation confirmée ✓`, `
      <p>Bonjour ${esc(p.customerName)}, votre table est réservée.</p>
      ${table(rows)}
      ${deposit}
      <p style="font-size:13px;color:#6b7280">Présentez simplement votre nom (ou votre n° de session) à votre arrivée.</p>`),
  })
}

// ── 2a) Cancellation BY THE CLIENT (prepared — no consumer cancel route exists
//        yet; wire these the day the route ships) ──────────────────────────────

export async function sendReservationCancelledByClientToClient(p: {
  dedupeKey?: string // Email B0 — at-most-once when set
  to: string; customerName: string; restaurantName: string; date: Date
}): Promise<void> {
  await sendTransactional({
    to:      p.to,
    subject: `Annulation confirmée — ${p.restaurantName}`,
    trigger: 'reservation_cancelled_by_client_client',
    dedupeKey: p.dedupeKey,
    html: shell('Annulation confirmée', `
      <p>Bonjour ${esc(p.customerName)}, votre réservation chez <strong>${esc(p.restaurantName)}</strong>
         du ${formatDateFr(p.date)} est bien annulée.</p>
      <p style="font-size:13px;color:#6b7280">Si une empreinte était associée, elle est libérée — aucun débit.</p>`),
  })
}

export async function sendReservationCancelledByClientToOwner(p: {
  dedupeKey?: string // Email B0 — at-most-once when set
  to: string; customerName: string; restaurantName: string; date: Date; guests: number
}): Promise<void> {
  await sendTransactional({
    to:      p.to,
    subject: `Réservation annulée par le client — ${formatDateFr(p.date)}`,
    trigger: 'reservation_cancelled_by_client_owner',
    dedupeKey: p.dedupeKey,
    html: shell('Réservation annulée par le client', `
      <p>${esc(p.customerName)} a annulé sa réservation chez <strong>${esc(p.restaurantName)}</strong>.</p>
      ${table(row('Date', formatDateFr(p.date)) + row('Couverts', String(p.guests)))}
      <p style="font-size:13px;color:#6b7280">La table est de nouveau disponible sur ce créneau.</p>`),
  })
}

// ── 2b) Cancellation BY THE RESTAURANT → inform the client ──────────────────────

export async function sendReservationCancelledByOwner(p: {
  dedupeKey?:     string  // Email B0 — at-most-once when set
  to:             string
  customerName:   string
  restaurantName: string
  date:           Date
  /** Public closure reason when the cancellation comes from an exceptional
   *  closure (the « annulation muette » fix) — null for a direct cancel. */
  closureReason?: string | null
}): Promise<void> {
  const why = p.closureReason
    ? `<p style="font-size:13px;color:#6b7280">Motif : ${esc(p.closureReason)}.</p>`
    : ''
  await sendTransactional({
    to:      p.to,
    subject: `Votre réservation a été annulée — ${p.restaurantName}`,
    trigger: 'reservation_cancelled_by_owner',
    dedupeKey: p.dedupeKey,
    html: shell('Réservation annulée', `
      <p>Bonjour ${esc(p.customerName)}, nous sommes désolés : <strong>${esc(p.restaurantName)}</strong>
         a dû annuler votre réservation du ${formatDateFr(p.date)}.</p>
      ${why}
      <p style="font-size:13px;color:#6b7280">Si une empreinte était associée, elle est libérée sans frais — aucun débit.</p>
      <p style="text-align:center;margin:24px 0">
        <a href="https://grubano.com/eat" style="background:#F97316;color:#fff;text-decoration:none;
           padding:12px 24px;border-radius:12px;font-weight:600;display:inline-block">
           Réserver un autre créneau
        </a>
      </p>`),
  })
}

// ── 2c) Cancellation BY AN EXCEPTIONAL CLOSURE (Emails v2, FIX 2) ───────────────
// Dedicated trigger so the audit distinguishes a closure mass-cancel from a
// one-off dashboard cancel. Sorry tone — the restaurant closed on the guest.

export async function sendReservationCancelledByClosure(p: {
  dedupeKey?:     string  // Email B0 — at-most-once when set
  to:             string
  customerName:   string
  restaurantName: string
  date:           Date
  /** PUBLIC closure reason — shown verbatim when provided. */
  closureReason?: string | null
}): Promise<void> {
  const why = p.closureReason
    ? `<p style="font-size:13px;color:#6b7280">Motif : ${esc(p.closureReason)}.</p>`
    : ''
  await sendTransactional({
    to:      p.to,
    subject: `Votre réservation a été annulée — fermeture exceptionnelle de ${p.restaurantName}`,
    trigger: 'reservation_cancelled_by_closure',
    dedupeKey: p.dedupeKey,
    html: shell('Réservation annulée — fermeture exceptionnelle', `
      <p>Bonjour ${esc(p.customerName)}, nous sommes sincèrement désolés :
         <strong>${esc(p.restaurantName)}</strong> sera exceptionnellement fermé et a dû annuler
         votre réservation du ${formatDateFr(p.date)}.</p>
      ${why}
      <p style="font-size:13px;color:#6b7280">Si une empreinte était associée, elle est libérée sans frais — aucun débit.</p>
      <p style="text-align:center;margin:24px 0">
        <a href="https://grubano.com/eat" style="background:#F97316;color:#fff;text-decoration:none;
           padding:12px 24px;border-radius:12px;font-weight:600;display:inline-block">
           Réserver un autre créneau
        </a>
      </p>`),
  })
}

// ── 6) Password reset — security family (Emails v2, FIX 3) ──────────────────────

export async function sendPasswordResetEmail(p: {
  to:       string
  name:     string
  /** Full https reset link (token + email + space already in the query). */
  resetUrl: string
}): Promise<void> {
  await sendTransactional({
    to:      p.to,
    subject: 'Réinitialisation de votre mot de passe Grubano',
    trigger: 'password_reset_request',
    html: shell('Réinitialiser votre mot de passe', `
      <p>Bonjour ${esc(p.name)}, vous avez demandé à réinitialiser votre mot de passe Grubano.</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${p.resetUrl}" style="background:#F97316;color:#fff;text-decoration:none;
           padding:14px 28px;border-radius:12px;font-weight:600;display:inline-block">
           Choisir un nouveau mot de passe
        </a>
      </p>
      <p style="font-size:13px;color:#6b7280">Ce lien est valable <strong>1 heure</strong> et ne peut être utilisé qu'une seule fois.</p>
      <p style="font-size:13px;color:#6b7280">Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email — votre mot de passe reste inchangé.</p>`),
  })
}

export async function sendPasswordChangedEmail(p: {
  to:   string
  name: string
}): Promise<void> {
  await sendTransactional({
    to:      p.to,
    subject: 'Votre mot de passe Grubano a été changé',
    trigger: 'password_changed',
    html: shell('Mot de passe changé', `
      <p>Bonjour ${esc(p.name)}, le mot de passe de votre compte Grubano vient d'être modifié.</p>
      <p style="font-size:13px;color:#6b7280"><strong>Ce n'était pas vous ?</strong> Réinitialisez immédiatement votre mot de passe
         depuis la page de connexion (« Mot de passe oublié ») ou répondez à cet email.</p>`),
  })
}

// ── 3) Refund confirmation (bill refund or captured-empreinte refund) ───────────

export async function sendRefundConfirmation(p: {
  dedupeKey?:     string  // Email B0 — at-most-once when set
  to:             string
  customerName:   string
  restaurantName: string
  /** CENTS actually refunded by THIS operation. */
  refundedCents:  number
  /** true when part of the payment remains (partial refund). */
  partial:        boolean
}): Promise<void> {
  await sendTransactional({
    to:      p.to,
    subject: `Remboursement ${p.partial ? 'partiel ' : ''}effectué — ${p.restaurantName}`,
    trigger: 'refund_confirmation',
    dedupeKey: p.dedupeKey,
    html: shell('Remboursement effectué', `
      <p>Bonjour ${esc(p.customerName)}, un remboursement ${p.partial ? '<strong>partiel</strong> ' : ''}de
         <strong>${eurosFromCents(p.refundedCents)}</strong> vient d’être effectué par
         <strong>${esc(p.restaurantName)}</strong> sur votre moyen de paiement.</p>
      <p style="font-size:13px;color:#6b7280">Le délai bancaire est de 5 à 10 jours ouvrés selon votre banque.</p>`),
  })
}

// ── 5) Order confirmation — checkout C2 (paid pickup/delivery order) ───────────

export async function sendOrderConfirmation(p: {
  dedupeKey?:     string  // Email B0 — at-most-once when set (e.g. `order:<id>`)
  to:             string
  customerName:   string
  restaurantName: string
  /** Short customer-facing order ref (e.g. "#AB12CD") — also the idempotence
   *  marker the confirm route greps in EmailLog.subject. */
  orderRef:       string
  fulfillmentType: 'pickup' | 'delivery' | string
  items:          Array<{ name: string; qty: number }>
  /** CENTS actually paid (order.total — products + delivery − discount). */
  paidCents:      number
}): Promise<void> {
  const lines = p.items
    .map((it) => row(`${it.qty}×`, esc(it.name)))
    .join('')
  const mode = p.fulfillmentType === 'pickup'
    ? 'À emporter — votre commande sera à retirer au restaurant.'
    : 'Livraison — votre commande arrive chez vous.'
  await sendTransactional({
    to:      p.to,
    subject: `Commande ${p.orderRef} confirmée — ${p.restaurantName}`,
    trigger: 'order_confirmation',
    dedupeKey: p.dedupeKey,
    html: shell('Commande confirmée ✓', `
      <p>Bonjour ${esc(p.customerName)}, votre paiement de
         <strong>${eurosFromCents(p.paidCents)}</strong> est confirmé —
         <strong>${esc(p.restaurantName)}</strong> prépare votre commande.</p>
      ${table(row('Commande', esc(p.orderRef)) + lines + row('Montant payé', eurosFromCents(p.paidCents)))}
      <p style="font-size:13px;color:#6b7280">${mode}</p>
      <p style="text-align:center;margin:24px 0">
        <a href="https://grubano.com/eat/account" style="background:#F97316;color:#fff;text-decoration:none;
           padding:12px 24px;border-radius:12px;font-weight:600;display:inline-block">
           Suivre ma commande
        </a>
      </p>`),
  })
}

// ── 7) Creator notified of a new adoption (Mission 4 — marketplace vivante) ─────
// Sent AFTER a successful adoption transaction, best-effort. The royalty pct is
// read from AdoptionConfig by the caller and passed in — NEVER hardcoded here.

export async function sendDishAdoptedToCreator(p: {
  to:             string
  creatorName:    string
  restaurantName: string
  /** Establishment city — '' when the brand has no linked restaurant. */
  city:           string
  dishName:       string
  /** Selling price in € the restaurant set for the dish. */
  priceEur:       number
  /** Royalty fraction from AdoptionConfig (e.g. 0.02) — rendered as a percent. */
  royaltyPct:     number
}): Promise<void> {
  const where  = p.city ? ` (${esc(p.city)})` : ''
  const price  = p.priceEur.toFixed(2).replace('.', ',')
  const pct    = (p.royaltyPct * 100).toFixed(p.royaltyPct * 100 % 1 === 0 ? 0 : 1).replace('.', ',')
  await sendTransactional({
    to:      p.to,
    subject: `Nouvelle adoption — ${p.restaurantName} sert « ${p.dishName} »`,
    trigger: 'dish_adopted_creator',
    html: shell('Votre recette vient d’être adoptée 🎉', `
      <p>Bonjour ${esc(p.creatorName)}, bonne nouvelle :
         <strong>${esc(p.restaurantName)}</strong>${where} vient d’adopter votre recette
         <strong>${esc(p.dishName)}</strong> au prix de <strong>${price} €</strong>.</p>
      <p style="font-size:13px;color:#6b7280">Vos royalties de <strong>${pct}%</strong> s’appliquent sur chaque vente de cette recette.</p>
      <p style="text-align:center;margin:24px 0">
        <a href="https://grubano.com/creators/dashboard" style="background:#F97316;color:#fff;text-decoration:none;
           padding:12px 24px;border-radius:12px;font-weight:600;display:inline-block">
           Voir mon studio
        </a>
      </p>`),
  })
}

// ── 8) Waitlisted restaurant: a city-exclusive slot just freed up (Mission 4) ───
// Sent when an 'offered' promotion is created. The TTL (hours) is passed in.

export async function sendWaitlistOfferToRestaurant(p: {
  to:             string
  restaurantName: string
  dishName:       string
  city:           string
  /** Offer time-to-live in hours (WAITLIST_OFFER_TTL_HOURS). */
  hours:          number
}): Promise<void> {
  await sendTransactional({
    to:      p.to,
    subject: `Exclusivité disponible — « ${p.dishName} » à ${p.city}`,
    trigger: 'waitlist_offer',
    html: shell('Une exclusivité s’est libérée', `
      <p>Bonjour, l’exclusivité de la recette <strong>${esc(p.dishName)}</strong> à
         <strong>${esc(p.city)}</strong> vient de se libérer — et
         <strong>${esc(p.restaurantName)}</strong> est le prochain sur la liste d’attente.</p>
      <p style="font-size:13px;color:#6b7280">Vous avez <strong>${p.hours} h</strong> pour l’adopter avant que l’offre ne passe au restaurant suivant.</p>
      <p style="text-align:center;margin:24px 0">
        <a href="https://grubano.com/menu" style="background:#F97316;color:#fff;text-decoration:none;
           padding:12px 24px;border-radius:12px;font-weight:600;display:inline-block">
           Adopter la recette
        </a>
      </p>`),
  })
}

// ── 4) No-show penalty charged ───────────────────────────────────────────────────

export async function sendNoShowPenaltyCharged(p: {
  dedupeKey?:     string  // Email B0 — at-most-once when set (e.g. `resv:<id>`)
  to:             string
  customerName:   string
  restaurantName: string
  /** CENTS captured on the empreinte. */
  capturedCents:  number
  /** The missed reservation's date. */
  date:           Date
}): Promise<void> {
  await sendTransactional({
    to:      p.to,
    subject: `Pénalité no-show débitée — ${p.restaurantName}`,
    trigger: 'noshow_penalty_charged',
    dedupeKey: p.dedupeKey,
    html: shell('Pénalité no-show', `
      <p>Bonjour ${esc(p.customerName)}, votre réservation chez <strong>${esc(p.restaurantName)}</strong>
         du ${formatDateFr(p.date)} n’a pas été honorée.</p>
      ${table(row('Montant débité', eurosFromCents(p.capturedCents)) + row('Réservation', formatDateFr(p.date)))}
      <p style="font-size:13px;color:#6b7280">Conformément aux conditions de réservation, l’empreinte de garantie a été débitée.</p>
      <p style="font-size:13px;color:#6b7280"><strong>Vous souhaitez contester ?</strong> Contactez directement le restaurant :
         une contestation est recevable pendant 30 jours, et le restaurant peut vous rembourser intégralement depuis son espace.</p>`),
  })
}
