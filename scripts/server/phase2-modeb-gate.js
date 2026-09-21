#!/usr/bin/env node
'use strict'
/* GRUBANO — OPÉRATEUR MODE B (staging uniquement)
 *
 * POURQUOI CET OPÉRATEUR EXISTE. Mode B = une réclamation approuvée qui déplace VRAIMENT de l'argent
 * (Stripe TEST). Le déclenchement du remboursement a lieu DANS l'action de réclamation
 * (lib/claims.ts triggerClaimRefund) et le balayage d'auto-approbation exige lui aussi
 * isClaimsEnabled() : les DEUX baux doivent donc être ouverts AU MÊME INSTANT, dans le MÊME
 * processus. Or les deux opérateurs existants se refusent MUTUELLEMENT par construction :
 *   · phase2-claims-gate refuse d'ouvrir si la gate refund n'est pas CLOSED, et la re-sonde toutes
 *     les 15 s (toute ouverture ⇒ fermeture immédiate) ;
 *   · phase2-refund-gate lève une anomalie si CLAIMS_ENABLED === 'true'.
 * C'est volontaire et c'était juste tant que Mode B n'était pas autorisé. Cet opérateur-ci est la
 * SEULE porte qui ouvre les deux ensemble, sous UNE phrase d'autorisation, pour UNE commande, UN
 * montant, et une durée bornée par le plus COURT des deux plafonds.
 *
 * CE QU'IL NE FAIT PAS : il n'exécute AUCUN remboursement. Il ouvre, il observe, il referme, il
 * prouve. Le remboursement est déclenché par l'humain (console admin) ou par le dispatch GitHub.
 *
 * MODES
 *   node scripts/server/phase2-modeb-gate.js            → PRECHECK, LECTURE SEULE (défaut)
 *   node scripts/server/phase2-modeb-gate.js window     → FENÊTRE BORNÉE (exige la phrase)
 *
 * VARIABLES (toutes obligatoires en mode window)
 *   PHASE2_MODEB_CONFIRM="I AUTHORIZE THE STAGING MODE B REHEARSAL"
 *   PHASE2_MODEB_ORDER_ID=<id de la commande fraîche>
 *   PHASE2_MODEB_AMOUNT_CENTS=<montant exact de la répétition>
 *   PHASE2_MODEB_EXPECT_SHA=<SHA court certifié — les 7 premiers caractères de version.json>
 *
 * VARIABLES OPTIONNELLES (ne pas les poser pour la répétition : les défauts sont les valeurs certifiées)
 *   PHASE2_MODEB_WINDOW_MS  défaut 15 min ; plafond 28 min (bail = fenêtre + 2 min ≤ 30 min)
 *   PHASE2_MODEB_GRACE_MS   défaut 20 s ; attente entre l'objet Stripe observé et la fermeture (bornée par le bail)
 *   PHASE2_MODEB_POLL_MS · PHASE2_RELOAD_DEADLINE_MS · PHASE2_RELOAD_INTERVAL_MS · PHASE2_APP_ROOT (tests)
 *
 * RÉSULTATS (dernière ligne « RESULT = … ») — seuls READY et PASS sortent en code 0
 *   READY FOR FOUNDER AUTHORIZATION   precheck vert, rien ouvert
 *   BLOCKED — voir anomalies          precheck refusé, rien ouvert
 *   PASS                              fenêtre ouverte puis refermée ; EXACTEMENT UN remboursement Stripe
 *                                     « succeeded » du montant autorisé, payé PAR la réclamation (jointure DB)
 *   NOT EXECUTED — …                  fenêtre ouverte puis refermée proprement, aucun remboursement
 *   FAIL                              toute anomalie (y compris un refus avant ouverture : rien changé)
 *
 * AUCUNE VALEUR SECRÈTE N'EST IMPRIMÉE. Aucune sauvegarde .env.local ancienne n'est jamais
 * restaurée : on n'écrit QUE les quatre clés, une par une, avec sauvegarde horodatée.
 */
const fs = require('fs')
const path = require('path')
const H = require(path.join(__dirname, 'reconcile-helpers.js'))

const MODE = process.argv[2] === 'window' ? 'window' : 'precheck'
const APP_ROOT = process.env.PHASE2_APP_ROOT || path.join(__dirname, '..', '..')
const CONFIRM_SENTENCE = 'I AUTHORIZE THE STAGING MODE B REHEARSAL'
const ORDER_ID = (process.env.PHASE2_MODEB_ORDER_ID || '').trim()
const AMOUNT_CENTS = Number(process.env.PHASE2_MODEB_AMOUNT_CENTS || 0)
const EXPECT_SHA = (process.env.PHASE2_MODEB_EXPECT_SHA || '').trim()
const WINDOW_MS = Number(process.env.PHASE2_MODEB_WINDOW_MS || 15 * 60 * 1000)
const POLL_MS = Number(process.env.PHASE2_MODEB_POLL_MS || 15000)
const RELOAD_DEADLINE_MS = Number(process.env.PHASE2_RELOAD_DEADLINE_MS || 240000)
const RELOAD_INTERVAL_MS = Number(process.env.PHASE2_RELOAD_INTERVAL_MS || 10000)

/* PLAFONDS DES BAUX — compilés dans l'application, jamais devinés ici :
 *   CLAIMS_WINDOW_MAX_MS  = 60 min (lib/claims.ts)
 *   REFUND_WINDOW_MAX_MS  = 30 min (lib/refund.ts)
 * Mode B a besoin des deux EN MÊME TEMPS ⇒ la fenêtre commune est bornée par le plus COURT (30 min),
 * et le bail est écrit à fenêtre + 2 min. Au-delà de 28 min, cet opérateur REFUSE plutôt que de
 * laisser l'application fermer une fenêtre qu'il continuerait d'annoncer ouverte. */
const REFUND_LEASE_MAX_MS = 30 * 60 * 1000
const CLAIMS_LEASE_MAX_MS = 60 * 60 * 1000
const LEASE_SLACK_MS = 2 * 60 * 1000
/* Marge exigée avant l'expiration de la fenêtre de réclamation (48 h ancrées sur Order.updatedAt). */
const CLAIM_WINDOW_MARGIN_H = 1
/* GRÂCE entre l'observation de l'objet Stripe et la fermeture. La requête d'approbation CONTINUE après
 * la création du remboursement : écritures DB, puis e-mail client — dont l'envoi relit la gate
 * (arbitrate/route.ts → isClaimsEnabled()). La réclamation lit « refunded » AVANT l'envoi SMTP :
 * refermer et redémarrer Passenger à cet instant couperait l'e-mail de succès, et le renvoyer
 * exigerait une nouvelle fenêtre. Toujours bornée par le bail. */
const GRACE_MS = Number(process.env.PHASE2_MODEB_GRACE_MS || 20000)
/* Toute sonde HTTP est bornée : une requête pendue ne doit jamais porter la boucle au-delà du bail. */
const FETCH_TIMEOUT_MS = 20000

const LOCK_DIR = path.join(process.env.HOME || process.env.USERPROFILE || APP_ROOT, '.grubano')
/* PORTÉE DU VERROU — à dire honnêtement : ce fichier de verrou est pris et rendu par CET
 * opérateur seulement. phase2-refund-gate.js et phase2-claims-gate.js ne l'écrivent pas (encore),
 * donc le verrou exclut un second Mode B, PAS un opérateur frère lancé en parallèle. Aucun
 * balayage de processus n'existe dans ce fichier : le seul garde-fou contre ce cas est la règle
 * humaine, un seul opérateur à la fois. Ne pas présenter ce verrou comme davantage qu'il n'est. */
const LOCK_FILE = path.join(LOCK_DIR, 'phase2-operator.lock')

