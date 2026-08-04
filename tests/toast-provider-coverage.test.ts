import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// ── P0-37 (vague 2, durci post-revue adversariale) — le motif « useToast() hors
// ToastProvider » ne peut plus se réintroduire SILENCIEUSEMENT ────────────────
//
// Deux occurrences du même bug ont échappé à deux revues (P0-14 : /orders page
// blanche ; P0-37 : /admin/claims écran de reprise — la file d'arbitrage, SEULE
// sortie du circuit réclamation, inaccessible). Cause structurelle : le hook
// components/design-system/Toast.tsx:136-142 THROW AU RENDU hors provider, et
// l'app opérateur n'a AUCUN provider global — chaque îlot doit monter le sien.
//
// Ce que ce test rend IMPOSSIBLE À PASSER AU VERT :
//   1. un NOUVEAU fichier appelant useToast() (découverte dynamique app/ +
//      components/ + lib/, allowlist obligatoire) ;
//   2. un NOUVEL APPEL dans un fichier déjà connu (le NOMBRE d'appels est
//      épinglé par fichier — c'était le trou « PromosTab » trouvé en revue) ;
//   3. un NOUVEAU SITE DE MONTAGE d'un composant non-auto-enveloppé (les sites
//      de montage sont ÉNUMÉRÉS et comparés — c'était le trou « même widget,
//      nouvelle page » qui a transformé P0-14 en P0-37) ;
//   4. un import ALIASÉ du hook (`useToast as x`) — détecté et refusé ;
//   5. la disparition d'une preuve (provider retiré du fichier/site/layout).
// Limites résiduelles ASSUMÉES (documentées, pas de fausse promesse) : un
// contournement sémantique délibéré (const h = useToast; h()) reste possible.

const ROOT = process.cwd()
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** Récursif, sans dépendance : sources sous un dossier (hors node_modules/tests). */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const rel = `${dir}/${name}`
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out)
    else if (/\.(tsx|ts|jsx|js)$/.test(name) && !/\.test\.(tsx|ts)$/.test(name)) out.push(rel)
  }
  return out
}

const SOURCES = [...walk('app'), ...walk('components'), ...walk('lib')]

/** Fichiers qui DÉFINISSENT le système (pas des appelants). */
const DEFINITION_FILES = new Set([
  'components/design-system/Toast.tsx', // définit useToast (le throw vit ici)
  'components/design-system/index.ts',  // barrel re-export
])

/** Chaînes '…' et "…" strippées (une mention de useToast() dans un LIBELLÉ — ex.
 *  la caption du style guide design/page.tsx:415 — n'est pas un appel). Les
 *  template literals sont conservés : leurs ${…} peuvent porter du vrai code. */
const stripStrings = (s: string) =>
  s.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/'(?:[^'\\\n]|\\.)*'/g, "''")

