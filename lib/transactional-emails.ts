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

/** CTA base URL — the DEPLOYMENT's own origin, so a staging beta-tester clicking a
 *  CTA lands on staging, never on production. Same convention as
 *  /api/auth/forgot-password: NEXTAUTH_URL (trailing slash trimmed), production
 *  fallback only when the env is missing. Read per-call (never frozen at import). */
function baseUrl(): string {
  return (process.env.NEXTAUTH_URL || 'https://grubano.com').replace(/\/$/, '')
}

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

// ── Order status emails (Email B1, Agent 142) ───────────────────────────────────
// Consumer notification on each order-status transition (PATCH /api/orders/[id]/status).
// STATUS-ONLY: no price is read or recomputed, no amount is shown. Idempotent per
// (status, order) via sendOnce — trigger `order_<status>` + dedupeKey `order:<id>` (DISTINCT
// triggers ⇒ one email per status per order, no collision on the shared dedupeKey). Best-effort
// (sendOnce never throws). FR, sober shell — no design, no i18n (deferred). 'ready' / 'delivered'
// wording adapts to pickup vs delivery; a non-notifiable status (e.g. 'received') is skipped.
type OrderStatusForEmail = 'preparing' | 'ready' | 'picked_up' | 'delivered' | 'cancelled'

export async function sendOrderStatusEmail(p: {
  orderId:         string
  to:              string
  customerName:    string
  restaurantName:  string
  /** Short customer-facing ref, e.g. "#AB12CD". */
  orderRef:        string
  /** The NEW order status; non-notifiable statuses (e.g. 'received') yield a no-op skip. */
  status:          string
  /** 'pickup' | 'delivery' | other — tunes the 'ready' / 'delivered' wording. */
  fulfillmentType: string
}): Promise<{ status: SendStatus }> {
  const name   = esc(p.customerName)
  const resto  = esc(p.restaurantName)
  const refRow = table(row('Commande', esc(p.orderRef)))
  const pickup = p.fulfillmentType === 'pickup'

  let trigger: string
  let subject: string
  let title:   string
  let body:    string

  switch (p.status as OrderStatusForEmail) {
    case 'preparing':
      trigger = 'order_accepted'
      subject = `Commande ${p.orderRef} acceptée — ${p.restaurantName}`
      title   = 'Commande acceptée ✓'
      body    = `<p>Bonjour ${name}, bonne nouvelle : <strong>${resto}</strong> a accepté votre commande et la prépare.</p>${refRow}`
      break
    case 'ready':
      trigger = 'order_ready'
      subject = `Commande ${p.orderRef} prête — ${p.restaurantName}`
      title   = 'Commande prête ✓'
      body    = pickup
        ? `<p>Bonjour ${name}, votre commande chez <strong>${resto}</strong> est prête — vous pouvez venir la récupérer.</p>${refRow}`
        : `<p>Bonjour ${name}, votre commande chez <strong>${resto}</strong> est prête et part bientôt en livraison.</p>${refRow}`
      break
    case 'picked_up':
      trigger = 'order_enroute'
      subject = `Commande ${p.orderRef} en route — ${p.restaurantName}`
      title   = 'Commande en route'
      body    = `<p>Bonjour ${name}, votre commande de <strong>${resto}</strong> est en route — elle arrive bientôt !</p>${refRow}`
      break
    case 'delivered':
      trigger = 'order_delivered'
      subject = `Commande ${p.orderRef} ${pickup ? 'récupérée' : 'livrée'} — ${p.restaurantName}`
      title   = pickup ? 'Commande récupérée ✓' : 'Commande livrée ✓'
      body    = `<p>Bonjour ${name}, votre commande chez <strong>${resto}</strong> est ${pickup ? 'récupérée' : 'livrée'}. Bon appétit !</p>${refRow}`
        + `<p style="font-size:13px;color:#6b7280">Un avis sur votre expérience aiderait beaucoup le restaurant — vous pouvez le partager depuis votre espace.</p>`
      break
    case 'cancelled':
      trigger = 'order_cancelled'
      subject = `Commande ${p.orderRef} annulée — ${p.restaurantName}`
      title   = 'Commande annulée'
      body    = `<p>Bonjour ${name}, votre commande chez <strong>${resto}</strong> a été annulée.</p>${refRow}`
        + `<p style="font-size:13px;color:#6b7280">Pour toute question, contactez directement le restaurant.</p>`
      break
    default:
      // Non-notifiable status (e.g. 'received') — nothing to send.
      return { status: 'skipped' }
  }

  return sendOnce(trigger, `order:${p.orderId}`, { to: p.to, subject, html: shell(title, body) })
}

