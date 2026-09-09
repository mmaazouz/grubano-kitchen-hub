#!/usr/bin/env node
'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   PHASE 2 — REFUND EMAIL TIMELINE (staging) — READ-ONLY
   ───────────────────────────────────────────────────────────────────────────────
   Proves the ordering invariant "Stripe refund succeeded → only then the success
   e-mail was dispatched" with AUTHORITATIVE timestamps (Stripe refund `created`,
   DB Refund.createdAt, EmailDispatch.createdAt, EmailLog.sentAt), all in UTC.

   CORRELATION (defect fixed 2026-09-09 — see below)
   -------------------------------------------------
   `EmailLog` carries NO order / refund foreign key (schema: recipient, subject,
   trigger, status, sentAt). A consumer can legitimately receive SEVERAL refund
   e-mails (one per refund, several orders) — the first version of this operator
   assumed "exactly one refund e-mail per consumer in 48 h" and evaluated
   `sentLogs[0]` (the OLDEST row), which produced a FALSE NEGATIVE after the
   second rehearsal. The strongest deterministic relations the schema permits are
   used instead, in this order:

     1. `EmailDispatch.dedupeKey = order:<orderId>:<amountCents>` — an EXACT,
        authoritative key for (order, refund amount). `sendTransactional` claims
        this row BEFORE sending, so WHENEVER A CLAIM EXISTS, claim.createdAt is
        <= that e-mail's sentAt. Only rows sent at/after the claim are candidates
        (never an older row). If the claim INSERT degrades (a non-P2002 error) the
        product sends WITHOUT a claim; this operator then reports NOT CORRELATABLE
        instead of guessing a row — fail-closed, never a false PASS.
     2. EXPECTED SUBJECT — rebuilt from measured data exactly as
        `sendRefundConfirmation` builds it: `Votre remboursement ${partial ?
        'partiel ' : ''}est confirmé — <restaurant name>`, where `partial` comes
        from STRIPE truth (base charge.amount, cumulative = Stripe's own refunds),
        the same source the engine uses — never a sum of DB rows, which would miss
        any refund issued outside the rail (Stripe Dashboard).
     3. NEXT CLAIM (any order, same trigger) — upper bound of the window, used as
        a tiebreaker only, so a racing send can never be excluded.

   LIMITATION (documented, not worked around): with no foreign key, two SUCCEEDED
   refunds of the SAME amount on the SAME order cannot be told apart. That IS
   reachable on the rail — the money idempotency key is
   `refund:<orderId>:<alreadyRefundedCents>`, so 500 c then another 500 c uses two
   different keys — but those two refunds share ONE e-mail dedupeKey, so the second
   e-mail is suppressed as a duplicate by design and there is no second e-mail to
   correlate. The operator flags that case explicitly (see GO-LIVE-TICKETS T-47)
   rather than reporting a confident verdict.

   Usage (founder, staging):
     PHASE2_REFUND_ORDER_ID=<cuid> [PHASE2_REFUND_AMOUNT_CENTS=<n>] \
       ~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/phase2-email-timeline.js

   Never: writes anything, prints a secret, prints a full e-mail address (domain only).
   ═══════════════════════════════════════════════════════════════════════════════ */

const fs = require('fs')
const path = require('path')
const prov = require(path.join(__dirname, 'env-provenance.js'))
const H = require(path.join(__dirname, 'reconcile-helpers.js'))

const APP_ROOT = process.env.PHASE2_APP_ROOT || path.join(__dirname, '..', '..')
const ORDER_ID = process.env.PHASE2_REFUND_ORDER_ID || 'cmtju919h0001h7t6bkn5tsm0'
const TARGET_AMOUNT = process.env.PHASE2_REFUND_AMOUNT_CENTS ? Number(process.env.PHASE2_REFUND_AMOUNT_CENTS) : null
const LOOKBACK_H = Number(process.env.PHASE2_EMAIL_LOOKBACK_HOURS || 48)

const facts = [], anomalies = []
const F = (k, v) => { facts.push(k + ' = ' + v); console.log('  ' + k + ' = ' + v) }
const A = (m) => { anomalies.push(m); console.log('  !! ANOMALY: ' + m) }
const mask = (s) => (typeof s === 'string' && s.length > 10 ? s.slice(0, 6) + '…' + s.slice(-4) : (s ? '***' : 'null'))
const domainOf = (e) => (typeof e === 'string' && e.includes('@') ? '***@' + e.split('@')[1] : 'n/a')
const iso = (d) => (d instanceof Date ? d.toISOString() : (typeof d === 'number' ? new Date(d * 1000).toISOString() : String(d)))
const scrub = (m) => String(m == null ? '' : ((m && m.message) || m)).replace(/sk_(test|live)_[A-Za-z0-9]+/g, 'sk_***').replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, '<url>').replace(/[A-Za-z0-9_-]{24,}/g, '…').slice(0, 160)