const facts = []
const anomalies = []
const F = (k, v) => { facts.push(k + ': ' + v); console.log('   ' + k + ': ' + v) }
const A = (m) => { anomalies.push(m); console.log('!! ANOMALY ' + m) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mask = (s) => (s ? String(s).slice(0, 10) + '…' : 'null')
// Chaîne de masquage IDENTIQUE aux deux opérateurs de référence : clé Stripe, puis toute URL, puis
// tout jeton de 24 caractères ou plus, puis troncature à 160. Une chaîne plus faible ici serait une
// régression de confidentialité par rapport au standard maison.
const scrub = (m) => String(m == null ? '' : ((m && m.message) || m))
  .replace(/sk_(test|live)_[A-Za-z0-9]+/g, 'sk_***')
  .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, '<url>')
  .replace(/[A-Za-z0-9_-]{24,}/g, '…')
  .slice(0, 160)

function done(result) {
  // TOUTE sortie rend le verrou : un `return fail(…)` précoce laissait ~/.grubano/phase2-operator.lock
  // derrière lui (pid mort) — faux positif « opérateur en cours » si le pid est réutilisé, et preuve
  // « aucun verrou périmé » fausse après un simple refus. releaseLock ne rend que NOTRE verrou.
  releaseLock()
  console.log('')
  console.log('RESULT = ' + result)
  console.log('ANOMALIES = ' + (anomalies.length || 'none'))
  for (const m of anomalies) console.log('  - ' + m)
  process.exitCode = result === 'PASS' || result.startsWith('READY') ? 0 : 1
  // Sortie forcée comme les opérateurs frères : une poignée Prisma ouverte ne doit pas faire
  // croire que l'opérateur « tourne encore » alors que son verdict est rendu.
  setTimeout(() => process.exit(process.exitCode), 1500).unref()
}
function fail(m) { A(m); done('FAIL'); return null }

/* ── primitives d'écriture (identiques aux opérateurs existants, marqueur propre) ───────────── */
function writeFlag(envFile, key, value, stamp) {
  const txt = fs.readFileSync(envFile, 'utf8')
  const eol = txt.includes('\r\n') ? '\r\n' : '\n'
  let seen = false, changed = false
  const out = txt.split(/\r?\n/).map((raw) => {
    const t = raw.replace(/^﻿/, '').trim()
    if (!t || t.startsWith('#')) return raw
    const m = t.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
    if (!m || m[1] !== key) return raw
    if (seen) { changed = true; return '# phase2-modeb-gate ' + stamp + ' duplicate neutralised: ' + raw }
    seen = true
    const canonical = key + '=' + value
    if (raw !== canonical) changed = true
    return canonical
  })
  if (!seen) { if (out.length && out[out.length - 1] !== '') out.push(''); out.push('# phase2-modeb-gate ' + stamp + ' — ' + key); out.push(key + '=' + value); changed = true }
  if (!changed) return { changed: false, backup: null }
  const backup = envFile + '.bak-modeb-gate-' + stamp.replace(/[:.]/g, '-')
  fs.copyFileSync(envFile, backup); try { fs.chmodSync(backup, 0o600) } catch { /* best-effort */ }
  let text = out.join(eol); if (!text.endsWith(eol)) text += eol
  fs.writeFileSync(envFile, text, { mode: 0o600 }); try { fs.chmodSync(envFile, 0o600) } catch { /* best-effort */ }
  return { changed: true, backup: path.basename(backup) }
}
function touchRestart() {
  fs.mkdirSync(path.join(APP_ROOT, 'tmp'), { recursive: true })
  fs.writeFileSync(path.join(APP_ROOT, 'tmp', 'restart.txt'), 'phase2-modeb-gate ' + new Date().toISOString())
}

/* FERMETURE D'URGENCE — armée dès la PREMIÈRE clé ouverte, désarmée seulement quand les quatre
 * valeurs fermées sont sur le disque. Un `finally` ne suffit pas : il faut aussi les signaux. */
let armedClose = null
function emergencyClose() {
  if (!armedClose) return
  const { envFile, stamp } = armedClose
  armedClose = null            // une seule fois, quoi qu'il arrive ensuite
  // CHAQUE écriture dans SON try : un échec sur l'une ne doit JAMAIS empêcher les trois autres.
  // Les baux d'abord (l'autorisation meurt même si un drapeau résiste), les drapeaux ensuite.
  const past = new Date(Date.now() - 1000).toISOString()
  const writes = [
    ['REFUNDS_WINDOW_UNTIL', past], ['CLAIMS_WINDOW_UNTIL', past],
    ['REFUNDS_ENABLED', 'false'], ['CLAIMS_ENABLED', 'false'],
  ]
  const failedKeys = []
  for (const [k, v] of writes) {
    try { writeFlag(envFile, k, v, stamp + 'Z') } catch (e) { failedKeys.push(k); console.log('!! EMERGENCY CLOSE — écriture ' + k + ' ÉCHOUÉE : ' + scrub(e)) }
  }
  try { touchRestart() } catch (e) { console.log('!! EMERGENCY CLOSE — restart ÉCHOUÉ : ' + scrub(e)) }
  if (failedKeys.length) {
    console.log('!! ACTION HUMAINE REQUISE MAINTENANT : mettre ' + failedKeys.join(' et ') + ' à false/expiré dans ' + envFile + ' puis « touch tmp/restart.txt »')
  } else {
    console.log('!! EMERGENCY CLOSE — les quatre clés sont fermées sur le disque')
  }
}
// Ces sorties court-circuitent done() : elles rendent le verrou elles-mêmes (releaseLock ne retire que
// NOTRE verrou — jamais celui d'un autre opérateur vivant).
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT', 'SIGBREAK']) {
  process.on(sig, () => { emergencyClose(); releaseLock(); process.exit(1) })
}
process.on('uncaughtException', (e) => { console.log('!! uncaught: ' + scrub(e)); emergencyClose(); releaseLock(); process.exit(1) })

/* ── ADAPTATEUR STRIPE : UNE surface, DEUX clients ───────────────────────────────────────────
 * LE DÉFAUT QUI A ÉCHAPPÉ (précheck final 2026-09-21) : le runtime standalone déployé n'embarque
 * PAS le SDK `stripe` (Next le bundle dans ses chunks serveur), donc `H.makeStripeClient` renvoie le
 * client REST lecture seule — qui n'a ni `balance`, ni `accounts`, ni `.data` sur ses listes. La
 * première version de cet opérateur supposait le SDK complet : elle refusait TOUTE fenêtre
 * (financement « NON VÉRIFIABLE ») et aurait lu 0 remboursement pour toujours.
 *
 * RÈGLES : (1) on n'invente pas un troisième client, on parle aux DEUX surfaces existantes ;
 * (2) une forme de réponse non comprise n'est JAMAIS lue comme « zéro » — elle échoue fermée ;
 * (3) une liste plafonnée est ambiguë, donc fermée.
 *
 * RESSERREMENTS par rapport à 71caabc (tous dans le sens FERMÉ, aucun refus retiré) : une PI sans
 * destination Connect refuse (avant : bloc financement sauté en silence) ; tout objet remboursement
 * Stripe déjà présent sur la PI refuse le precheck (avant : lignes DB seulement) ; charge non
 * capturée, PI live, devise ≠ EUR, `disputed` / `amount_refunded` illisibles refusent. */
const REFUND_LIST_CAP = 100

function stripeAdapter(client) {
  if (!client || typeof client !== 'object') throw new Error('stripe_client_missing')
  const rest = client.kind === 'rest-readonly' ? client : null
  const sdk = !rest && client.balance && typeof client.balance.retrieve === 'function'
    && client.accounts && typeof client.accounts.retrieve === 'function' ? client : null
  if (!rest && !sdk) throw new Error('stripe_client_shape_unknown')
  return {
    kind: rest ? 'rest-readonly' : 'sdk',
    retrievePaymentIntent: (id) => client.paymentIntents.retrieve(id, { expand: ['latest_charge'] }),
    retrieveAccount: (id) => (rest ? rest.retrieveAny('accounts', id) : sdk.accounts.retrieve(id)),
    balanceFor: (id) => (rest ? rest.balanceFor(id) : sdk.balance.retrieve({}, { stripeAccount: id })),
    /** Énumération des remboursements d'une PI — même chemin pour les deux clients. */
    listRefunds: async (piId) => normalizeRefundList(await enumerateRefunds(client, piId)),
  }
}

