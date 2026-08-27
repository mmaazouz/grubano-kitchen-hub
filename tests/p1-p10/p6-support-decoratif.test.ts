import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── P6 — SUPPORT « décoratif / simulation humain » (Sprint 0, characterization) ──────
//
// Audit verdict: no REAL support channel. The consumer help screen
// (app/[locale]/eat/order/[orderId]/help/page.tsx) renders a scripted "human agent"
// chat (static i18n bubbles, disabled composer, hardcoded « En ligne » badge) and
// inert contact buttons. There is NO app/api/support/** nor app/api/help/** backend.
//
// Reality check performed while writing this file (the tests encode the CODE, not the
// verdict blindly):
//  • app/api/tickets/** looks like a support-ticket system but is NOT one — it is the
//    dine-in table-ticket POS (tableTicket / restaurantTableId). Characterized below.
//  • ONE adjacent REAL channel exists: the refund view of the help page is wired to
//    /api/claims (P2-CLAIMS) — but it is gated by CLAIMS_ENABLED (default OFF), so in
//    production-default the whole help screen is inert. Characterized below.
//
// Statuses (encoded in each test title):
//  [PASS-ACTUEL]   current behaviour is the wanted behaviour.
//  [FAIL-ATTENDU]  test asserts the CURRENT (broken) behaviour so it is GREEN today;
//                  after the post-arbitrage fix the assertion must be INVERTED.
//  [NON-TESTABLE]  browser-only UI clicks → it.todo.

const ROOT = process.cwd()
const HELP_PAGE = join(ROOT, 'app', '[locale]', 'eat', 'order', '[orderId]', 'help', 'page.tsx')

// ── Mocks for the /api/claims import chain — LEAF deps only, so lib/claims stays REAL
//    and isClaimsEnabled() is the genuine env-driven gate (no DB, no Stripe touched).
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/refund', () => ({ executeRefund: vi.fn(), isRefundsEnabled: vi.fn(() => false) }))
vi.mock('@/lib/dish-photo', () => ({
  processDishImage: vi.fn(),
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
}))
const { tokenMock } = vi.hoisted(() => ({ tokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: tokenMock }))

import { GET as CLAIMS_GET } from '@/app/api/claims/route'
import { isClaimsEnabled } from '@/lib/claims'

const claimsReq = (url = 'https://app.grubano.com/api/claims') => ({ url }) as never

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.unstubAllEnvs() })