function done(result, failedStep) {
  console.log('========================================')
  console.log('GRUBANO PHASE 2 REFUND EMAIL TIMELINE (staging) — every value below is MEASURED (UTC)')
  console.log('RESULT: ' + result)
  if (failedStep) console.log('FAILED STEP: ' + failedStep)
  for (const l of facts) console.log(l)
  if (anomalies.length) { console.log('ANOMALIES (' + anomalies.length + '):'); for (const a of anomalies) console.log('  - ' + a) }
  console.log('ACTION: PASTE THIS WHOLE OUTPUT TO CLAUDE CODE')
  console.log('========================================')
  process.exitCode = result === 'PASS' ? 0 : 1
  setTimeout(() => process.exit(process.exitCode), 1500).unref()
}
const fail = (step) => done('FAIL', step)

// ── PURE CORRELATION (unit-tested: tests/phase2-email-timeline-correlate.test.ts) ──

const ms = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime())

/**
 * Pick the refund row this run is about.
 *   amountCents given → the LATEST succeeded row of exactly that amount (never an
 *                       older one, never a row of a different amount);
 *   amountCents null  → the LATEST succeeded row of the order.
 * Never assumes the order has exactly one refund.
 */
function selectTargetRefund(refundRows, amountCents) {
  const succeeded = (refundRows || []).filter((r) => r && r.status === 'succeeded')
    .slice().sort((a, b) => ms(a.createdAt) - ms(b.createdAt))
  if (!succeeded.length) return { refund: null, selection: 'no succeeded refund row on this order' }
  if (amountCents != null) {
    const matches = succeeded.filter((r) => r.amountCents === amountCents)
    if (!matches.length) return { refund: null, ambiguous: false, selection: 'no succeeded row of ' + amountCents + ' c (rows: ' + succeeded.map((r) => r.amountCents).join(',') + ')' }
    // Two refunds of the SAME amount on the SAME order are possible on the rail (the idempotency key is
    // refund:<orderId>:<alreadyRefunded>, so 500 then 500 uses two DIFFERENT keys). They would however
    // share ONE e-mail dedupeKey (order:<id>:500), so the second e-mail is suppressed as a duplicate and
    // no per-refund correlation exists. Flag it instead of silently picking one.
    return { refund: matches[matches.length - 1], ambiguous: matches.length > 1, selection: 'succeeded row of ' + amountCents + ' c (' + matches.length + ' candidate(s), latest taken)' }
  }
  return { refund: succeeded[succeeded.length - 1], ambiguous: false, selection: 'latest of ' + succeeded.length + ' succeeded row(s)' }
}

/**
 * Which template the product must have used for `target`, from STRIPE truth only.
 * Mirrors lib/refund.ts: base = charge.amount, cumulative = the charge's own succeeded refunds
 * through the target (every refund created before it, plus itself — so a refund issued OUTSIDE
 * the rail, e.g. from the Stripe Dashboard, is counted exactly as the engine counts it via
 * charge.amount_refunded). The route then sends `partial: remainingRefundableCents > 0`.
 */
function computeTemplateFlag({ chargeAmount, refunds, target }) {
  const through = (refunds || []).filter((r) => r && r.status === 'succeeded' && (r.created < target.created || r.id === target.id))
  const cumulativeThrough = through.reduce((a, r) => a + r.amount, 0)
  const remainingAfter = Math.max(0, chargeAmount - cumulativeThrough)
  return { cumulativeThrough, remainingAfter, partial: remainingAfter > 0 }
}

/** Subject built EXACTLY as lib/transactional-emails.sendRefundConfirmation builds it. */
function expectedRefundSubject(restaurantName, partial) {
  return 'Votre remboursement ' + (partial ? 'partiel ' : '') + 'est confirmé — ' + restaurantName
}