/* Les deux clients exposent `.list(params).autoPagingToArray({limit})` : c'est le seul chemin utilisé.
 * Le résultat brut est passé au normaliseur, qui refuse tout ce qu'il ne comprend pas. */
async function enumerateRefunds(client, piId) {
  const res = client.refunds.list({ payment_intent: piId, limit: REFUND_LIST_CAP })
  if (res && typeof res.autoPagingToArray === 'function') return { kind: 'array', value: await res.autoPagingToArray({ limit: REFUND_LIST_CAP }) }
  return { kind: 'page', value: await res }
}

/** Normalise une énumération de remboursements. Échoue FERMÉ sur toute ambiguïté. */
function normalizeRefundList(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('stripe_refund_list_unreadable')
  let items
  if (raw.kind === 'array') {
    if (!Array.isArray(raw.value)) throw new Error('stripe_refund_list_shape_unknown')
    items = raw.value
    // autoPagingToArray({limit: CAP}) s'arrête au plafond SANS dire s'il reste des éléments : ambigu.
    if (items.length >= REFUND_LIST_CAP) throw new Error('stripe_refund_list_truncated')
  } else if (raw.kind === 'page') {
    const page = raw.value
    if (!page || typeof page !== 'object' || !Array.isArray(page.data)) throw new Error('stripe_refund_list_shape_unknown')
    if (page.has_more === true) throw new Error('stripe_refund_list_truncated')
    // Une page sans `has_more: false` EXPLICITE ne prouve pas qu'elle est complète.
    if (page.has_more !== false) throw new Error('stripe_refund_list_shape_unknown')
    items = page.data
  } else throw new Error('stripe_refund_list_shape_unknown')
  for (const r of items) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !Number.isInteger(r.amount) || typeof r.status !== 'string') {
      throw new Error('stripe_refund_list_malformed')
    }
  }
  return items
}

/** Solde disponible EUR d'un compte connecté, ou une erreur — jamais un 0 par défaut. */
function readAvailableEur(bal) {
  if (!bal || typeof bal !== 'object' || !Array.isArray(bal.available) || !Array.isArray(bal.pending)) throw new Error('stripe_balance_shape_unknown')
  const eurA = bal.available.find((x) => x && x.currency === 'eur')
  const eurP = bal.pending.find((x) => x && x.currency === 'eur')
  if (eurA && !Number.isInteger(eurA.amount)) throw new Error('stripe_balance_malformed')
  if (eurP && !Number.isInteger(eurP.amount)) throw new Error('stripe_balance_malformed')
  return { available: eurA ? eurA.amount : 0, pending: eurP ? eurP.amount : 0, eurListed: !!eurA }
}

/** Planning de versement d'un compte connecté, ou une erreur — jamais un « ? » lu comme un fait. */
function readPayoutSchedule(acct) {
  const interval = acct && acct.settings && acct.settings.payouts && acct.settings.payouts.schedule
    ? acct.settings.payouts.schedule.interval : undefined
  if (typeof interval !== 'string' || !interval) throw new Error('stripe_account_shape_unknown')
  return interval
}

/* Le bloc de mesure Stripe, factorisé pour être exécuté par les tests contre le client REST forcé
 * (parité avec le runtime déployé) sans réseau et sans ouvrir quoi que ce soit. Retourne les faits ;
 * les refus sont émis via A(). */
async function measureStripeFacts(client, input) {
  const { piId, amountCents, F, A } = input
  let adapter
  try { adapter = stripeAdapter(client) } catch (e) {
    A('6 stripe: client inutilisable (' + scrub(e) + ') — faits Stripe NON MESURÉS')
    return { dest: null, charge: null, pi: null, remaining: null, available: null, schedule: null }
  }
  F('STRIPE CLIENT', adapter.kind === 'rest-readonly' ? 'REST lecture seule (runtime standalone, sans SDK)' : 'SDK complet')
  const out = { dest: null, charge: null, pi: null, remaining: null, available: null, schedule: null, adapter }
  let pi, ch
  try {
    pi = await adapter.retrievePaymentIntent(piId)
    ch = pi && pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
    out.pi = pi; out.charge = ch
    out.dest = pi && pi.transfer_data && pi.transfer_data.destination
      ? (typeof pi.transfer_data.destination === 'string' ? pi.transfer_data.destination : pi.transfer_data.destination.id) : null
    F('PAYMENT INTENT', mask(pi.id) + ' · ' + pi.status + ' · amount ' + pi.amount + ' · fee ' + pi.application_fee_amount + ' · destination ' + mask(out.dest) + ' · livemode ' + pi.livemode)
    if (pi.livemode === true) A('6 stripe: PaymentIntent LIVE — MODE B est interdit hors Stripe TEST')
    if (pi.status !== 'succeeded') A('6 stripe: PaymentIntent « ' + pi.status + ' » — rien à rembourser')
    // Le solde comparé plus bas est la ligne EUR : une PI dans une autre devise rendrait la comparaison fausse.
    if (pi.currency !== 'eur') A('6 stripe: devise « ' + pi.currency + ' » — comparaison au solde EUR NON PROUVÉE')
    if (!ch) A('6 stripe: aucune charge exploitable sur la PaymentIntent')
    else {
      F('CHARGE', mask(ch.id) + ' · captured ' + ch.amount_captured + ' · refunded ' + ch.amount_refunded + ' · disputed ' + ch.disputed)
      if (ch.captured !== true || !Number.isInteger(ch.amount_captured) || ch.amount_captured <= 0) A('6 stripe: charge NON capturée — rien à rembourser')
      // Un `disputed` absent n'est pas « non contesté » : le litige est NON PROUVÉ.
      if (typeof ch.disputed !== 'boolean') A('6 stripe: disputed illisible — litige NON PROUVÉ')
      else if (ch.disputed) A('6 stripe: charge CONTESTÉE — remboursement interdit (litige)')
      if (!Number.isInteger(ch.amount_refunded)) A('6 stripe: amount_refunded illisible — cash remboursable NON PROUVÉ')
      else {
        out.remaining = (ch.amount_captured || 0) - ch.amount_refunded
        F('REMAINING REFUNDABLE (Stripe)', String(out.remaining))
        if (amountCents > 0 && out.remaining < amountCents) A('6 stripe: cash remboursable ' + out.remaining + ' c < montant de répétition ' + amountCents + ' c')
      }
      // commit A : une charge routée SANS commission ferait écrire une ligne que Stripe rejette.
      if (out.dest && !(ch.application_fee_amount > 0)) A('6 stripe: charge ROUTÉE sans commission — le moteur demanderait le remboursement d’une commission inexistante (préflight refuserait)')
    }
  } catch (e) { A('6 stripe: lecture PI/charge — ' + scrub(e)); return out }

  // Remboursements existants : une liste illisible ou ambiguë n'est JAMAIS « zéro ».
  try {
    const refunds = await adapter.listRefunds(piId)
    const pending = refunds.filter((r) => r.status === 'pending' || r.status === 'requires_action')
    F('STRIPE REFUNDS (existing)', refunds.length + ' · pending ' + pending.length)
    if (refunds.length) A('6 stripe: ' + refunds.length + ' remboursement(s) Stripe existe(nt) déjà sur cette PI — ce n’est plus une première répétition')
    if (pending.length) A('6 stripe: ' + pending.length + ' remboursement(s) Stripe en attente — cash déjà engagé')
    out.existingRefunds = refunds
  } catch (e) { A('6 stripe: énumération des remboursements illisible/ambiguë (' + scrub(e) + ') — conflits NON PROUVÉS'); return out }

  if (!out.dest) { A('6 funding: aucune destination Connect sur la PI — financement NON VÉRIFIABLE'); return out }
  try {
    const bal = readAvailableEur(await adapter.balanceFor(out.dest))
    out.available = bal.available
    F('CONNECTED AVAILABLE (EUR c)', String(bal.available) + ' · pending ' + bal.pending + (bal.eurListed ? '' : ' · (aucune ligne EUR listée)'))
    // T-42 : Stripe inverse un transfert contre le solde DISPONIBLE du compte connecté.
    if (amountCents > 0 && bal.available < amountCents) {
      A('6 funding: solde connecté disponible ' + bal.available + ' c < BRUT ' + amountCents + ' c (aucun fonds fabriqué, aucune avance plateforme)')
    }
  } catch (e) { A('6 funding: solde connecté illisible (' + scrub(e) + ') — financement NON PROUVÉ'); return out }
  try {
    const sched = readPayoutSchedule(await adapter.retrieveAccount(out.dest))
    out.schedule = sched
    F('CONNECTED PAYOUT SCHEDULE', sched)
    if (sched !== 'manual') A('6 funding: planning de versement « ' + sched + ' » — un versement automatique peut vider le compte avant la fenêtre (précondition : manual)')
  } catch (e) { A('6 funding: planning de versement illisible (' + scrub(e) + ') — précondition NON PROUVÉE') }
  return out
}