// ── Restaurant notifications (Email B2, Agent 142→143) ──────────────────────────
// Owner-facing alerts when a new (paid) order / a new reservation lands. Fired from the
// confirm route (order, post-payment — NEVER the webhook) and from reservations/public
// (reservation, post-create), best-effort + idempotent via sendOnce (DISTINCT triggers from
// the consumer emails that share the same dedupeKey). FR, sober shell. The order amount is the
// SERVER total passed in (eurosFromCents) — NEVER recomputed here.

export async function sendRestaurantNewOrderEmail(p: {
  orderId:         string
  to:              string
  restaurantName:  string
  orderRef:        string
  fulfillmentType: string
  items:           Array<{ name: string; qty: number }>
  /** order.total in CENTS (SERVER value, display only). */
  totalCents:      number
}): Promise<{ status: SendStatus }> {
  const lines = p.items.map((it) => row(`${it.qty}×`, esc(it.name))).join('')
  const mode  = p.fulfillmentType === 'pickup' ? 'Click & collect' : 'Livraison'
  return sendOnce('resto_order_received', `order:${p.orderId}`, {
    to:      p.to,
    subject: `Nouvelle commande ${p.orderRef} — ${p.restaurantName}`,
    html: shell('Nouvelle commande reçue', `
      <p>Vous avez reçu une nouvelle commande payée chez <strong>${esc(p.restaurantName)}</strong>.</p>
      ${table(row('Commande', esc(p.orderRef)) + lines + row('Mode', mode) + row('Montant', eurosFromCents(p.totalCents)))}
      <p style="font-size:13px;color:#6b7280">Retrouvez-la dans votre tableau de bord pour l'accepter et la préparer.</p>`),
  })
}

export async function sendRestaurantNewReservationEmail(p: {
  reservationId:  string
  to:             string
  restaurantName: string
  customerName:   string
  date:           Date
  guests:         number
  /** Short session code (#XXXX). */
  code:           string
}): Promise<{ status: SendStatus }> {
  return sendOnce('resto_reservation_received', `resv:${p.reservationId}`, {
    to:      p.to,
    subject: `Nouvelle réservation — ${formatDateFr(p.date)}`,
    html: shell('Nouvelle réservation reçue', `
      <p>Une nouvelle réservation vient d'être prise chez <strong>${esc(p.restaurantName)}</strong>.</p>
      ${table(row('Client', esc(p.customerName)) + row('Date', formatDateFr(p.date)) + row('Couverts', String(p.guests)) + row('N° de session', esc(p.code)))}
      <p style="font-size:13px;color:#6b7280">Retrouvez-la dans votre espace réservations.</p>`),
  })
}

// ── 1) Reservation confirmation (consumer booking) ──────────────────────────────

// ── Partner lifecycle (Email B4, Agent 144) ────────────────────────────────────
// ONE mutualised email for the partner lifecycle, parametrised by {role}: restaurant / supplier /
// influencer (the wording adapts). Fired from the admin validation routes AFTER the status change,
// best-effort + idempotent via sendOnce. NO money (Connect/IBAN/payout are out of scope). FR sober.
// IDEMPOTENCY KEYS: 'validated' = ONCE per partner (dedupeKey = the stable scope, e.g. resto:<id>).
// 'rejected'/'docs_needed' are REPEATABLE (a partner can be rejected, fix + re-submit, be rejected
// again) → the key carries a day-bucket discriminant so a re-decision on another day RE-NOTIFIES,
// while a same-day double is still deduped. (Calque of B0's discipline: never over-suppress a
// legitimate notification.)
export type PartnerEmailRole = 'restaurant' | 'supplier' | 'influencer'
export type PartnerEmailStatus = 'validated' | 'rejected' | 'docs_needed'