// ════════════════════════════════════════════════════════════════════════════════════
describe('P6 — SUPPORT : absence de backend (preuves fs)', () => {
  it("[FAIL-ATTENDU: aucun backend support] app/api/support/ n'existe pas — aucune route support", () => {
    // AUDIT: no support API at all. After the post-arbitrage fix (a real support
    // backend), this must be INVERTED to expect the route directory to EXIST.
    expect(existsSync(join(ROOT, 'app', 'api', 'support'))).toBe(false)
  })

  it("[FAIL-ATTENDU: aucun backend help] app/api/help/ n'existe pas — aucune route d'articles d'aide", () => {
    // AUDIT: the help-centre topics on the /eat help screen have no backing API.
    // After fix: invert to expect the directory to exist.
    expect(existsSync(join(ROOT, 'app', 'api', 'help'))).toBe(false)
  })

  it('[FAIL-ATTENDU: aucun canal de contact serveur] aucun répertoire support/help/contact/assistance/sav/faq sous app/api', () => {
    // AUDIT: exhaustive directory-level proof — no server-side support surface of any
    // spelling. After fix: remove the offending name from the forbidden list (or invert).
    const dirs = readdirSync(join(ROOT, 'app', 'api'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
    const supportLike = dirs.filter((n) => /^(support|help|helpdesk|contact|assistance|sav|faq)$/i.test(n))
    expect(supportLike).toEqual([])
  })

  it('[PASS-ACTUEL] app/api/tickets = tickets de table dine-in (POS), PAS un système de tickets support', () => {
    // Guard against the faux-ami: the "tickets" API is the dine-in table ticket
    // (tableTicket, owner-scoped by restaurantTableId) — it is unrelated to support.
    const src = readFileSync(join(ROOT, 'app', 'api', 'tickets', 'route.ts'), 'utf8')
    expect(src).toContain('tableTicket')
    expect(src).toContain('restaurantTableId')
    expect(src).not.toMatch(/support/i)
  })
})

// ════════════════════════════════════════════════════════════════════════════════════
describe("P6 — page d'aide /eat/order/[orderId]/help (caractérisation source)", () => {
  const src = readFileSync(HELP_PAGE, 'utf8')

  it("[PASS-ACTUEL] la page d'aide consommateur existe (app/[locale]/eat/order/[orderId]/help/page.tsx)", () => {
    expect(existsSync(HELP_PAGE)).toBe(true)
    expect(src.length).toBeGreaterThan(0)
  })

  it("[CORRIGÉ LOT 4: chat scripté retiré] les bulles pré-écrites (chatAgent1/chatMe1/chatAgent2) ne sont plus rendues", () => {
    // FIX (closed-beta LOT 4): the pre-written agent dialogue is GONE from the page.
    // The « Support » view is now an honest e-mail contact (no fabricated conversation).
    // The i18n keys themselves remain in messages/* (no-key-deletion rule) but are unused.
    expect(src).not.toContain("t('chatAgent1'")
    expect(src).not.toContain("t('chatMe1')")
    expect(src).not.toContain("t('chatAgent2')")
  })

  it("[CORRIGÉ LOT 4: composer retiré] plus aucun composer de chat (même désactivé) — aucune saisie fantôme", () => {
    // FIX (closed-beta LOT 4): the hard-disabled composer is GONE entirely — no dead
    // input pretending a chat exists. (No real chat backend was added.)
    expect(src).not.toMatch(/aria-label=\{t\('chatPlaceholder'\)\}\s+disabled\s*\/>/)
    expect(src).not.toContain("t('chatPlaceholder')")
  })

  it("[FAIL-ATTENDU: aucun appel réseau support] la page ne fetch QUE /api/orders/[id] et /api/claims — aucun endpoint support/help", () => {
    // AUDIT: every network call on the help screen targets order data or the claims
    // gate; not a single request reaches a support/help endpoint (none exists).
    const urls = [...src.matchAll(/fetch\(\s*[`'"]([^`'",)]+)/g)].map((m) => m[1])
    expect(urls.length).toBeGreaterThan(0)
    for (const u of urls) {
      expect(u.startsWith('/api/orders/') || u.startsWith('/api/claims')).toBe(true)
    }
    expect(src).not.toMatch(/\/api\/(support|help)/)
  })

  it("[CORRIGÉ LOT 4: contact e-mail réel] le contact « E-mail » est un vrai lien mailto:contact@grubano.com", () => {
    // FIX (closed-beta LOT 4): the decorative <button> became a real <a href="mailto:">
    // to the product's ONLY real support channel (same address as the dine-in receipt).
    expect(src).not.toMatch(/<button type="button" className="cbtn">\s*<span className="ms" aria-hidden="true">mail<\/span>/)
    expect(src).toContain('mailto:contact@grubano.com')
  })

  it("[CORRIGÉ LOT 4: présence simulée retirée] plus aucun badge « En ligne » en dur", () => {
    // FIX (closed-beta LOT 4): the hardcoded presence badge is GONE — no presence is
    // claimed anywhere on the help screen (no presence signal exists).
    expect(src).not.toContain('<Header titleKey="supportTitle" online />')
    expect(src).not.toContain("t('online')")
    expect(src).not.toContain('className="online"')
  })
})

// ════════════════════════════════════════════════════════════════════════════════════
describe('P6 — i18n : script de conversation pré-écrit (fr.json)', () => {
  it("[FAIL-ATTENDU: simulation humain via i18n] fr.json embarque le dialogue agent + des délais de réponse (~2 min / < 24 h) sans backend", () => {
    // AUDIT: the "human" replies and the promised response times live as static copy
    // in messages/fr.json — they are promises with no system behind them. After fix:
    // these keys should either disappear or be backed by a real channel.
    const fr = JSON.parse(readFileSync(join(ROOT, 'messages', 'fr.json'), 'utf8')) as {
      eat?: { help?: Record<string, string> }
    }
    const help = fr.eat?.help ?? {}
    for (const key of ['chatAgent1', 'chatMe1', 'chatAgent2']) {
      expect(typeof help[key], `eat.help.${key} is a scripted bubble`).toBe('string')
      expect((help[key] ?? '').length).toBeGreaterThan(0)
    }
    expect(help.online).toContain('En ligne')       // simulated presence
    expect(help.contactChatEta).toBe('~2 min')      // promised chat ETA, no chat backend
    expect(help.contactEmailEta).toBe('< 24 h')     // promised email ETA, no email channel
  })
})

// ════════════════════════════════════════════════════════════════════════════════════
describe('P6 — seul canal réel adjacent : /api/claims (remboursement), gaté OFF par défaut', () => {
  // Deviation from the raw audit verdict, encoded honestly: the refund view of the
  // help page IS wired to a real API (/api/claims) — but the CLAIMS_ENABLED kill-switch
  // defaults OFF, so the production-default help screen stays fully inert.

  it("[PASS-ACTUEL] isClaimsEnabled() = false sans CLAIMS_ENABLED → la vue remboursement de la page d'aide reste inerte (« bientôt »)", () => {
    vi.stubEnv('CLAIMS_ENABLED', '')
    expect(isClaimsEnabled()).toBe(false)
    vi.stubEnv('CLAIMS_ENABLED', 'false')
    expect(isClaimsEnabled()).toBe(false)
  })

  it("[PASS-ACTUEL] isClaimsEnabled() = true uniquement quand CLAIMS_ENABLED === 'true' (comparaison stricte)", () => {
    vi.stubEnv('CLAIMS_ENABLED', 'true')
    expect(isClaimsEnabled()).toBe(true)
    vi.stubEnv('CLAIMS_ENABLED', 'TRUE') // strict equality — any other spelling stays OFF
    expect(isClaimsEnabled()).toBe(false)
  })

  it("[PASS-ACTUEL] GET /api/claims flag OFF → { enabled:false } sans même consulter l'auth (la page d'aide retombe sur le chemin inerte)", async () => {
    vi.stubEnv('CLAIMS_ENABLED', '')
    const res = await CLAIMS_GET(claimsReq('https://app.grubano.com/api/claims?orderId=o1'))
    expect(await res.json()).toEqual({ enabled: false })
    expect(tokenMock).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] GET /api/claims flag ON sans session → 401 (le canal réclamation est réel mais derrière auth)', async () => {
    vi.stubEnv('CLAIMS_ENABLED', 'true')
    tokenMock.mockResolvedValue(null)
    const res = await CLAIMS_GET(claimsReq())
    expect(res.status).toBe(401)
  })
})

// ════════════════════════════════════════════════════════════════════════════════════
describe('P6 — clics UI (navigateur requis)', () => {
  it.todo("[NON-TESTABLE: clic navigateur] clic « Chat » / « Annuler » → bascule vers la vue conversation scriptée (toggle client)")
  it.todo("[NON-TESTABLE: clic navigateur] clic sur un sujet d'aide (Paiements/Compte/Récompenses) → aucun effet (bouton sans handler)")
  it.todo("[NON-TESTABLE: clic navigateur] clic « E-mail » → aucun effet (bouton décoratif)")
  it.todo("[NON-TESTABLE: saisie navigateur] la recherche du centre d'aide n'a aucun handler — champ décoratif")
  it.todo("[NON-TESTABLE: clic navigateur] bouton « ajouter une photo » (vue remboursement) → inerte (upload non câblé)")
})
