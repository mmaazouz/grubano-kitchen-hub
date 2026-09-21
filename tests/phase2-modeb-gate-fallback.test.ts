// tests/phase2-modeb-gate-fallback.test.ts — MODE B : l'opérateur sur le RUNTIME DÉPLOYÉ (sans SDK Stripe).
//
// LE DÉFAUT QUI A ÉCHAPPÉ (précheck final 2026-09-21). Le `node_modules` standalone de staging ne
// contient PAS le SDK `stripe` (Next le bundle dans ses chunks serveur). `H.makeStripeClient` y
// renvoie donc le client REST lecture seule — sans `balance`, sans `accounts`, sans `.data` sur
// les listes. La première version de l'opérateur supposait le SDK : elle refusait TOUTE fenêtre
// (« financement NON VÉRIFIABLE ») et aurait compté 0 remboursement pour toujours. Les tests locaux
// passaient parce que le SDK complet se résout depuis le node_modules racine du dépôt.
//
// CE FICHIER FORCE le client REST (racine d'application SANS node_modules, comme sur le serveur) et
// prouve, sans réseau et sans ouvrir la moindre gate, que l'opérateur y lit solde, compte, planning
// et remboursements — et qu'il échoue FERMÉ sur tout ce qu'il ne peut pas prouver.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const H = require('../scripts/server/reconcile-helpers.js') as {
  makeStripeClient: (key: string, appRoot: string, opts?: Record<string, unknown>) => { client: RestClient; resolution: string }
  createStripeReadOnlyClient: (key: string, opts?: Record<string, unknown>) => RestClient
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const OP = require('../scripts/server/phase2-modeb-gate.js') as {
  stripeAdapter: (client: unknown) => { kind: string; listRefunds: (piId: string) => Promise<unknown[]>; balanceFor: (id: string) => Promise<unknown>; retrieveAccount: (id: string) => Promise<unknown> }
  normalizeRefundList: (raw: unknown) => unknown[]
  readAvailableEur: (bal: unknown) => { available: number; pending: number; eurListed: boolean }
  readPayoutSchedule: (acct: unknown) => string
  measureStripeFacts: (client: unknown, input: { piId: string; amountCents: number; F: (k: string, v: string) => void; A: (m: string) => void }) => Promise<Record<string, unknown>>
  REFUND_LIST_CAP: number
}
type RestClient = { kind?: string; [k: string]: unknown }

const SRC = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'server', 'phase2-modeb-gate.js'), 'utf8')

// ── Formes MESURÉES sur staging le 2026-09-21 (GR-9IA5R6), valeurs réelles, identifiants masqués ──
const PI_ID = 'pi_test_9ia5r6'
const DEST = 'acct_test_pilot'
const charge = (over: Record<string, unknown> = {}) => ({
  id: 'ch_test_1', object: 'charge', paid: true, captured: true, amount: 1450, amount_captured: 1450, amount_refunded: 0,
  refunded: false, disputed: false, application_fee_amount: 116, transfer: 'tr_test_1', ...over,
})
const paymentIntent = (chOver: Record<string, unknown> = {}, piOver: Record<string, unknown> = {}) => ({
  id: PI_ID, object: 'payment_intent', livemode: false, status: 'succeeded', amount: 1450, amount_received: 1450,
  currency: 'eur', application_fee_amount: 116, transfer_data: { destination: DEST }, latest_charge: charge(chOver), ...piOver,
})
const balance = () => ({ object: 'balance', available: [{ amount: 861, currency: 'eur' }], pending: [{ amount: 1334, currency: 'eur' }] })
const account = () => ({ id: DEST, object: 'account', charges_enabled: true, payouts_enabled: true, settings: { payouts: { schedule: { interval: 'manual' } } } })
const refundPage = (data: unknown[] = [], has_more = false) => ({ object: 'list', data, has_more })