/**
 * Correlate ONE EmailLog row to ONE refund, using the dispatch claim as the strong
 * key and the expected subject as the content key. Returns the selected row plus
 * everything needed to explain the choice. NEVER returns a row sent before the claim.
 */
function correlateRefundEmail({ dispatches, logs, orderId, amountCents, expectedSubject, nextClaimAt }) {
  const claimKey = 'order:' + orderId + ':' + amountCents
  const claims = (dispatches || []).slice().sort((a, b) => ms(a.createdAt) - ms(b.createdAt))
  const claim = claims.find((d) => d.dedupeKey === claimKey) || null
  const sent = (logs || []).filter((l) => l && l.status === 'sent').slice().sort((a, b) => ms(a.sentAt) - ms(b.sentAt))
  if (!claim) {
    return { claim: null, claimKey, log: null, selection: 'no EmailDispatch claim for ' + claimKey + ' — e-mail not correlatable', candidates: 0, ignored: sent.length, subjectMatch: null }
  }
  const t0 = ms(claim.createdAt)
  // (1) never a row older than the claim — this is what the first version got wrong.
  const atOrAfter = sent.filter((l) => ms(l.sentAt) >= t0)
  // (2) content key: the exact subject this refund must have produced.
  const bySubject = expectedSubject ? atOrAfter.filter((l) => l.subject === expectedSubject) : []
  let pool = bySubject.length ? bySubject : atOrAfter
  let how = bySubject.length ? 'claim + exact expected subject' : 'claim only (no exact subject match)'
  // (3) upper bound as a TIEBREAKER only — never empties a non-empty pool.
  if (nextClaimAt != null && pool.length > 1) {
    const windowed = pool.filter((l) => ms(l.sentAt) < ms(nextClaimAt))
    if (windowed.length) { pool = windowed; how += ' + next-claim window' }
  }
  const log = pool[0] || null
  return {
    claim,
    claimKey,
    log,
    selection: log ? how + ' (' + pool.length + ' candidate(s) at/after the claim, earliest taken)' : 'no sent e-mail at/after the claim',
    candidates: atOrAfter.length,
    ignored: sent.length - atOrAfter.length,
    subjectMatch: log && expectedSubject ? log.subject === expectedSubject : null,
  }
}