export async function sendPartnerStatusEmail(p: {
  role:        PartnerEmailRole
  status:      PartnerEmailStatus
  to:          string
  partnerName: string
  /** Stable partner-scoped id for idempotency, e.g. `resto:<id>` / `supplier:<id>` / `affiliate:<operatorId>`. */
  dedupeScope: string
  /** Optional public reason (rejection / missing documents). */
  reason?:     string
  /** Discriminant for REPEATABLE statuses (rejected / docs_needed). Defaults to today's date
   *  (YYYY-MM-DD): a re-decision on another day re-sends; a same-day double is deduped. Ignored
   *  by 'validated' (one validation per partner). */
  occurrence?: string
}): Promise<{ status: SendStatus }> {
  const name = esc(p.partnerName)
  const noun =
    p.role === 'restaurant' ? 'votre établissement'
    : p.role === 'supplier' ? 'votre compte fournisseur'
    :                         'votre compte'
  const why = p.reason ? `<p style="font-size:13px;color:#6b7280">Motif : ${esc(p.reason)}.</p>` : ''
  const day = () => p.occurrence ?? new Date().toISOString().slice(0, 10)

  let trigger: string
  let dedupeKey: string
  let subject: string
  let title: string
  let body: string
  switch (p.status) {
    case 'validated':
      trigger   = 'partner_validated'
      dedupeKey = p.dedupeScope // once per partner
      subject   = 'Votre compte Grubano est validé'
      title     = 'Compte validé ✓'
      body      = `<p>Bonjour ${name}, bonne nouvelle : ${noun} est validé et activé sur Grubano.</p>`
        + `<p style="font-size:13px;color:#6b7280">Vous pouvez dès maintenant accéder à votre espace.</p>`
      break
    case 'rejected':
      trigger   = 'partner_rejected'
      dedupeKey = `${p.dedupeScope}:${day()}`
      subject   = `Votre demande Grubano n'a pas été validée`
      title     = 'Demande non validée'
      body      = `<p>Bonjour ${name}, après examen, ${noun} n'a pas pu être validé pour le moment.</p>${why}`
        + `<p style="font-size:13px;color:#6b7280">Vous pouvez corriger votre dossier et le soumettre à nouveau.</p>`
      break
    case 'docs_needed':
      trigger   = 'partner_docs_needed'
      dedupeKey = `${p.dedupeScope}:${day()}`
      subject   = 'Documents à fournir — Grubano'
      title     = 'Documents à fournir'
      body      = `<p>Bonjour ${name}, pour finaliser la validation de ${noun}, des documents complémentaires sont nécessaires.</p>${why}`
        + `<p style="font-size:13px;color:#6b7280">Complétez votre dossier depuis votre espace pour débloquer la validation.</p>`
      break
    default:
      return { status: 'skipped' }
  }
  return sendOnce(trigger, dedupeKey, { to: p.to, subject, html: shell(title, body) })
}

// ── Admin alert: new partner dossier pending validation (Email B5a, Agent 145) ──
// When a partner (restaurant / supplier / influencer) submits a registration, alert the
// ADMIN that a dossier awaits validation. Fired best-effort from the registration routes
// AFTER the profile is created — NEVER from the money path or the Stripe webhook. Recipient
// = ALERT_EMAIL (the same env the ledger/invoice crons already use); if it is unset/empty
// at runtime, the send is SKIPPED cleanly (no-op, never throws). ONE mutualised fn for the
// 3 roles (the label adapts: restaurant / fournisseur / influenceur). FR sober.
// IDEMPOTENCY: single trigger 'admin_partner_pending', dedupeKey = `<role>:<id>` → ONE admin
// alert per dossier. Re-registration of restaurants/suppliers is blocked upstream (anti-enum
// / create-if-absent) so a fixed key = once. Influencer re-application (a rejected request
// resets to pending) CAN legitimately re-alert → the caller passes an `occurrence`
// discriminant (day-bucket), mirroring B4's repeatable-status discipline.
export type AdminPartnerRole = 'restaurant' | 'supplier' | 'influencer'