/** Verdict d'une répétition : la liste FINALE des remboursements Stripe de la PI doit être exactement
 *  UN objet, du montant autorisé, « succeeded ». Retourne les anomalies (vide = conforme ou rien observé). */
function refundVerdict(refunds, amountCents) {
  const out = []
  if (refunds.length > 1) out.push('11 verdict: ' + refunds.length + ' objets remboursement Stripe sur la PI — la répétition en autorise UN SEUL')
  for (const r of refunds) {
    if (r.amount !== amountCents) out.push('11 verdict: remboursement ' + mask(r.id) + ' de ' + r.amount + ' c ≠ montant autorisé ' + amountCents + ' c')
    if (r.status !== 'succeeded') out.push('11 verdict: remboursement ' + mask(r.id) + ' « ' + r.status + ' » — PAS un succès ; refund.updated / refund.failed font foi')
  }
  return out
}

/** Verdict DB d'une répétition Mode B — la jointure réclamation ↔ ligne Refund ↔ objet Stripe.
 *  Exécutée (un objet Stripe existe) : EXACTEMENT une nouvelle ligne Refund, « succeeded », du montant
 *  autorisé, portant l'id Stripe observé et `reason = claim:<id>` ; EXACTEMENT une nouvelle réclamation,
 *  « refunded », liée à cette ligne, sans erreur ; aucune réclamation ACTIVE ; les réclamations
 *  préexistantes inchangées. Non exécutée : aucune nouvelle ligne ni réclamation active ne doit rester. */
const ACTIVE_CLAIM_STATUSES = ['restaurant_review', 'approved', 'refunding', 'arbitration', 'financial_verification']
function dbVerdict(i) {
  const out = []
  const beforeRowIds = new Set((i.rowsBefore || []).map((r) => r.id))
  const beforeClaims = new Map((i.claimsBefore || []).map((c) => [c.id, c.status]))
  const newRows = i.rowsAfter.filter((r) => !beforeRowIds.has(r.id))
  const newClaims = i.claimsAfter.filter((c) => !beforeClaims.has(c.id))
  for (const c of i.claimsAfter) {
    if (beforeClaims.has(c.id) && beforeClaims.get(c.id) !== c.status) out.push('12 db: une réclamation PRÉEXISTANTE de la commande a changé (' + beforeClaims.get(c.id) + ' → ' + c.status + ')')
  }
  const active = i.claimsAfter.filter((c) => ACTIVE_CLAIM_STATUSES.includes(c.status))
  if (active.length) out.push('12 db: ' + active.length + ' réclamation(s) ACTIVE(S) laissée(s) sur la commande (' + active.map((c) => c.status).join(', ') + ') — elle(s) tien(nen)t activeOrderKey')
  if (!i.executed) {
    if (newRows.length) out.push('12 db: ' + newRows.length + ' nouvelle(s) ligne(s) Refund SANS objet Stripe observé — état NON RÉSOLU')
    return out
  }
  if (newRows.length !== 1) { out.push('12 db: ' + newRows.length + ' nouvelle(s) ligne(s) Refund — la répétition en attend EXACTEMENT UNE'); return out }
  const row = newRows[0]
  const re = i.finalRefunds && i.finalRefunds.length === 1 ? i.finalRefunds[0] : null
  if (row.status !== 'succeeded') out.push('12 db: la ligne Refund est « ' + row.status + ' », pas « succeeded »')
  if (row.amountCents !== i.amountCents) out.push('12 db: la ligne Refund porte ' + row.amountCents + ' c ≠ ' + i.amountCents + ' c autorisés')
  if (!re || row.stripeRefundId !== re.id) out.push('12 db: la ligne Refund ne porte PAS l’id de l’objet Stripe observé — jointure ligne ↔ Stripe NON PROUVÉE')
  if (newClaims.length !== 1) { out.push('12 db: ' + newClaims.length + ' nouvelle(s) réclamation(s) — le remboursement n’est pas prouvé payé PAR la réclamation de la répétition'); return out }
  const claim = newClaims[0]
  if (claim.status !== 'refunded') out.push('12 db: la réclamation est « ' + claim.status + ' », pas « refunded »')
  if (claim.refundError) out.push('12 db: la réclamation porte une erreur de remboursement')
  if (claim.refundId !== row.id) out.push('12 db: la réclamation n’est PAS liée à la ligne Refund (refundId) — jointure réclamation ↔ ligne NON PROUVÉE')
  if (row.reason !== 'claim:' + claim.id) out.push('12 db: la ligne Refund ne porte PAS l’identité de la réclamation (reason) — remboursement non attribué')
  return out
}

/* ── sondes de gate (mêmes sondes runtime que les opérateurs existants) ─────────────────────── */
async function probe(base, pathname) {
  try {
    const r = await fetch(base + pathname, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'grubano-phase2-modeb-gate/1' },
      body: '{}', redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    const b = await r.json().catch(() => null)
    if (r.status === 403 && b && (b.gated === true || b.enabled === false)) return 'CLOSED'
    if (r.status === 401) return 'OPEN'
    // 429 = limite de débit AVANT la gate : cela ne prouve RIEN (leçon Mode A).
    return 'UNKNOWN(' + r.status + ')'
  } catch { return 'UNREACHABLE' }
}
const probeClaims = (base) => probe(base, '/api/claims')
const probeRefunds = (base) => probe(base, '/api/admin/refunds/run')
async function waitBoth(base, want, deadlineMs, intervalMs) {
  const t0 = Date.now(); let c = 'n/a', r = 'n/a'
  while (Date.now() - t0 < deadlineMs) {
    c = await probeClaims(base); r = await probeRefunds(base)
    if (c === want && r === want) return { ok: true, elapsedMs: Date.now() - t0, claims: c, refunds: r }
    await sleep(intervalMs)
  }
  return { ok: false, elapsedMs: Date.now() - t0, claims: c, refunds: r }
}

/* ── verrou inter-opérateurs ────────────────────────────────────────────────────────────────── */
function takeLock() {
  fs.mkdirSync(LOCK_DIR, { recursive: true })
  if (fs.existsSync(LOCK_FILE)) {
    let held = null
    try { held = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')) } catch { held = { pid: null, op: 'unknown' } }
    let alive = false
    if (held && held.pid) { try { process.kill(held.pid, 0); alive = true } catch { alive = false } }
    if (alive) return { ok: false, held }
    F('STALE OPERATOR LOCK', 'pid ' + (held && held.pid) + ' (' + (held && held.op) + ') no longer running — reclaimed')
  }
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, op: 'phase2-modeb-gate', at: new Date().toISOString() }), { mode: 0o600 })
  return { ok: true }
}
function releaseLock() {
  try {
    const held = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'))
    if (held && held.pid === process.pid) fs.unlinkSync(LOCK_FILE)
  } catch { /* best-effort */ }
}