type Route = { status?: number; body: unknown } | ((url: URL, init: RequestInit) => { status?: number; body: unknown })
/** Un faux fetch qui sert les QUATRE points d'entrée REST que le client lecture seule utilise. */
function fakeFetch(routes: Partial<Record<'pi' | 'refunds' | 'balance' | 'account', Route>> = {}) {
  const calls: Array<{ path: string; headers: Record<string, string> }> = []
  const f = async (input: string, init: RequestInit) => {
    const url = new URL(input)
    const headers = Object.assign({}, (init && (init.headers as Record<string, string>)) || {})
    calls.push({ path: url.pathname + url.search, headers })
    const pick = (): Route | undefined => {
      if (url.pathname === '/v1/payment_intents/' + PI_ID) return routes.pi ?? { body: paymentIntent() }
      if (url.pathname === '/v1/refunds') return routes.refunds ?? { body: refundPage() }
      if (url.pathname === '/v1/balance') return routes.balance ?? { body: balance() }
      if (url.pathname === '/v1/accounts/' + DEST) return routes.account ?? { body: account() }
      return { status: 404, body: { error: { type: 'invalid_request_error' } } }
    }
    const r = pick()!
    const res = typeof r === 'function' ? r(url, init) : r
    return { status: res.status ?? 200, json: async () => res.body }
  }
  return Object.assign(f, { calls })
}

const collect = () => {
  const facts: string[] = [], anomalies: string[] = []
  return { facts, anomalies, F: (k: string, v: string) => { facts.push(k + ': ' + v) }, A: (m: string) => { anomalies.push(m) } }
}

