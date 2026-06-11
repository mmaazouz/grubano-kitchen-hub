import nodemailer from 'nodemailer'
import { prisma } from '@/lib/prisma'

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

// ── Core best-effort sender ─────────────────────────────────────────────────────

export async function sendTransactional(opts: {
  to:      string
  subject: string
  html:    string
  /** EmailLog trigger key — also the [EMAIL MISS] context tag. */
  trigger: string
}): Promise<void> {
  let status = 'sent'
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
}

// ── 1) Reservation confirmation (consumer booking) ──────────────────────────────

export async function sendReservationConfirmation(p: {
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
  to: string; customerName: string; restaurantName: string; date: Date
}): Promise<void> {
  await sendTransactional({
    to:      p.to,
    subject: `Annulation confirmée — ${p.restaurantName}`,
    trigger: 'reservation_cancelled_by_client_client',
    html: shell('Annulation confirmée', `
      <p>Bonjour ${esc(p.customerName)}, votre réservation chez <strong>${esc(p.restaurantName)}</strong>
         du ${formatDateFr(p.date)} est bien annulée.</p>
      <p style="font-size:13px;color:#6b7280">Si une empreinte était associée, elle est libérée — aucun débit.</p>`),
  })
}

export async function sendReservationCancelledByClientToOwner(p: {
  to: string; customerName: string; restaurantName: string; date: Date; guests: number
}): Promise<void> {
  await sendTransactional({
    to:      p.to,
    subject: `Réservation annulée par le client — ${formatDateFr(p.date)}`,
    trigger: 'reservation_cancelled_by_client_owner',
    html: shell('Réservation annulée par le client', `
      <p>${esc(p.customerName)} a annulé sa réservation chez <strong>${esc(p.restaurantName)}</strong>.</p>
      ${table(row('Date', formatDateFr(p.date)) + row('Couverts', String(p.guests)))}
      <p style="font-size:13px;color:#6b7280">La table est de nouveau disponible sur ce créneau.</p>`),
  })
}

// ── 2b) Cancellation BY THE RESTAURANT → inform the client ──────────────────────

export async function sendReservationCancelledByOwner(p: {
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

// ── 3) Refund confirmation (bill refund or captured-empreinte refund) ───────────

export async function sendRefundConfirmation(p: {
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
    html: shell('Remboursement effectué', `
      <p>Bonjour ${esc(p.customerName)}, un remboursement ${p.partial ? '<strong>partiel</strong> ' : ''}de
         <strong>${eurosFromCents(p.refundedCents)}</strong> vient d’être effectué par
         <strong>${esc(p.restaurantName)}</strong> sur votre moyen de paiement.</p>
      <p style="font-size:13px;color:#6b7280">Le délai bancaire est de 5 à 10 jours ouvrés selon votre banque.</p>`),
  })
}

// ── 5) Order confirmation — checkout C2 (paid pickup/delivery order) ───────────

export async function sendOrderConfirmation(p: {
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

// ── 4) No-show penalty charged ───────────────────────────────────────────────────

export async function sendNoShowPenaltyCharged(p: {
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
    html: shell('Pénalité no-show', `
      <p>Bonjour ${esc(p.customerName)}, votre réservation chez <strong>${esc(p.restaurantName)}</strong>
         du ${formatDateFr(p.date)} n’a pas été honorée.</p>
      ${table(row('Montant débité', eurosFromCents(p.capturedCents)) + row('Réservation', formatDateFr(p.date)))}
      <p style="font-size:13px;color:#6b7280">Conformément aux conditions de réservation, l’empreinte de garantie a été débitée.</p>
      <p style="font-size:13px;color:#6b7280"><strong>Vous souhaitez contester ?</strong> Contactez directement le restaurant :
         une contestation est recevable pendant 30 jours, et le restaurant peut vous rembourser intégralement depuis son espace.</p>`),
  })
}