async function main() {
  console.log('')
  console.log('GRUBANO PHASE 2 — OPÉRATEUR MODE B (' + (MODE === 'window' ? 'FENÊTRE BORNÉE' : 'PRECHECK LECTURE SEULE') + ')')
  console.log('Chaque valeur ci-dessous est MESURÉE. Aucun remboursement n’est exécuté par ce script.')
  console.log('')

  F('MODE', MODE)
  const lock = takeLock()
  if (!lock.ok) return fail('0 lock: un autre opérateur phase2 tourne déjà (pid ' + lock.held.pid + ', ' + lock.held.op + ') — rien changé')

  // [1] ENV + identité du déploiement
  try { H.loadRuntimeEnv(APP_ROOT) } catch (e) { return fail('1 env: loader ' + scrub(e)) }
  const rt = H.envFacts(process.env)
  const envFile = path.join(APP_ROOT, '.env.local')
  if (!fs.existsSync(envFile)) return fail('1 env: .env.local introuvable dans ' + APP_ROOT)
  F('STRIPE MODE', rt.stripeMode)
  if (rt.stripeMode !== 'TEST') return fail('1 stripe: la clé n’est pas sk_test_ — MODE B est INTERDIT hors Stripe TEST')
  // VUE FICHIER, jamais le shell. Le protocole maison fait préfixer la commande par
  // NEXTAUTH_URL=… ; un garde-fou de PRODUCTION qui lit ce que l'humain a tapé ne garde rien.
  // Les deux opérateurs de référence lisent la vue FUSIONNÉE des fichiers .env : on fait pareil.
  const prov = require(path.join(__dirname, 'env-provenance.js'))
  let merged = {}
  // ⚠️ SIGNATURE : readNextEnvFiles(fs, path, dir). Appelé avec le seul APP_ROOT, l'helper avale sa
  // propre TypeError fichier par fichier et renvoie {} : NEXTAUTH_URL « ABSENT », refus à chaque
  // lancement (défaut livré en 71caabc/3e32e01, jamais vu parce que main() n'était exécuté par aucun test).
  try { merged = prov.mergeNextEnvFiles(prov.readNextEnvFiles(fs, path, APP_ROOT)).merged || {} } catch (e) { return fail('1 env: lecture des fichiers .env — ' + scrub(e)) }
  if (!Object.keys(merged).length) return fail('1 env: aucune clé lue dans les fichiers .env de ' + APP_ROOT + ' — vue FICHIERS vide, rien n’est prouvable')
  const fileUrl = (merged.NEXTAUTH_URL || '').replace(/\/$/, '')
  const shellUrl = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '')
  F('NEXTAUTH_URL (fichiers)', fileUrl || 'ABSENT')
  if (!/^https:\/\/app\.grubano\.com$/i.test(fileUrl)) {
    return fail('1 env: NEXTAUTH_URL des FICHIERS n’est pas https://app.grubano.com — cet opérateur est STAGING UNIQUEMENT (production INTERDITE)')
  }
  if (shellUrl && shellUrl !== fileUrl) {
    return fail('1 env: NEXTAUTH_URL du shell (' + shellUrl + ') diverge des fichiers — refus, on ne se laisse pas déplacer de cible')
  }
  // Nom de base PROD : refus explicite, comme les opérateurs de référence.
  const dbName = ((merged.DATABASE_URL || process.env.DATABASE_URL || '').match(/\/([A-Za-z0-9_-]+)(\?|$)/) || [])[1] || 'unknown'
  F('DATABASE', dbName)
  if (/prod/i.test(dbName)) return fail('1 env: base nommée PROD (' + dbName + ') — refus avant toute écriture')
  // Cible HTTP : ANCRÉE (une sous-chaîne laisserait passer app.grubano.com.attaquant.test).
  const base = (process.env.PHASE2_BASE_URL || fileUrl).replace(/\/$/, '')
  if (!/^https:\/\/app\.grubano\.com$/i.test(base)) return fail('1 env: cible ' + base + ' — seule https://app.grubano.com est permise (production INTERDITE)')
  // Drapeaux dangereux : aucun automatisme d'argent ne doit être armé pendant la fenêtre.
  for (const k of ['ALLOW_PLATFORM_FALLBACK', 'CLAIMS_AUTO_APPROVE_ENABLED', 'CLAIM_AUTO_RESOLVE_ENABLED', 'GHOST_ORDER_AUTO_REFUND_ENABLED', 'PUNITIVE_CAPTURE_ENABLED', 'REFUND_VOID_ENABLED']) {
    const v = merged[k] ?? process.env[k]
    F('FLAG ' + k, v === undefined ? 'absent' : String(v))
    if (String(v) === 'true') A('1 flag: ' + k + ' est ACTIF — aucun automatisme d’argent ne doit être armé pendant la fenêtre Mode B')
  }

  // [2] SHA déployé = SHA certifié
  let version = null
  try { version = await (await fetch(base + '/version.json', { headers: { 'User-Agent': 'grubano-phase2-modeb-gate/1' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })).json() } catch (e) { A('2 version: illisible — ' + scrub(e)) }
  if (version) F('DEPLOYED SHA', version.shortCommit + ' (branche ' + version.branch + ', build ' + version.buildDate + ')')
  if (version && version.branch && version.branch !== 'develop') return fail('2 version: branche déployée « ' + version.branch + ' » — MODE B est interdit hors develop/staging')
  if (!EXPECT_SHA) A('2 version: PHASE2_MODEB_EXPECT_SHA absent — le SHA certifié n’est pas vérifié')
  else if (!version || !version.shortCommit || !version.shortCommit.startsWith(EXPECT_SHA.slice(0, 7))) {
    return fail('2 version: le SHA déployé (' + (version && version.shortCommit) + ') n’est pas le SHA certifié attendu (' + EXPECT_SHA + ') — rien changé')
  }

  // [3] les DEUX gates doivent être FERMÉES avant tout
  const c0 = await probeClaims(base), r0 = await probeRefunds(base)
  F('CLAIMS GATE (avant)', c0)
  F('REFUNDS GATE (avant)', r0)
  if (c0 !== 'CLOSED') A('3 gate: la gate CLAIMS n’est pas CLOSED (' + c0 + ')')
  if (r0 !== 'CLOSED') A('3 gate: la gate REFUNDS n’est pas CLOSED (' + r0 + ')')

  // [4] DB : éligibilité de la commande + résidus
  const prismaRes = H.resolveFromApp('@prisma/client', APP_ROOT)
  let prisma = null
  if (prismaRes.ok && rt.databaseUrl) {
    try { const { PrismaClient } = require(prismaRes.path); prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } }) }
    catch (e) { A('4 db: client ' + scrub(e)) }
  } else A('4 db: prisma indisponible (' + (prismaRes.ok ? 'pas de DATABASE_URL' : prismaRes.error) + ') — faits DB NON MESURÉS')

  let order = null, claimsOnOrder = [], refundRows = []
  if (!ORDER_ID) A('4 input: PHASE2_MODEB_ORDER_ID absent — aucune commande cible')
  if (!Number.isInteger(AMOUNT_CENTS) || AMOUNT_CENTS <= 0) A('4 input: PHASE2_MODEB_AMOUNT_CENTS invalide (' + AMOUNT_CENTS + ')')
  if (prisma && ORDER_ID) {
    try {
      order = await prisma.order.findUnique({
        where: { id: ORDER_ID },
        select: { id: true, restaurantId: true, consumerId: true, paymentStatus: true, stripePaymentIntentId: true, total: true, updatedAt: true, status: true },
      })
      claimsOnOrder = await prisma.claim.findMany({ where: { orderId: ORDER_ID }, select: { id: true, status: true, refundId: true, refundError: true, refundAttempted: true, requestedAmountCents: true } })
      refundRows = await prisma.refund.findMany({ where: { orderId: ORDER_ID }, select: { id: true, status: true, stripeRefundId: true, amountCents: true, idempotencyKey: true, createdAt: true } })
    } catch (e) { A('4 db: lecture commande ' + scrub(e)) }
    if (!order) A('4 order: commande ' + mask(ORDER_ID) + ' introuvable')
    else {
      F('ORDER', mask(order.id) + ' · paymentStatus ' + order.paymentStatus + ' · status ' + order.status + ' · total ' + order.total + ' € · PI ' + mask(order.stripePaymentIntentId))
      if (order.paymentStatus !== 'paid') A('4 order: paymentStatus « ' + order.paymentStatus + ' » — le rail réclamation exige « paid »')
      if (!order.stripePaymentIntentId) A('4 order: aucune PaymentIntent sur la commande')
      // PARITÉ avec l'application (lib/claims.ts envHours) : parseInt base 10, défaut 48 si non fini/≤ 0.
      // Un Number('48h') = NaN rendait la comparaison toujours fausse : la fenêtre n'était jamais signalée.
      const whRaw = Number.parseInt(process.env.CLAIM_WINDOW_HOURS ?? '', 10)
      const windowHours = Number.isFinite(whRaw) && whRaw > 0 ? whRaw : 48
      const ageH = (Date.now() - new Date(order.updatedAt).getTime()) / 3600000
      F('CLAIM WINDOW', 'âge ' + ageH.toFixed(1) + ' h / fenêtre ' + windowHours + ' h (ancrée sur Order.updatedAt)')
      if (!Number.isFinite(ageH)) A('4 order: Order.updatedAt illisible — fenêtre de réclamation NON PROUVÉE')
      else if (ageH > windowHours) A('4 order: hors fenêtre de réclamation (' + ageH.toFixed(1) + ' h > ' + windowHours + ' h) — ne PAS remonter CLAIM_WINDOW_HOURS, c’est global')
      // Le dépôt côté client a lieu plusieurs minutes APRÈS ce contrôle : sans marge, la réclamation
      // serait refusée (409 window_expired) dans une fenêtre déjà ouverte.
      else if (ageH > windowHours - CLAIM_WINDOW_MARGIN_H) A('4 order: fenêtre de réclamation trop proche de l’expiration (' + ageH.toFixed(1) + ' h, marge exigée ' + CLAIM_WINDOW_MARGIN_H + ' h) — le dépôt client risquerait un refus en pleine fenêtre')
      F('CLAIMS ON ORDER', claimsOnOrder.length ? claimsOnOrder.map((c) => mask(c.id) + ':' + c.status).join(' ') : 'aucune')
      const ACTIVE = ['restaurant_review', 'approved', 'refunding', 'arbitration', 'financial_verification']
      if (claimsOnOrder.some((c) => ACTIVE.includes(c.status))) A('4 claim: une réclamation ACTIVE existe déjà sur cette commande (activeOrderKey tenu)')
      if (claimsOnOrder.some((c) => c.refundId || c.refundAttempted)) A('4 claim: une réclamation de cette commande porte déjà une identité de remboursement (doublon)')
      F('REFUND ROWS (DB)', refundRows.length ? refundRows.map((r) => mask(r.id) + ':' + r.status + ':' + r.amountCents).join(' ') : 'aucune')
      const nonTerminal = refundRows.filter((r) => r.status === 'pending')
      if (nonTerminal.length) A('4 refund: ' + nonTerminal.length + ' ligne(s) « pending » préexistante(s) — RESUME-FIRST reprendrait celle-là, pas la répétition')
      if (refundRows.some((r) => r.status === 'failed' && r.stripeRefundId)) A('4 refund: une ligne ÉCHOUÉE avec identifiant Stripe verrouille le rail de cette commande (E2)')
      if (refundRows.some((r) => r.status === 'succeeded')) A('4 refund: cette commande a déjà été remboursée — ce n’est plus une première répétition')
    }
  }

  // [5] résidus globaux (les mêmes populations que le recensement)
  if (prisma) {
    try {
      const [active, refunding, fv, approvedUnpaid] = await Promise.all([
        prisma.claim.count({ where: { status: { in: ['restaurant_review', 'approved', 'refunding', 'arbitration', 'financial_verification'] } } }),
        prisma.claim.count({ where: { status: 'refunding' } }),
        prisma.claim.count({ where: { status: 'financial_verification' } }),
        prisma.claim.count({ where: { status: 'approved', refundAttempted: false } }),
      ])
      F('RESIDUE (global)', 'active ' + active + ' · refunding ' + refunding + ' · financial_verification ' + fv + ' · approvedUnpaid ' + approvedUnpaid)
      if (active > 0) A('5 residue: ' + active + ' réclamation(s) ACTIVE(s) — aucune répétition ne démarre sur un état en cours')
      if (refunding > 0) A('5 residue: ' + refunding + ' réclamation(s) en « refunding »')
      if (fv > 0) A('5 residue: ' + fv + ' réclamation(s) en vérification financière')
      if (approvedUnpaid > 0) A('5 residue: ' + approvedUnpaid + ' réclamation(s) approuvées non payées')
    } catch (e) { A('5 residue: ' + scrub(e)) }
  }

  // [6] Stripe : charge, litige, cash remboursable, financement du compte connecté
  let stripe = null
  try { stripe = H.makeStripeClient(process.env.STRIPE_SECRET_KEY, APP_ROOT, { apiBase: process.env.PHASE2_STRIPE_API_BASE }).client }
  catch (e) { A('6 stripe: client — ' + scrub(e)) }
  // Toutes les lectures Stripe passent par l'ADAPTATEUR (SDK complet en local, REST lecture seule
  // sur le runtime standalone déployé). Un fait non mesurable est une anomalie, jamais un défaut.
  let stripeFacts = null
  let adapter = null
  if (stripe && order && order.stripePaymentIntentId) {
    stripeFacts = await measureStripeFacts(stripe, { piId: order.stripePaymentIntentId, amountCents: AMOUNT_CENTS, F, A })
    adapter = stripeFacts.adapter || null
  } else if (stripe) A('6 stripe: pas de PaymentIntent lisible sur la commande — faits Stripe NON MESURÉS')

  // [7] baux : la fenêtre demandée doit tenir sous le PLUS COURT des deux plafonds
  F('LEASE CEILINGS', 'claims ' + (CLAIMS_LEASE_MAX_MS / 60000) + ' min · refunds ' + (REFUND_LEASE_MAX_MS / 60000) + ' min ⇒ commun ' + (Math.min(CLAIMS_LEASE_MAX_MS, REFUND_LEASE_MAX_MS) / 60000) + ' min')
  if (WINDOW_MS + LEASE_SLACK_MS > Math.min(CLAIMS_LEASE_MAX_MS, REFUND_LEASE_MAX_MS)) {
    A('7 window: PHASE2_MODEB_WINDOW_MS=' + Math.round(WINDOW_MS / 60000) + ' min dépasse ce que le bail le plus court peut couvrir (bail = fenêtre + 2 min, plafond ' + (REFUND_LEASE_MAX_MS / 60000) + ' min)')
  }

  if (MODE === 'precheck') {
    if (prisma) { try { await prisma.$disconnect() } catch { /* best-effort */ } }
    releaseLock()
    return done(anomalies.length ? 'BLOCKED — voir anomalies' : 'READY FOR FOUNDER AUTHORIZATION (aucune gate ouverte par ce script)')
  }

  // ── MODE WINDOW ─────────────────────────────────────────────────────────────────────────────
  if (process.env.PHASE2_MODEB_CONFIRM !== CONFIRM_SENTENCE) return fail('8 window: phrase d’autorisation absente ou incorrecte — rien changé')
  if (anomalies.length) return fail('8 window: anomalies au precheck — FENÊTRE REFUSÉE, rien changé')
  if (!order || !ORDER_ID || !(AMOUNT_CENTS > 0)) return fail('8 window: cible incomplète — rien changé')
  if (c0 !== 'CLOSED' || r0 !== 'CLOSED') return fail('8 window: les deux gates ne sont pas CLOSED avant ouverture — rien changé')

  const stamp = new Date().toISOString()
  let executed = false
  // Référence AVANT : le nombre d'objets STRIPE (pas de lignes DB — voir la boucle d'observation).
  let stripeRefundsBefore = 0
  if (adapter && order && order.stripePaymentIntentId) {
    try {
      // Énumération NORMALISÉE : une liste illisible ou ambiguë refuse la fenêtre, jamais « 0 ».
      stripeRefundsBefore = (await adapter.listRefunds(order.stripePaymentIntentId)).length
    } catch (e) { return fail('8 window: état Stripe AVANT illisible/ambigu (' + scrub(e) + ') — rien changé') }
  } else return fail('8 window: pas de client Stripe utilisable ou pas de PaymentIntent — rien changé')
  F('STRIPE REFUNDS BEFORE', String(stripeRefundsBefore))
  // Le precheck a prouvé ZÉRO objet Stripe quelques secondes plus tôt : un objet apparu entre-temps
  // (Dashboard) ferait de la fenêtre une seconde répétition — refus, rien changé.
  if (stripeRefundsBefore !== 0) return fail('8 window: ' + stripeRefundsBefore + ' remboursement(s) Stripe apparu(s) depuis le precheck — rien changé')
  const leaseUntil = new Date(Date.now() + Math.min(WINDOW_MS + LEASE_SLACK_MS, REFUND_LEASE_MAX_MS)).toISOString()
  try {
    armedClose = { envFile, stamp }   // ARMER AVANT la première écriture
    // Les baux d'abord : si l'ouverture des drapeaux échoue, l'autorisation meurt quand même d'elle-même.
    writeFlag(envFile, 'CLAIMS_WINDOW_UNTIL', leaseUntil, stamp)
    writeFlag(envFile, 'REFUNDS_WINDOW_UNTIL', leaseUntil, stamp)
    const oc = writeFlag(envFile, 'CLAIMS_ENABLED', 'true', stamp)
    const or = writeFlag(envFile, 'REFUNDS_ENABLED', 'true', stamp)
    F('LEASES', 'CLAIMS_WINDOW_UNTIL = REFUNDS_WINDOW_UNTIL = ' + leaseUntil + ' — passé cet instant l’application referme seule, même si ce processus est tué')
    F('OPEN WRITE', 'CLAIMS_ENABLED ' + (oc.changed ? 'true' : 'inchangé') + ' · REFUNDS_ENABLED ' + (or.changed ? 'true' : 'inchangé'))
    F('EMERGENCY CLOSE', 'ARMÉ (SIGINT/SIGTERM/SIGHUP/SIGQUIT/SIGBREAK + exception ⇒ les quatre clés fermées avant sortie ; SIGKILL ne peut pas être intercepté)')
    touchRestart()
    const w1 = await waitBoth(base, 'OPEN', RELOAD_DEADLINE_MS, RELOAD_INTERVAL_MS)
    F('GATES APRÈS OUVERTURE', 'claims ' + w1.claims + ' · refunds ' + w1.refunds + ' après ' + Math.round(w1.elapsedMs / 1000) + ' s')
    if (!w1.ok) throw new Error('les deux gates ne sont pas ouvertes (claims ' + w1.claims + ', refunds ' + w1.refunds + ')')

    // La DEADLINE est ré-ancrée sur le BAIL : l'ouverture a pu consommer plusieurs minutes de
    // rechargement. La boucle ne peut donc jamais survivre à l'autorisation qu'elle observe.
    const leaseEndMs = new Date(leaseUntil).getTime()
    const deadline = Math.min(Date.now() + WINDOW_MS, leaseEndMs - LEASE_SLACK_MS)
    F('FENÊTRE', 'OUVERTE à ' + new Date().toISOString() + ' — LA répétition est déclenchée par l’humain (console admin) ; ce script OBSERVE seulement. Observation jusqu’à ' + new Date(deadline).toISOString() + ' (bail ' + leaseUntil + ')')

    // ⚠️ ON N'OBSERVE PAS LA LIGNE DB. Le moteur écrit sa ligne 'pending' AVANT d'appeler Stripe :
    // s'arrêter là refermerait les gates et REDÉMARRERAIT Passenger pendant que l'appel Stripe est
    // en vol — exactement l'état absorbant que tout ce chantier existe pour éviter. On observe donc
    // l'OBJET STRIPE (il n'existe que si Stripe a accepté), comme le fait l'opérateur de remboursement.
    let seenRefunds = null
    let blips = 0
    let stripeBlips = 0
    while (Date.now() < deadline) {
      const cc = await probeClaims(base), rr = await probeRefunds(base)
      if (cc !== 'OPEN' || rr !== 'OPEN') {
        // Une sonde isolée peut être un 429 (limite de débit AVANT la gate) ou une coupure réseau :
        // ni l'un ni l'autre ne prouve une gate fermée. Il faut DEUX lectures consécutives.
        blips++
        if (blips >= 2) { A('9 window: incohérence confirmée (claims ' + cc + ', refunds ' + rr + ') — fermeture immédiate'); break }
      } else blips = 0
      if (adapter && order && order.stripePaymentIntentId) {
        try {
          const refunds = await adapter.listRefunds(order.stripePaymentIntentId)
          stripeBlips = 0
          if (refunds.length > stripeRefundsBefore) { seenRefunds = refunds; break }
        } catch (e) {
          // Aveugle sur Stripe, on ne garde PAS les gates ouvertes : deux lectures illisibles
          // consécutives ferment (le bloc « settle » ci-dessous protège encore une tentative en vol).
          stripeBlips++
          A('9 window: énumération Stripe illisible/ambiguë (' + stripeBlips + '/2) — ' + scrub(e))
          if (stripeBlips >= 2) { A('9 window: Stripe illisible deux fois de suite — fermeture immédiate'); break }
        }
      }
      await sleep(POLL_MS)
    }
    // Une approbation cliquée dans le DERNIER intervalle de sondage crée son objet Stripe APRÈS la
    // dernière lecture de la boucle : on relit une fois avant de conclure, pour ne jamais lui refuser
    // la grâce (son e-mail de succès est encore en vol).
    let lateSeen = false
    if (!seenRefunds && adapter && order && order.stripePaymentIntentId) {
      try {
        const late = await adapter.listRefunds(order.stripePaymentIntentId)
        if (late.length > stripeRefundsBefore) { seenRefunds = late; lateSeen = true }
      } catch (e) { A('9 window: lecture Stripe après la boucle illisible/ambiguë — ' + scrub(e)) }
    }
    // GRÂCE avant toute fermeture (voir GRACE_MS) — une seule fois, jamais au-delà du bail.
    let graced = false
    const grace = async (why) => {
      if (graced) return
      graced = true
      const graceMs = Math.max(0, Math.min(Number.isFinite(GRACE_MS) ? GRACE_MS : 20000, leaseEndMs - 30_000 - Date.now()))
      F('GRACE BEFORE CLOSE', Math.round(graceMs / 1000) + ' s — ' + why)
      await sleep(graceMs)
    }
    if (seenRefunds) {
      F('REFUND OBSERVED (Stripe)', seenRefunds.map((r) => mask(r.id) + ':' + (r.status || '?') + ':' + r.amount).join(' ') + (lateSeen ? ' (vu APRÈS la dernière lecture de la boucle)' : ''))
      if (seenRefunds.some((r) => r.status !== 'succeeded')) {
        F('REFUND STATUS TRUTH', 'au moins un remboursement n’est PAS « succeeded » — ne PAS conclure à un succès : refund.updated / refund.failed font foi')
      }
      await grace('la requête d’approbation finit ses écritures et son e-mail avant toute fermeture')
    } else F('REFUND OBSERVED (Stripe)', 'AUCUN nouvel objet Stripe pendant la fenêtre (le verdict final relit Stripe APRÈS fermeture)')

    // AVANT de refermer et de redémarrer : ne JAMAIS couper une tentative en vol. On attend, dans
    // la limite du bail, qu'aucune ligne de la commande ne soit encore « pending » et que la
    // réclamation ne soit plus « refunding ».
    if (prisma) {
      const settleUntil = Math.min(Date.now() + 90_000, leaseEndMs - 15_000)
      let unresolved = null
      let settleReadFailed = false
      let sawAttempt = false
      while (Date.now() < settleUntil) {
        try {
          const rows = await prisma.refund.findMany({ where: { orderId: ORDER_ID, status: 'pending' }, select: { id: true, stripeRefundId: true } })
          const claimsNow = await prisma.claim.findMany({ where: { orderId: ORDER_ID, status: 'refunding' }, select: { id: true } })
          unresolved = { rows, claims: claimsNow }
          if (!rows.length && !claimsNow.length) break
          sawAttempt = true
        } catch (e) { A('9 settle: lecture — ' + scrub(e)); settleReadFailed = true; break }
        await sleep(5000)
      }
      if (unresolved && (unresolved.rows.length || unresolved.claims.length)) {
        A('9 settle: une tentative est encore NON RÉSOLUE à la fermeture (lignes pending ' + unresolved.rows.length + ', réclamations refunding ' + unresolved.claims.length + ') — la fermeture et le redémarrage ont lieu quand même car le bail expire ; réconciliation humaine requise')
      } else if (!unresolved) {
        // Rien n'a été lu (bail trop proche, ou lecture en erreur) : on ne prétend PAS que tout est réglé.
        if (!settleReadFailed) A('9 settle: NON MESURÉ — le bail ne laissait plus le temps de lire l’état avant fermeture')
      } else {
        F('SETTLE BEFORE CLOSE', 'aucune ligne « pending », aucune réclamation « refunding » — fermeture sans couper de tentative')
        // Une tentative vue EN COURS pendant le règlement vient de se résoudre : sa requête d'approbation
        // envoie maintenant l'e-mail — même grâce, si elle n'a pas déjà été accordée.
        if (sawAttempt) await grace('une tentative vient de se résoudre pendant le règlement — son e-mail part avant la fermeture')
      }
    }
  } catch (e) {
    A('9 window: ' + scrub(e))
  } finally {
    // FERMETURE INCONDITIONNELLE — baux expirés D'ABORD (l'autorisation meurt même si un drapeau résiste)
    try {
      const past = new Date(Date.now() - 1000).toISOString()
      writeFlag(envFile, 'REFUNDS_WINDOW_UNTIL', past, stamp + 'Z')
      writeFlag(envFile, 'CLAIMS_WINDOW_UNTIL', past, stamp + 'Z')
      const cr = writeFlag(envFile, 'REFUNDS_ENABLED', 'false', stamp + 'Z')
      const cc = writeFlag(envFile, 'CLAIMS_ENABLED', 'false', stamp + 'Z')
      armedClose = null    // désarmé SEULEMENT une fois les valeurs fermées sur le disque
      F('CLOSE WRITE', 'REFUNDS_ENABLED ' + (cr.changed ? 'false' : 'inchangé') + ' · CLAIMS_ENABLED ' + (cc.changed ? 'false' : 'inchangé'))
      touchRestart()
      const w2 = await waitBoth(base, 'CLOSED', RELOAD_DEADLINE_MS, RELOAD_INTERVAL_MS)
      F('GATES APRÈS FERMETURE', 'claims ' + w2.claims + ' · refunds ' + w2.refunds + ' après ' + Math.round(w2.elapsedMs / 1000) + ' s')
      if (!w2.ok) A('10 refreeze: les deux gates NE SONT PAS prouvées fermées — ATTENTION HUMAINE REQUISE')
    } catch (e) {
      A('10 refreeze: ' + scrub(e))
      // Les quatre écritures partageaient UN try : si l'une a levé, les suivantes n'ont pas eu lieu.
      // La fermeture d'urgence (encore armée) réessaie clé par clé, baux d'abord, et redémarre.
      const stillArmed = armedClose !== null
      emergencyClose()
      if (stillArmed) {
        try {
          const w3 = await waitBoth(base, 'CLOSED', RELOAD_DEADLINE_MS, RELOAD_INTERVAL_MS)
          F('GATES APRÈS FERMETURE D’URGENCE', 'claims ' + w3.claims + ' · refunds ' + w3.refunds + ' après ' + Math.round(w3.elapsedMs / 1000) + ' s')
          if (!w3.ok) A('10 refreeze: les deux gates NE SONT PAS prouvées fermées après la fermeture d’urgence — ATTENTION HUMAINE REQUISE')
        } catch (e2) { A('10 refreeze: sondes après fermeture d’urgence — ' + scrub(e2)) }
      }
    }
    // VERDICT — vérité Stripe relue APRÈS la fermeture. « Ouvert puis refermé proprement » n'est PAS
    // une répétition réussie : il faut EXACTEMENT UN objet remboursement, du montant autorisé, et
    // « succeeded ». Une énumération finale illisible laisse l'issue NON PROUVÉE (anomalie, jamais PASS).
    let finalRefunds = null
    try {
      finalRefunds = await adapter.listRefunds(order.stripePaymentIntentId)
      F('STRIPE REFUNDS AFTER', finalRefunds.length ? finalRefunds.map((r) => mask(r.id) + ':' + r.status + ':' + r.amount).join(' ') : '0')
      for (const m of refundVerdict(finalRefunds, AMOUNT_CENTS)) A(m)
      executed = finalRefunds.length > 0
    } catch (e) { A('11 verdict: énumération Stripe finale illisible/ambiguë (' + scrub(e) + ') — issue NON PROUVÉE') }
    // état APRÈS (preuve) — et JUGÉ : Stripe seul ne prouve pas que c'est la RÉCLAMATION qui a payé.
    if (prisma) {
      try {
        const after = await prisma.refund.findMany({ where: { orderId: ORDER_ID }, select: { id: true, status: true, stripeRefundId: true, amountCents: true, reason: true } })
        const claimsAfter = await prisma.claim.findMany({ where: { orderId: ORDER_ID }, select: { id: true, status: true, refundId: true, refundError: true } })
        F('AFTER · REFUND ROWS', after.length ? after.map((r) => mask(r.id) + ':' + r.status + ':' + r.amountCents).join(' ') : 'aucune')
        F('AFTER · CLAIMS', claimsAfter.length ? claimsAfter.map((c) => mask(c.id) + ':' + c.status + (c.refundError ? ':err' : '')).join(' ') : 'aucune')
        for (const m of dbVerdict({ executed, finalRefunds, amountCents: AMOUNT_CENTS, rowsBefore: refundRows, claimsBefore: claimsOnOrder, rowsAfter: after, claimsAfter })) A(m)
      } catch (e) { A('10 after: ' + scrub(e) + ' — état DB NON PROUVÉ') }
      try { await prisma.$disconnect() } catch { /* best-effort */ }
    }
    releaseLock()
  }
  // PASS = la répétition a EU LIEU et Stripe la prouve conforme. Une fenêtre refermée sans aucun objet
  // Stripe n'est ni un succès ni une anomalie de sûreté : « NOT EXECUTED » (code de sortie ≠ 0).
  return done(anomalies.length ? 'FAIL' : executed ? 'PASS' : 'NOT EXECUTED — fenêtre ouverte puis refermée proprement, AUCUN remboursement observé chez Stripe')
}

if (require.main === module) main().catch((e) => { emergencyClose(); fail('unexpected: ' + scrub(e)) })

module.exports = {
  writeFlag, emergencyClose, takeLock, releaseLock,
  // Seams de test — la parité avec le runtime déployé (client REST forcé) se prouve ici.
  stripeAdapter, normalizeRefundList, readAvailableEur, readPayoutSchedule, measureStripeFacts, REFUND_LIST_CAP, refundVerdict, dbVerdict, CLAIM_WINDOW_MARGIN_H,
  armClose: (envFile, stamp) => { armedClose = { envFile, stamp } },
  isCloseArmed: () => armedClose !== null,
  CONFIRM_SENTENCE, REFUND_LEASE_MAX_MS, CLAIMS_LEASE_MAX_MS, LEASE_SLACK_MS, LOCK_FILE,
  _residueLinesForTests: () => ({ facts: facts.slice(), anomalies: anomalies.slice() }),
}