/** Nombre d'appels useToast(…) par fichier (commentaires + chaînes strippés). */
const callCount = (rel: string) =>
  (stripStrings(stripComments(read(rel))).match(/\buseToast\s*\(/g) ?? []).length

/** Sites de montage RÉELS d'un composant : sources contenant <Nom … (hors définition). */
const mountSites = (component: string, definitionFile: string) =>
  SOURCES.filter((f) => f !== definitionFile && new RegExp(`<${component}[\\s/>]`).test(stripComments(read(f)))).sort()

// ── L'ALLOWLIST : chaque appelant connu, son NOMBRE d'appels épinglé, sa preuve ─
// self      → le fichier monte <ToastProvider> autour du composant `wraps` qui
//             contient l'appel (un nouveau montage de CE composant est sûr : le
//             provider voyage avec lui).
// mount     → composant NON auto-enveloppé : ses sites de montage sont ÉNUMÉRÉS
//             (`sites`) et chaque site doit l'envelopper dans <ToastProvider>,
//             OU vivre sous le segment couvert par `layout`.
// consumers → hook partagé : ses importeurs sont énumérés, chacun auto-enveloppé.
type Proof =
  | { mode: 'self'; wraps: string }
  | { mode: 'mount'; component: string; sites: string[]; layout?: string }
  | { mode: 'consumers'; files: string[] }

const ALLOWLIST: Record<string, { calls: number; proof: Proof }> = {
  // P0-37 — l'îlot admin est enveloppé À SON SITE DE MONTAGE (patron P0-14).
  'components/claims/AdminClaimsArbitration.tsx': {
    calls: 1,
    proof: { mode: 'mount', component: 'AdminClaimsArbitration', sites: ['app/[locale]/admin/claims/page.tsx'] },
  },
  // P0-14 — le panel resto est enveloppé à son site de montage (/orders).
  'components/claims/RestaurantClaimsPanel.tsx': {
    calls: 1,
    proof: { mode: 'mount', component: 'RestaurantClaimsPanel', sites: ['app/[locale]/orders/page.tsx'] },
  },
  // /eat : couverts par le layout du segment (ToastProvider à eat/layout.tsx) —
  // tout site de montage doit donc vivre sous app/[locale]/eat/.
  'components/claims/ClaimSection.tsx': {
    calls: 1,
    proof: { mode: 'mount', component: 'ClaimSection', sites: ['app/[locale]/eat/track/[orderId]/page.tsx'], layout: 'app/[locale]/eat/layout.tsx' },
  },
  'components/eat/ToastBridge.tsx': {
    calls: 1,
    proof: { mode: 'mount', component: 'ToastBridge', sites: ['app/[locale]/eat/layout.tsx'], layout: 'app/[locale]/eat/layout.tsx' },
  },
  // Îlots auto-enveloppés (export default = <ToastProvider><Inner/></ToastProvider>).
  'components/orders/OrdersClient.tsx':       { calls: 1, proof: { mode: 'self', wraps: 'OrdersInner' } },
  'components/dashboard/FulfillmentForm.tsx': { calls: 1, proof: { mode: 'self', wraps: 'FulfillmentFormInner' } },
  'app/[locale]/menu/page.tsx':               { calls: 1, proof: { mode: 'self', wraps: 'AdoptTabInner' } },
  'app/[locale]/design/page.tsx':             { calls: 1, proof: { mode: 'self', wraps: 'DesignInner' } },
  // Hook partagé (useOrderAdvance) : la preuve porte sur ses consommateurs.
  'components/orders/order-actions.tsx': {
    calls: 1,
    proof: { mode: 'consumers', files: ['components/orders/OrdersClient.tsx', 'components/dashboard/LiveOrders.tsx'] },
  },
}

describe('P0-37 — couverture ToastProvider : inventaire vivant (durci post-revue)', () => {
  const callers = SOURCES.filter((f) => !DEFINITION_FILES.has(f) && callCount(f) > 0).sort()

  it("⭐ TOUT appelant de useToast() est dans l'allowlist — un nouvel appelant DOIT y inscrire sa preuve", () => {
    const unknown = callers.filter((f) => !(f in ALLOWLIST))
    expect(
      unknown,
      `Nouveau(x) appelant(s) useToast() hors allowlist : ${unknown.join(', ')}.\n` +
      `Le hook THROW AU RENDU hors <ToastProvider> (Toast.tsx:136-142) — c'est le bug P0-14/P0-37.\n` +
      `→ Prouvez la couverture (self/mount/consumers) puis inscrivez le fichier dans\n` +
      `  l'ALLOWLIST de tests/toast-provider-coverage.test.ts.`,
    ).toEqual([])
  })

  it("⭐ le NOMBRE d'appels par fichier est épinglé — un appel AJOUTÉ dans un fichier connu (ex. un onglet frère sans provider) fait échouer", () => {
    for (const [file, entry] of Object.entries(ALLOWLIST)) {
      expect(
        callCount(file),
        `${file} : ${callCount(file)} appel(s) useToast(), ${entry.calls} épinglé(s).\n` +
        `Un appel ajouté doit être re-prouvé (le provider du fichier ne couvre pas forcément le nouveau composant).`,
      ).toBe(entry.calls)
    }
  })

  it("l'allowlist ne contient pas d'entrées mortes", () => {
    const stale = Object.keys(ALLOWLIST).filter((f) => !callers.includes(f))
    expect(stale).toEqual([])
  })

  it('⭐ aucun import ALIASÉ du hook (useToast as …) — le filet de découverte ne peut pas être contourné par renommage', () => {
    const aliased = SOURCES.filter((f) => /useToast\s+as\s+\w+/.test(stripComments(read(f))))
    expect(aliased).toEqual([])
  })

  it('chaque preuve de couverture TIENT (self/mount/consumers, commentaires exclus, sites de montage ÉNUMÉRÉS)', () => {
    for (const [caller, { proof }] of Object.entries(ALLOWLIST)) {
      if (proof.mode === 'self') {
        const wrapped = new RegExp(`<ToastProvider>\\s*<${proof.wraps}[\\s/>]`).test(stripComments(read(caller)))
        expect(wrapped, `${caller} : <ToastProvider> n'enveloppe plus <${proof.wraps}>`).toBe(true)
      } else if (proof.mode === 'mount') {
        // 1. Les sites de montage RÉELS = exactement les sites déclarés (un
        //    nouveau montage du composant DOIT être prouvé puis déclaré ici —
        //    c'est le trou « même widget, nouvelle page » P0-14 → P0-37).
        const actual = mountSites(proof.component, caller)
        expect(
          actual,
          `${proof.component} : sites de montage réels ≠ déclarés — nouveau site à prouver puis déclarer.`,
        ).toEqual([...proof.sites].sort())
        // 2. Chaque site est couvert : provider immédiat, ou layout de segment.
        for (const site of proof.sites) {
          if (proof.layout) {
            expect(site.startsWith('app/[locale]/eat/'), `${site} : hors du segment couvert par ${proof.layout}`).toBe(true)
          } else {
            const wrapped = new RegExp(`<ToastProvider>\\s*<${proof.component}[\\s/>]`).test(stripComments(read(site)))
            expect(wrapped, `${site} : <ToastProvider> n'enveloppe plus <${proof.component}>`).toBe(true)
          }
        }
        if (proof.layout) {
          expect(/<ToastProvider>/.test(stripComments(read(proof.layout))), `${proof.layout} : provider de layout absent`).toBe(true)
        }
      } else {
        // Hook partagé : les importeurs réels = exactement les déclarés, chacun auto-enveloppé.
        const importers = SOURCES.filter((f) => f !== caller && /useOrderAdvance/.test(stripComments(read(f)))).sort()
        expect(importers, 'useOrderAdvance : importeurs réels ≠ déclarés').toEqual([...proof.files].sort())
        for (const f of proof.files) {
          expect(/<ToastProvider>/.test(stripComments(read(f))), `${f} : consommateur du hook non auto-enveloppé`).toBe(true)
        }
      }
    }
  })

  it("le hook lui-même throw toujours hors provider (le filet reste tendu — c'est LUI qui rend ce test nécessaire)", () => {
    const toast = read('components/design-system/Toast.tsx')
    expect(/throw new Error\('useToast must be used inside <ToastProvider>'\)/.test(toast)).toBe(true)
  })
})

describe('P0-37 — le fix /admin/claims (jumeau P0-14)', () => {
  it("⭐ la page admin claims monte l'arbitrage SOUS son propre ToastProvider", () => {
    const page = read('app/[locale]/admin/claims/page.tsx')
    expect(/import \{ ToastProvider \} from '@\/components\/design-system'/.test(page)).toBe(true)
    expect(/<ToastProvider>\s*<AdminClaimsArbitration \/>\s*<\/ToastProvider>/.test(page)).toBe(true)
  })

  it('non-régression P0-14 : le fix /orders tient toujours', () => {
    const page = read('app/[locale]/orders/page.tsx')
    expect(/<ToastProvider>\s*<RestaurantClaimsPanel \/>/.test(page)).toBe(true)
  })
})