export async function sendAdminNewPartnerEmail(p: {
  role:        AdminPartnerRole
  partnerName: string
  /** Stable dossier-scoped id, e.g. `restaurant:<operatorId>` / `supplier:<profileId>` / `influencer:<operatorId>`. */
  dedupeScope: string
  /** Optional discriminant for a legitimately repeatable alert (e.g. influencer re-application). */
  occurrence?: string
}): Promise<{ status: SendStatus }> {
  const to = (process.env.ALERT_EMAIL || '').trim()
  if (!to) return { status: 'skipped' } // ALERT_EMAIL not configured → no admin alert (clean no-op)

  const label =
    p.role === 'restaurant' ? 'restaurant'
    : p.role === 'supplier' ? 'fournisseur'
    :                         'influenceur'
  const name = esc(p.partnerName)
  const dedupeKey = p.occurrence ? `${p.dedupeScope}:${p.occurrence}` : p.dedupeScope

  const subject = `[Grubano] Nouveau dossier ${label} à valider`
  const body =
    `<p>Un nouveau ${label} vient de soumettre son inscription et attend une validation administrateur.</p>`
    + table(row('Type', label) + row('Partenaire', name))
    + `<p style="font-size:13px;color:#6b7280">Ouvrez la console d'administration pour examiner et valider ce dossier.</p>`
  return sendOnce('admin_partner_pending', dedupeKey, { to, subject, html: shell('Nouveau dossier à valider', body) })
}

// ── Account email change (Agent 147) ───────────────────────────────────────────
// Four ADDITIVE best-effort senders for the email-change flow (flag-gated upstream). All go
// through the B0 sendOnce rail; the dedupeKey is supplied by the caller (a per-mint discriminant
// for the link so a re-request re-sends; a per-(operator,newEmail) key for the post-mutation
// alert/confirm so each change notifies once). FR sober. None ever throws (best-effort) and none
// can roll back an already-committed mutation — they fire AFTER the commit (or independently).

/** REQUEST step: the actionable confirmation LINK sent to the NEW address (proves possession). */
export async function sendEmailChangeLink(p: { to: string; link: string; dedupeKey: string }): Promise<{ status: SendStatus }> {
  const body =
    `<p>Vous avez demandé à utiliser cette adresse comme nouvel e-mail de connexion à votre compte Grubano.</p>`
    + `<p style="text-align:center;margin:24px 0"><a href="${p.link}" style="background:#F97316;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:600;display:inline-block">Confirmer ma nouvelle adresse</a></p>`
    + `<p style="font-size:13px;color:#6b7280">Ce lien expire dans 15 minutes et ne fonctionne qu'une seule fois. Tant que vous ne cliquez pas, rien ne change et vous restez connecté avec votre adresse actuelle. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p>`
  return sendOnce('email_change_link', p.dedupeKey, { to: p.to, subject: 'Confirmez votre nouvelle adresse e-mail — Grubano', html: shell('Confirmez votre nouvelle adresse', body) })
}

/** CONFIRM step: security ALERT to the OLD address so the real owner can react to a takeover. */
export async function sendEmailChangedAlert(p: { to: string; newEmailMasked: string; dedupeKey: string }): Promise<{ status: SendStatus }> {
  const body =
    `<p>L'adresse e-mail de connexion de votre compte Grubano vient d'être remplacée par ${esc(p.newEmailMasked)}.</p>`
    + `<p style="font-size:13px;color:#6b7280">Si vous êtes à l'origine de ce changement, aucune action n'est nécessaire. Sinon, contactez-nous immédiatement : votre compte a pu être compromis.</p>`
  return sendOnce('email_changed_alert', p.dedupeKey, { to: p.to, subject: 'Sécurité : votre e-mail de connexion a été modifié — Grubano', html: shell('Votre e-mail a été modifié', body) })
}

/** CONFIRM step: confirmation to the NEW address that it is now the login email. */
export async function sendEmailChangeConfirm(p: { to: string; dedupeKey: string }): Promise<{ status: SendStatus }> {
  const body =
    `<p>C'est confirmé : cette adresse est désormais l'e-mail de connexion de votre compte Grubano.</p>`
    + `<p style="font-size:13px;color:#6b7280">Utilisez-la pour vos prochaines connexions.</p>`
  return sendOnce('email_change_confirm', p.dedupeKey, { to: p.to, subject: 'Votre nouvelle adresse e-mail est active — Grubano', html: shell('Adresse e-mail mise à jour', body) })
}