let emptyRoot: string
beforeEach(() => { emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modeb-standalone-')) })
afterEach(() => { try { fs.rmSync(emptyRoot, { recursive: true, force: true }) } catch { /* best-effort */ } })

// ══ PARITÉ AVEC LE RUNTIME DÉPLOYÉ ═══════════════════════════════════════════════════════════
describe('MODE B — parité runtime déployé : SDK `stripe` ABSENT ⇒ client REST ⇒ precheck READY', () => {
  it('⭐ une racine sans node_modules résout le client REST (exactement comme le standalone de staging)', () => {
    const { client, resolution } = H.makeStripeClient('sk_test_x', emptyRoot, { fetch: fakeFetch() })
    expect(client.kind).toBe('rest-readonly')
    expect(resolution).toMatch(/READ-ONLY REST client/)
    expect(typeof (client as Record<string, unknown>).balance).toBe('undefined')   // ce qui cassait l'ancien opérateur
    expect(typeof (client as Record<string, unknown>).accounts).toBe('undefined')
  })

  it('⭐ sur ce client REST, l’opérateur mesure solde, planning, PI, charge et remboursements — 0 anomalie', async () => {
    const fetch = fakeFetch()
    const { client } = H.makeStripeClient('sk_test_x', emptyRoot, { fetch })
    expect(client.kind).toBe('rest-readonly')   // un `stripe` égaré dans un node_modules ancêtre rendrait ce test SDK + réseau : on échoue AVANT
    const c = collect()
    const out = await OP.measureStripeFacts(client, { piId: PI_ID, amountCents: 500, F: c.F, A: c.A })
    expect(c.anomalies).toEqual([])
    expect(c.facts.join('\n')).toMatch(/STRIPE CLIENT: REST lecture seule/)
    expect(c.facts.join('\n')).toMatch(/CONNECTED AVAILABLE \(EUR c\): 861 · pending 1334/)
    expect(c.facts.join('\n')).toMatch(/CONNECTED PAYOUT SCHEDULE: manual/)
    expect(c.facts.join('\n')).toMatch(/REMAINING REFUNDABLE \(Stripe\): 1450/)
    expect(c.facts.join('\n')).toMatch(/STRIPE REFUNDS \(existing\): 0 · pending 0/)
    expect(out).toMatchObject({ dest: DEST, remaining: 1450, available: 861, schedule: 'manual' })
    // les vrais chemins REST ont été empruntés, avec l'en-tête Stripe-Account pour le solde
    expect(fetch.calls.some((x) => x.path.startsWith('/v1/balance') && x.headers['Stripe-Account'] === DEST)).toBe(true)
    expect(fetch.calls.some((x) => x.path.startsWith('/v1/accounts/' + DEST))).toBe(true)
    expect(fetch.calls.some((x) => x.path.startsWith('/v1/refunds?') && x.path.includes('payment_intent=' + PI_ID))).toBe(true)
    // et l'expansion de la charge a été DEMANDÉE (sinon latest_charge revient en chaîne)
    expect(fetch.calls.some((x) => x.path.startsWith('/v1/payment_intents/') && /expand/.test(x.path) && /latest_charge/.test(x.path))).toBe(true)
  })

  it('le SDK complet et le client REST produisent les MÊMES faits (normalisation unique)', async () => {
    const restC = collect()
    const rest = H.makeStripeClient('sk_test_x', emptyRoot, { fetch: fakeFetch() }).client
    expect(rest.kind).toBe('rest-readonly')
    await OP.measureStripeFacts(rest, { piId: PI_ID, amountCents: 500, F: restC.F, A: restC.A })
    // un SDK factice : la liste renvoie une promesse portant autoPagingToArray, comme stripe-node
    const listPromise = Object.assign(Promise.resolve(refundPage()), { autoPagingToArray: async () => [] })
    const sdk = {
      paymentIntents: { retrieve: async () => paymentIntent() },
      refunds: { list: () => listPromise },
      balance: { retrieve: async (_p: unknown, opts: { stripeAccount: string }) => { expect(opts.stripeAccount).toBe(DEST); return balance() } },
      accounts: { retrieve: async (id: string) => { expect(id).toBe(DEST); return account() } },
    }
    const sdkC = collect()
    await OP.measureStripeFacts(sdk, { piId: PI_ID, amountCents: 500, F: sdkC.F, A: sdkC.A })
    expect(sdkC.anomalies).toEqual([])
    const strip = (s: string[]) => s.filter((l) => !l.startsWith('STRIPE CLIENT:'))
    expect(strip(sdkC.facts)).toEqual(strip(restC.facts))
  })
})

// ══ ÉCHEC FERMÉ SUR LE CLIENT REST FORCÉ ═════════════════════════════════════════════════════
describe('MODE B — client REST forcé : chaque fait non prouvable est une ANOMALIE, jamais un zéro', () => {
  const run = async (routes: Parameters<typeof fakeFetch>[0]) => {
    const c = collect()
    const client = H.createStripeReadOnlyClient('sk_test_x', { fetch: fakeFetch(routes) })
    const out = await OP.measureStripeFacts(client, { piId: PI_ID, amountCents: 500, F: c.F, A: c.A })
    return { ...c, out }
  }

  it('solde en erreur HTTP → anomalie « solde connecté illisible », financement NON PROUVÉ', async () => {
    const r = await run({ balance: { status: 500, body: {} } })
    expect(r.anomalies.join('\n')).toMatch(/solde connecté illisible/)
    expect(r.out.available).toBeNull()
  })

  it('solde sans tableau available → anomalie (une forme inconnue n’est PAS un solde de 0)', async () => {
    const r = await run({ balance: { body: { object: 'balance' } } })
    expect(r.anomalies.join('\n')).toMatch(/solde connecté illisible/)
    expect(r.facts.join('\n')).not.toMatch(/CONNECTED AVAILABLE/)
  })

  it('solde insuffisant → anomalie T-42, même sur le client REST', async () => {
    const r = await run({ balance: { body: { object: 'balance', available: [{ amount: 400, currency: 'eur' }], pending: [] } } })
    expect(r.anomalies.join('\n')).toMatch(/solde connecté disponible 400 c < BRUT 500 c/)
  })

  it('compte en 404 → anomalie « planning de versement illisible »', async () => {
    const r = await run({ account: { status: 404, body: { error: { type: 'invalid_request_error' } } } })
    expect(r.anomalies.join('\n')).toMatch(/planning de versement illisible/)
    expect(r.out.schedule).toBeNull()
  })

  it('compte sans settings.payouts.schedule → anomalie (un « ? » n’est pas un fait)', async () => {
    const r = await run({ account: { body: { id: DEST, object: 'account' } } })
    expect(r.anomalies.join('\n')).toMatch(/planning de versement illisible/)
  })

  it('planning « daily » → anomalie (précondition : manual)', async () => {
    const r = await run({ account: { body: { id: DEST, settings: { payouts: { schedule: { interval: 'daily' } } } } } })
    expect(r.anomalies.join('\n')).toMatch(/planning de versement « daily »/)
  })

  it('énumération en erreur HTTP → anomalie « énumération … illisible », conflits NON PROUVÉS', async () => {
    const r = await run({ refunds: { status: 401, body: { error: { type: 'invalid_request_error' } } } })
    expect(r.anomalies.join('\n')).toMatch(/énumération des remboursements illisible\/ambiguë/)
    expect(r.facts.join('\n')).not.toMatch(/STRIPE REFUNDS \(existing\)/)
  })

  it('⭐ page sans `data` (forme malformée) → anomalie — JAMAIS « 0 remboursement »', async () => {
    const r = await run({ refunds: { body: { object: 'list' } } })
    expect(r.anomalies.join('\n')).toMatch(/énumération des remboursements illisible\/ambiguë/)
    expect(r.facts.join('\n')).not.toMatch(/STRIPE REFUNDS \(existing\): 0/)
  })

  it('⭐ pagination ambiguë (has_more sans éléments) → anomalie', async () => {
    const r = await run({ refunds: { body: refundPage([], true) } })
    expect(r.anomalies.join('\n')).toMatch(/énumération des remboursements illisible\/ambiguë/)
  })

  it('⭐ liste au PLAFOND (autant d’éléments que la limite) → ambiguë → anomalie', async () => {
    const many = Array.from({ length: OP.REFUND_LIST_CAP }, (_, i) => ({ id: 're_' + i, amount: 1, status: 'succeeded' }))
    const r = await run({ refunds: { body: refundPage(many, false) } })
    expect(r.anomalies.join('\n')).toMatch(/énumération des remboursements illisible\/ambiguë/)
  })

  it('un remboursement existe déjà → anomalie « ce n’est plus une première répétition »', async () => {
    const r = await run({ refunds: { body: refundPage([{ id: 're_1', amount: 500, status: 'succeeded' }]) } })
    expect(r.anomalies.join('\n')).toMatch(/1 remboursement\(s\) Stripe existe\(nt\) déjà/)
  })

  it('un remboursement EN ATTENTE existe → anomalie « cash déjà engagé »', async () => {
    const r = await run({ refunds: { body: refundPage([{ id: 're_1', amount: 500, status: 'pending' }]) } })
    expect(r.anomalies.join('\n')).toMatch(/en attente — cash déjà engagé/)
    const r2 = await run({ refunds: { body: refundPage([{ id: 're_1', amount: 500, status: 'requires_action' }]) } })
    expect(r2.anomalies.join('\n')).toMatch(/en attente — cash déjà engagé/)
  })

  it('⭐ PI SANS destination Connect → anomalie « financement NON VÉRIFIABLE », solde et planning JAMAIS affirmés', async () => {
    const r = await run({ pi: { body: paymentIntent({}, { transfer_data: null }) } })
    expect(r.anomalies.join('\n')).toMatch(/aucune destination Connect/)
    expect(r.out.available).toBeNull()
    expect(r.out.schedule).toBeNull()
    expect(r.facts.join('\n')).not.toMatch(/CONNECTED AVAILABLE|CONNECTED PAYOUT SCHEDULE/)
  })

  it('⭐ amount_refunded illisible (absent ou en chaîne) → anomalie, cash remboursable JAMAIS fabriqué', async () => {
    for (const amount_refunded of [undefined, '0']) {
      const r = await run({ pi: { body: paymentIntent({ amount_refunded }) } })
      expect(r.anomalies.join('\n')).toMatch(/amount_refunded illisible/)
      expect(r.out.remaining).toBeNull()
      expect(r.facts.join('\n')).not.toMatch(/REMAINING REFUNDABLE/)
    }
  })

  it('PaymentIntent non « succeeded » → anomalie « rien à rembourser »', async () => {
    const r = await run({ pi: { body: paymentIntent({}, { status: 'processing' }) } })
    expect(r.anomalies.join('\n')).toMatch(/« processing » — rien à rembourser/)
  })

  it('`disputed` absent → anomalie « litige NON PROUVÉ » (un litige inconnu n’est pas « non contesté »)', async () => {
    const r = await run({ pi: { body: paymentIntent({ disputed: undefined }) } })
    expect(r.anomalies.join('\n')).toMatch(/disputed illisible — litige NON PROUVÉ/)
  })

  it('PI dans une autre devise → anomalie (le solde comparé est la ligne EUR)', async () => {
    const r = await run({ pi: { body: paymentIntent({}, { currency: 'usd' }) } })
    expect(r.anomalies.join('\n')).toMatch(/devise « usd » — comparaison au solde EUR NON PROUVÉE/)
  })

  it('élément de liste malformé (amount non entier) → anomalie', async () => {
    const r = await run({ refunds: { body: refundPage([{ id: 're_1', amount: '500', status: 'succeeded' }]) } })
    expect(r.anomalies.join('\n')).toMatch(/énumération des remboursements illisible\/ambiguë/)
  })

  it('charge CONTESTÉE → anomalie', async () => {
    const r = await run({ pi: { body: paymentIntent({ disputed: true }) } })
    expect(r.anomalies.join('\n')).toMatch(/charge CONTESTÉE/)
  })

  it('charge NON capturée → anomalie', async () => {
    const r = await run({ pi: { body: paymentIntent({ captured: false, amount_captured: 0 }) } })
    expect(r.anomalies.join('\n')).toMatch(/charge NON capturée/)
  })

  it('cash remboursable < montant → anomalie', async () => {
    const r = await run({ pi: { body: paymentIntent({ amount_refunded: 1000 }) } })
    expect(r.anomalies.join('\n')).toMatch(/cash remboursable 450 c < montant de répétition 500 c/)
  })

  it('PaymentIntent LIVE → anomalie (Stripe TEST uniquement)', async () => {
    const r = await run({ pi: { body: paymentIntent({}, { livemode: true }) } })
    expect(r.anomalies.join('\n')).toMatch(/PaymentIntent LIVE/)
  })

  it('charge routée SANS commission → anomalie (commit A)', async () => {
    const r = await run({ pi: { body: paymentIntent({ application_fee_amount: 0 }) } })
    expect(r.anomalies.join('\n')).toMatch(/charge ROUTÉE sans commission/)
  })

  it('PI en erreur HTTP → anomalie « lecture PI/charge », et rien d’autre n’est affirmé', async () => {
    const r = await run({ pi: { status: 500, body: {} } })
    expect(r.anomalies.join('\n')).toMatch(/lecture PI\/charge/)
    expect(r.facts.join('\n')).not.toMatch(/CONNECTED AVAILABLE|STRIPE REFUNDS/)
  })

  it('latest_charge renvoyé en CHAÎNE (expansion perdue) → anomalie « aucune charge exploitable »', async () => {
    const r = await run({ pi: { body: paymentIntent({}, { latest_charge: 'ch_test_1' }) } })
    expect(r.anomalies.join('\n')).toMatch(/aucune charge exploitable/)
  })
})

// ══ LES NORMALISEURS, UNITAIREMENT ═══════════════════════════════════════════════════════════
describe('MODE B — normaliseurs : une forme non comprise échoue, elle ne vaut jamais zéro', () => {
  it('normalizeRefundList : formes inconnues → erreur, jamais []', () => {
    expect(() => OP.normalizeRefundList(undefined)).toThrow(/unreadable/)
    expect(() => OP.normalizeRefundList({ kind: 'weird', value: [] })).toThrow(/shape_unknown/)
    expect(() => OP.normalizeRefundList({ kind: 'page', value: { object: 'list' } })).toThrow(/shape_unknown/)
    expect(() => OP.normalizeRefundList({ kind: 'array', value: { data: [] } })).toThrow(/shape_unknown/)
  })
  it('normalizeRefundList : ambiguïté → erreur ; liste vide → [] ; page valide → éléments', () => {
    expect(() => OP.normalizeRefundList({ kind: 'page', value: { data: [], has_more: true } })).toThrow(/truncated/)
    expect(() => OP.normalizeRefundList({ kind: 'array', value: Array.from({ length: OP.REFUND_LIST_CAP }, (_, i) => ({ id: 'r' + i, amount: 1, status: 's' })) })).toThrow(/truncated/)
    expect(OP.normalizeRefundList({ kind: 'array', value: [] })).toEqual([])
    expect(OP.normalizeRefundList({ kind: 'page', value: { data: [{ id: 're_1', amount: 5, status: 'succeeded' }], has_more: false } })).toHaveLength(1)
    expect(() => OP.normalizeRefundList({ kind: 'page', value: { data: [{ id: 're_1' }], has_more: false } })).toThrow(/malformed/)
    // une page sans `has_more: false` EXPLICITE ne prouve pas sa complétude
    expect(() => OP.normalizeRefundList({ kind: 'page', value: { data: [] } })).toThrow(/shape_unknown/)
    expect(() => OP.normalizeRefundList({ kind: 'page', value: { data: [], has_more: 'false' } })).toThrow(/shape_unknown/)
  })
  it('readAvailableEur : forme inconnue → erreur ; EUR absent → 0 signalé comme « aucune ligne EUR »', () => {
    expect(() => OP.readAvailableEur({})).toThrow(/shape_unknown/)
    expect(() => OP.readAvailableEur({ available: [] })).toThrow(/shape_unknown/)
    expect(() => OP.readAvailableEur({ available: [{ amount: '1', currency: 'eur' }], pending: [] })).toThrow(/malformed/)
    expect(() => OP.readAvailableEur({ available: [{ amount: 861, currency: 'eur' }], pending: [{ amount: '1334', currency: 'eur' }] })).toThrow(/malformed/)
    expect(OP.readAvailableEur({ available: [], pending: [] })).toEqual({ available: 0, pending: 0, eurListed: false })
    expect(OP.readAvailableEur(balance())).toEqual({ available: 861, pending: 1334, eurListed: true })
  })
  it('readPayoutSchedule : forme inconnue → erreur ; manual → manual', () => {
    expect(() => OP.readPayoutSchedule({})).toThrow(/shape_unknown/)
    expect(() => OP.readPayoutSchedule({ settings: { payouts: { schedule: {} } } })).toThrow(/shape_unknown/)
    expect(OP.readPayoutSchedule(account())).toBe('manual')
  })
  it('⭐ stripeAdapter : un client dont la forme n’est pas comprise est REFUSÉ (jamais lu comme « 0 remboursement »)', async () => {
    expect(() => OP.stripeAdapter({ paymentIntents: {}, refunds: {} })).toThrow(/stripe_client_shape_unknown/)
    expect(() => OP.stripeAdapter(null)).toThrow(/stripe_client_missing/)
    const c = collect()
    await OP.measureStripeFacts({ paymentIntents: {}, refunds: {} }, { piId: PI_ID, amountCents: 500, F: c.F, A: c.A })
    expect(c.anomalies.join('\n')).toMatch(/client inutilisable/)
  })
})

// ══ PINS DE SOURCE : main() ne parle plus jamais au SDK directement ══════════════════════════
describe('MODE B — main() passe par l’adaptateur, jamais par le SDK seul', () => {
  it('aucun accès direct stripe.balance / stripe.accounts / list.data hors de l’adaptateur', () => {
    const mainSrc = SRC.slice(SRC.indexOf('async function main()'))
    expect(mainSrc).not.toMatch(/stripe\.balance\./)
    expect(mainSrc).not.toMatch(/stripe\.accounts\./)
    expect(mainSrc).not.toMatch(/\.data\)\s*\|\|\s*\[\]|l0 && l0\.data|list && list\.data/)
    expect(mainSrc).toMatch(/measureStripeFacts\(stripe, \{ piId: order\.stripePaymentIntentId/)
    expect((mainSrc.match(/adapter\.listRefunds\(order\.stripePaymentIntentId\)/g) || []).length).toBe(2)   // AVANT + boucle
  })
  it('la fenêtre refuse une référence AVANT ≠ 0 et ferme après deux énumérations Stripe illisibles', () => {
    const mainSrc = SRC.slice(SRC.indexOf('async function main()'))
    expect(mainSrc).toMatch(/if \(stripeRefundsBefore !== 0\) return fail\('8 window: /)
    expect(mainSrc).toMatch(/stripeBlips\+\+/)
    expect(mainSrc).toMatch(/if \(stripeBlips >= 2\) \{ A\('9 window: Stripe illisible deux fois de suite — fermeture immédiate'\); break \}/)
    expect(mainSrc).toMatch(/stripeBlips = 0/)   // remise à zéro sur une lecture réussie
  })
  it('l’ancien contrôle de capacité (typeof stripe.balance) a disparu — remplacé par l’adaptateur', () => {
    expect(SRC).not.toMatch(/typeof stripe\.balance === 'undefined'/)
    expect(SRC).toMatch(/rest \? rest\.balanceFor\(id\) : sdk\.balance\.retrieve/)
    expect(SRC).toMatch(/rest \? rest\.retrieveAny\('accounts', id\) : sdk\.accounts\.retrieve\(id\)/)
    expect(SRC).toMatch(/autoPagingToArray\(\{ limit: REFUND_LIST_CAP \}\)/)
  })
})