// ── OPERATOR ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('[1] env (read-only)')
  const texts = prov.readNextEnvFiles(fs, path, APP_ROOT)
  const merged = prov.mergeNextEnvFiles(texts).merged
  const dbName = ((merged.DATABASE_URL || '').match(/\/([A-Za-z0-9_\-]+)(\?|$)/) || [])[1] || 'unknown'
  if (/prod/i.test(dbName)) return fail('1 env: PROD-named database — refusing')
  try { H.loadRuntimeEnv(APP_ROOT) } catch (e) { return fail('1 env: loader ' + scrub(e)) }
  const rt = H.envFacts(process.env)
  if (rt.stripeMode !== 'TEST') return fail('1 env: Stripe key mode ' + rt.stripeMode + ' — refusing (TEST only)')
  F('ORDER', ORDER_ID + (TARGET_AMOUNT != null ? ' · target refund ' + TARGET_AMOUNT + ' c' : ' · target = latest succeeded refund'))
  F('DATABASE', dbName + ' · DATABASE_URL available ' + (rt.databaseUrl ? 'YES' : 'NO'))
  F('STRIPE MODE', rt.stripeMode)
  F('ROUNDCUBE DISPLAY TIMEZONE', 'NOT MEASURED (client-side display; every value below is UTC)')

  console.log('[2] database (read-only)')
  const prismaRes = H.resolveFromApp('@prisma/client', APP_ROOT)
  if (!prismaRes.ok || !rt.databaseUrl) return fail('2 db: prisma not available (' + (prismaRes.ok ? 'no DATABASE_URL' : prismaRes.error) + ')')
  let prisma
  try { const { PrismaClient } = require(prismaRes.path); prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } }) } catch (e) { return fail('2 db: prisma construct ' + scrub(e)) }

  let refundRows = [], dispatches = [], logs = [], restaurantName = null, nextClaimAt = null
  try {
    const order = await prisma.order.findUnique({ where: { id: ORDER_ID }, select: { id: true, consumerId: true, restaurantId: true } })
    if (!order) return fail('2 db: order ' + ORDER_ID + ' not found')
    const [consumer, resto] = await Promise.all([
      prisma.operator.findUnique({ where: { id: order.consumerId }, select: { email: true } }),
      prisma.restaurant.findUnique({ where: { id: order.restaurantId }, select: { name: true } }),
    ])
    // Same fallback as the route (`resto?.name ?? 'votre restaurant'`).
    restaurantName = (resto && resto.name) || 'votre restaurant'
    F('RESTAURANT (subject component)', restaurantName)
    F('CONSUMER EMAIL DOMAIN', domainOf(consumer && consumer.email))

    refundRows = await prisma.refund.findMany({ where: { orderId: order.id }, select: { id: true, status: true, amountCents: true, stripeRefundId: true, createdAt: true }, orderBy: { createdAt: 'asc' } })
    F('DB REFUND ROWS (this order)', refundRows.length ? refundRows.map((r) => r.status + ':' + r.amountCents + ':' + mask(r.stripeRefundId) + ' createdAt ' + iso(r.createdAt)).join(' | ') : 'none')

    dispatches = await prisma.emailDispatch.findMany({ where: { trigger: 'refund_confirmation', dedupeKey: { startsWith: 'order:' + order.id + ':' } }, select: { dedupeKey: true, createdAt: true }, orderBy: { createdAt: 'asc' } })
    F('EMAIL DISPATCH CLAIMS (refund_confirmation, this order)', dispatches.length ? dispatches.map((d) => d.dedupeKey.replace(order.id, '<order>') + ' claimedAt ' + iso(d.createdAt)).join(' | ') : 'none')

    const since = new Date(Date.now() - LOOKBACK_H * 3600 * 1000)
    logs = await prisma.emailLog.findMany({ where: { trigger: 'refund_confirmation', sentAt: { gte: since }, ...(consumer && consumer.email ? { recipient: consumer.email } : {}) }, select: { subject: true, status: true, sentAt: true, recipient: true }, orderBy: { sentAt: 'asc' } })
    F('EMAILLOG CANDIDATES (refund_confirmation, this consumer, last ' + LOOKBACK_H + ' h)', logs.length ? logs.map((l) => l.status + ' · sentAt ' + iso(l.sentAt) + ' · to ' + domainOf(l.recipient) + ' · "' + l.subject + '"').join(' | ') : 'none')
    F('SEVERAL REFUND E-MAILS FOR THIS CONSUMER', logs.length > 1 ? 'YES (' + logs.length + ') — legitimate; correlation below picks the one belonging to THIS refund' : 'no')
    if (!logs.length) A('2 db: NO refund_confirmation EmailLog row for this consumer inside the ' + LOOKBACK_H + ' h lookback — if the rehearsal is older than that, this is a LOOKBACK artefact, not a missing e-mail: re-run with PHASE2_EMAIL_LOOKBACK_HOURS large enough to cover it')
    if (!(consumer && consumer.email)) A('2 db: consumer e-mail unknown — the EmailLog query could NOT be restricted to this consumer, so candidate rows may belong to other customers')
  } catch (e) { return fail('2 db: ' + scrub(e)) }

  console.log('[3] target refund row')
  const target = selectTargetRefund(refundRows, TARGET_AMOUNT)
  F('TARGET REFUND ROW (DB)', target.refund ? target.refund.status + ':' + target.refund.amountCents + ':' + mask(target.refund.stripeRefundId) + ' createdAt ' + iso(target.refund.createdAt) : 'NONE')
  F('TARGET SELECTION', target.selection)
  if (target.ambiguous) A('3 target: SEVERAL succeeded refunds of ' + TARGET_AMOUNT + ' c on this order — they share one e-mail dedupeKey (order:<id>:' + TARGET_AMOUNT + '), so the second e-mail was suppressed as a duplicate and no per-refund correlation is possible (product finding, see GO-LIVE-TICKETS T-47)')
  if (!target.refund) { await prisma.$disconnect().catch(() => {}); return fail('3 target: ' + target.selection) }
  if (!target.refund.stripeRefundId) { await prisma.$disconnect().catch(() => {}); return fail('3 target: refund row has no Stripe refund id') }

  console.log('[4] stripe TEST truth (read-only)')
  let stripe
  try { stripe = H.makeStripeClient(process.env.STRIPE_SECRET_KEY, APP_ROOT, { apiBase: process.env.PHASE2_STRIPE_API_BASE, allowLoopback: process.env.PHASE2_ALLOW_LOOPBACK === '1' }).client } catch (e) { await prisma.$disconnect().catch(() => {}); return fail('4 stripe: client ' + scrub(e)) }
  let refund, charge = null
  try { refund = await stripe.refunds.retrieve(target.refund.stripeRefundId) } catch (e) { await prisma.$disconnect().catch(() => {}); return fail('4 stripe: refund retrieve ' + scrub(e)) }
  if (!Number.isInteger(refund.created) || refund.created <= 0) { await prisma.$disconnect().catch(() => {}); return fail('4 stripe: refund has no valid created timestamp') }
  F('STRIPE REFUND', mask(refund.id) + ' status ' + refund.status + ' amount ' + refund.amount + ' created ' + iso(refund.created))
  if (refund.status !== 'succeeded') A('4 stripe: refund status is ' + refund.status + ', not succeeded')
  if (refund.amount !== target.refund.amountCents) A('4 stripe: Stripe amount ' + refund.amount + ' ≠ DB row amount ' + target.refund.amountCents)
  const chargeId = refund.charge || null
  if (chargeId) {
    try { charge = stripe.kind === 'rest-readonly' ? await stripe.retrieveAny('charges', chargeId) : await stripe.charges.retrieve(chargeId) } catch (e) { A('4 stripe: charge retrieve ' + scrub(e)) }
  }
  // `partial` exactly as the ENGINE computes it (lib/refund.ts): base = charge.amount, cumulative =
  // Stripe's own refund truth. Audit 2026-09-09: summing DB `Refund` rows instead diverges as soon as a
  // refund exists that the rail did not create (Stripe Dashboard refunds have NO DB row), which flipped
  // the expected template and produced a FAIL on a correct run. Slice from Stripe, never from the DB.
  let partial = null
  if (charge && Number.isInteger(charge.amount) && Number.isInteger(charge.amount_refunded)) {
    F('STRIPE CHARGE', mask(charge.id) + ' amount ' + charge.amount + ' · captured ' + charge.amount_captured + ' · refunded ' + charge.amount_refunded + ' · refunded flag ' + charge.refunded)
    // NB: the read-only REST client's list() returns a paging wrapper (autoPagingToArray only),
    // and the real SDK supports the same call — always page it, never read `.data` off the wrapper.
    let list = null
    try { list = await stripe.refunds.list({ charge: charge.id, limit: 100 }).autoPagingToArray({ limit: 100 }) } catch (e) { A('4 stripe: refunds.list ' + scrub(e)) }
    if (Array.isArray(list)) {
      const tpl = computeTemplateFlag({ chargeAmount: charge.amount, refunds: list, target: refund })
      partial = tpl.partial
      F('STRIPE REFUNDS ON THE CHARGE', list.length + ' (' + list.map((r) => mask(r.id) + ':' + r.status + ':' + r.amount).join(' ') + ')')
      F('CUMULATIVE THROUGH THIS REFUND / REMAINING AFTER (Stripe truth, base charge.amount)', tpl.cumulativeThrough + ' / ' + tpl.remainingAfter)
      const dbCumulative = refundRows.filter((r) => r.status === 'succeeded' && ms(r.createdAt) <= ms(target.refund.createdAt)).reduce((a, r) => a + r.amountCents, 0)
      if (dbCumulative !== tpl.cumulativeThrough) A('4 stripe: DB refund rows sum ' + dbCumulative + ' ≠ Stripe cumulative ' + tpl.cumulativeThrough + ' — a refund exists that the rail did not create (Stripe Dashboard?), reconcile with phase2-preflight.js')
    } else A('4 stripe: refund list not measured — partial/full template cannot be derived')
  } else A('4 stripe: charge not measured — partial/full template cannot be derived')
  const expectedSubject = partial === null ? null : expectedRefundSubject(restaurantName, partial)
  F('EXPECTED EMAIL TEMPLATE', partial === null ? 'NOT MEASURED' : (partial ? 'PARTIAL' : 'FULL'))
  F('EXPECTED SUBJECT', expectedSubject === null ? 'NOT MEASURED' : '"' + expectedSubject + '"')

  console.log('[5] correlate the e-mail to THIS refund')
  try {
    const claim = dispatches.find((d) => d.dedupeKey === 'order:' + ORDER_ID + ':' + target.refund.amountCents)
    if (claim) {
      const next = await prisma.emailDispatch.findFirst({ where: { trigger: 'refund_confirmation', createdAt: { gt: claim.createdAt } }, select: { createdAt: true }, orderBy: { createdAt: 'asc' } })
      nextClaimAt = next ? next.createdAt : null
    }
  } catch (e) { A('5 correlate: next-claim bound not measured — ' + scrub(e)) } finally { await prisma.$disconnect().catch(() => {}) }

  const sel = correlateRefundEmail({ dispatches, logs, orderId: ORDER_ID, amountCents: target.refund.amountCents, expectedSubject, nextClaimAt })
  F('CORRELATION KEY', sel.claimKey.replace(ORDER_ID, '<order>') + ' (EmailDispatch dedupeKey — exact per order+amount; EmailLog has NO order/refund foreign key)')
  F('CORRELATION METHOD', sel.selection)
  F('NEXT CLAIM (any order) — window bound', nextClaimAt ? iso(nextClaimAt) : 'none (this is the latest claim)')
  F('EMAILLOG ROWS IGNORED (sent BEFORE this claim — cannot belong to this refund)', String(sel.ignored))
  F('CORRELATED EMAILLOG ROW', sel.log ? sel.log.status + ' · sentAt ' + iso(sel.log.sentAt) + ' · "' + sel.log.subject + '"' : 'NONE')
  if (!sel.claim) A('5 correlate: no EmailDispatch claim for this refund — the e-mail cannot be proven')
  else if (!sel.log) A('5 correlate: no sent EmailLog row at/after the claim — no e-mail proven for this refund')
  if (sel.log && sel.subjectMatch === false) A('5 correlate: correlated subject ≠ expected ' + (partial ? 'PARTIAL' : 'FULL') + ' template')

  console.log('[6] ordering')
  const stripeSucceededAt = refund.created * 1000
  const sentAt = sel.log ? ms(sel.log.sentAt) : null
  const claimAt = sel.claim ? ms(sel.claim.createdAt) : null
  F('EMAIL SENT (correlated row)', sel.log ? 'YES' : 'NO')
  F('STRIPE REFUND SUCCEEDED AT UTC', iso(refund.created) + ' (refund.created — the object is already status=' + refund.status + ' at creation for a card refund; Stripe exposes no separate succeeded_at, so this is the earliest instant at which the e-mail could legitimately be sent)')
  F('EMAIL DISPATCH CLAIMED AT UTC', claimAt !== null ? new Date(claimAt).toISOString() : 'NOT AVAILABLE')
  F('EMAILLOG SENT AT UTC', sentAt !== null ? new Date(sentAt).toISOString() : 'NOT AVAILABLE')
  F('EMAIL PROVIDER ACCEPTED AT UTC', 'NOT AVAILABLE (SMTP relay acceptance time is not stored; EmailLog.sentAt is written after transporter.sendMail resolved)')
  let after = 'NOT MEASURED'
  if (sentAt !== null) {
    after = sentAt >= stripeSucceededAt ? 'YES' : 'NO'
    if (claimAt !== null && claimAt < stripeSucceededAt) after = 'NO'
  }
  F('EMAIL SENT AFTER STRIPE SUCCEEDED', after + (sentAt !== null ? ' (Δ ' + ((sentAt - stripeSucceededAt) / 1000).toFixed(3) + ' s after the Stripe refund was created)' : ''))
  if (after !== 'YES') A('6 ordering: the e-mail is not proven to follow the Stripe success')
  F('CODE CONTRACT', 'app/api/admin/refunds/run/route.ts calls sendRefundConfirmation ONLY after result.ok (pending 202 / failed ⇒ no e-mail); amount = result.amountCents of the succeeded refund; copy neutral since ca0e19a (no restaurant-as-refunder, no numeric bank delay, no loyalty-as-cash)')
  done(anomalies.length ? 'FAIL' : 'PASS')
}

if (require.main === module) main().catch((e) => fail('unexpected: ' + scrub(e)))

module.exports = { selectTargetRefund, correlateRefundEmail, expectedRefundSubject, computeTemplateFlag }