/** REQUEST step, anti-enum: the NEW address is ALREADY a Grubano account → notify THAT address
 *  (no code, no leak to the requester). Fixed dedupeKey → at most one notice per address. */
export async function sendEmailAlreadyUsedNotice(p: { to: string }): Promise<{ status: SendStatus }> {
  const body =
    `<p>Quelqu'un vient de tenter d'associer cette adresse à un compte Grubano, mais elle est déjà utilisée.</p>`
    + `<p style="font-size:13px;color:#6b7280">Si c'était vous, connectez-vous directement avec cette adresse. Sinon, ignorez cet e-mail — aucun changement n'a eu lieu sur votre compte.</p>`
  return sendOnce('email_change_taken', `email_change_taken:${p.to.trim().toLowerCase()}`, { to: p.to, subject: 'À propos de votre adresse e-mail — Grubano', html: shell('Adresse déjà utilisée', body) })
}

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
  // V4-1 (pilote) : la phrase annonçant le débit no-show/walk-out est RETIRÉE —
  // aucune capture punitive n'existe flag OFF (promesse inversée sinon). À la
  // réactivation de PUNITIVE_CAPTURE_ENABLED, RESTAURER l'annonce : une capture
  // non annoncée au client serait pire juridiquement que l'absence de capture.
  // CHECKLIST DE RÉACTIVATION (M1-07, LOT D) : l'email sendNoShowPenaltyCharged
  // (plus bas dans ce fichier) fait aussi partie de la checklist — relire son
  // wording (conditions annoncées, contestation via le support Grubano) AVANT
  // tout retour de PUNITIVE_CAPTURE_ENABLED.
  // LOT D (P-6, D1/D2) : cet email part À LA CRÉATION de la réservation, AVANT
  // que l'autorisation carte soit confirmée → conditionnel obligatoire (« peut
  // être demandée »), wording = autorisation temporaire, jamais une pénalité.
  const deposit = p.depositEur > 0
    ? `<p style="font-size:13px;color:#6b7280">Une empreinte bancaire temporaire de ${p.depositEur.toFixed(2).replace('.', ',')} € peut être demandée pour cette réservation —
       ce n’est pas un paiement : rien n’est débité ; elle reste active jusqu’au paiement de l’addition et est libérée automatiquement.</p>`
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
      <p style="font-size:13px;color:#6b7280">Si une empreinte était associée, elle sera libérée — aucun débit.</p>`),
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
      <p style="font-size:13px;color:#6b7280">Si une empreinte était associée, elle sera libérée sans frais — aucun débit.</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${baseUrl()}/eat" style="background:#F97316;color:#fff;text-decoration:none;
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
      <p style="font-size:13px;color:#6b7280">Si une empreinte était associée, elle sera libérée sans frais — aucun débit.</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${baseUrl()}/eat" style="background:#F97316;color:#fff;text-decoration:none;
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
    ? 'Click & collect — votre commande sera à retirer au restaurant.'
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
        <a href="${baseUrl()}/eat/account" style="background:#F97316;color:#fff;text-decoration:none;
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
        <a href="${baseUrl()}/creators/dashboard" style="background:#F97316;color:#fff;text-decoration:none;
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
        <a href="${baseUrl()}/menu" style="background:#F97316;color:#fff;text-decoration:none;
           padding:12px 24px;border-radius:12px;font-weight:600;display:inline-block">
           Adopter la recette
        </a>
      </p>`),
  })
}

// ── 4) No-show penalty charged ───────────────────────────────────────────────────
// M1-07 (LOT D) — INATTEIGNABLE flag OFF (le no-show libère l'empreinte, aucune
// capture punitive n'existe) ; fait partie de la CHECKLIST DE RÉACTIVATION de
// PUNITIVE_CAPTURE_ENABLED (voir le commentaire V4-1 de sendReservationConfirmation).

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
      <p style="font-size:13px;color:#6b7280">Conformément aux conditions annoncées lors de la réservation, l’empreinte de garantie a été débitée.</p>
      <p style="font-size:13px;color:#6b7280"><strong>Vous souhaitez contester ?</strong> Une contestation est recevable pendant 30 jours :
         pour toute contestation, contactez le restaurant ou notre support (contact@grubano.com) — le remboursement est instruit par l’équipe Grubano.</p>`),
  })
}
