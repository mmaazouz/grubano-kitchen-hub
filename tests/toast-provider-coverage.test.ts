import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// ── P0-37 (vague 2) — le motif « useToast() hors ToastProvider » est désormais
// IMPOSSIBLE À RÉINTRODUIRE SILENCIEUSEMENT ────────────────────────────────────
//
// Deux occurrences du même bug ont échappé à deux revues (P0-14 : /orders page
// blanche ; P0-37 : /admin/claims écran de reprise — la file d'arbitrage, SEULE
// sortie du circuit réclamation, inaccessible). Cause structurelle : le hook
// components/design-system/Toast.tsx:136-142 THROW AU RENDU hors provider, et
// l'app opérateur n'a AUCUN provider global — chaque îlot doit monter le sien.
//
// Ce test rend le motif non-réintroduisible : il DÉCOUVRE dynamiquement tout
// appel useToast() dans app/ + components/ et exige que chaque fichier appelant
// soit dans l'ALLOWLIST ci-dessous, avec une PREUVE de couverture re-vérifiée à
// chaque run (provider dans le même fichier, au site de montage, ou dans le
// layout). Un NOUVEL appelant fait échouer la suite (gate CI des deux deploys)
// avec un message expliquant quoi faire — la 3e occurrence n'attendra pas un
// 3e incident.

const ROOT = process.cwd()
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** Récursif, sans dépendance : tous les .tsx/.ts sous un dossier (hors node_modules). */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const rel = `${dir}/${name}`
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out)
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\.(tsx|ts)$/.test(name)) out.push(rel)
  }
  return out
}

/** Un fichier « appelle » useToast s'il invoque le hook (pas la définition, pas le barrel). */
const DEFINITION_FILES = new Set([
  'components/design-system/Toast.tsx', // définit useToast (le throw vit ici)
  'components/design-system/index.ts',  // barrel re-export
])
const callsUseToast = (rel: string) => {
  if (DEFINITION_FILES.has(rel)) return false
  const code = stripComments(read(rel))
  return /\buseToast\(\)/.test(code)
}

// ── L'ALLOWLIST : chaque appelant connu + sa preuve de couverture ──────────────
// mode 'self'   → le fichier appelant monte lui-même <ToastProvider> (îlot
//                 auto-enveloppé : export default = wrapper, hook dans l'Inner).
// mode 'mount'  → le provider est posé AU SITE DE MONTAGE : `file` doit contenir
//                 <ToastProvider> immédiatement autour du composant nommé.
// mode 'layout' → un layout au-dessus de TOUTES les routes qui montent le
//                 composant contient le provider.
type Proof =
  | { mode: 'self' }
  | { mode: 'mount'; file: string; wraps: string }
  | { mode: 'layout'; file: string }
  | { mode: 'consumers'; files: string[] } // hook partagé : chaque consommateur est auto-enveloppé

const ALLOWLIST: Record<string, Proof> = {
  // P0-37 — l'îlot admin est enveloppé À SON SITE DE MONTAGE (patron P0-14).
  'components/claims/AdminClaimsArbitration.tsx':
    { mode: 'mount', file: 'app/[locale]/admin/claims/page.tsx', wraps: 'AdminClaimsArbitration' },
  // P0-14 — le panel resto est enveloppé à son site de montage (/orders).
  'components/claims/RestaurantClaimsPanel.tsx':
    { mode: 'mount', file: 'app/[locale]/orders/page.tsx', wraps: 'RestaurantClaimsPanel' },
  // /eat : le provider vit dans le layout du segment — couvre toutes les routes /eat/**.
  'components/claims/ClaimSection.tsx':  { mode: 'layout', file: 'app/[locale]/eat/layout.tsx' },
  'components/eat/ToastBridge.tsx':      { mode: 'layout', file: 'app/[locale]/eat/layout.tsx' },
  // Îlots auto-enveloppés (export default = <ToastProvider><Inner/></ToastProvider>).
  'components/orders/OrdersClient.tsx':          { mode: 'self' },
  'components/dashboard/FulfillmentForm.tsx':    { mode: 'self' },
  'app/[locale]/menu/page.tsx':                  { mode: 'self' },
  'app/[locale]/design/page.tsx':                { mode: 'self' },
  // Hook partagé (useOrderAdvance) : ses DEUX consommateurs sont auto-enveloppés —
  // la preuve porte sur EUX (le fichier du hook ne monte rien lui-même).
  'components/orders/order-actions.tsx': {
    mode: 'consumers',
    files: ['components/orders/OrdersClient.tsx', 'components/dashboard/LiveOrders.tsx'],
  },
}

describe('P0-37 — couverture ToastProvider : inventaire vivant', () => {
  const callers = [...walk('app'), ...walk('components')].filter(callsUseToast).sort()

  it("⭐ TOUT appelant de useToast() est dans l'allowlist — un nouvel appelant DOIT y inscrire sa preuve de couverture", () => {
    const unknown = callers.filter((f) => !(f in ALLOWLIST))
    expect(
      unknown,
      `Nouveau(x) appelant(s) useToast() hors allowlist : ${unknown.join(', ')}.\n` +
      `Le hook THROW AU RENDU hors <ToastProvider> (Toast.tsx:136-142) — c'est le bug P0-14/P0-37.\n` +
      `→ Prouvez la couverture (provider self/mount/layout) puis inscrivez le fichier dans\n` +
      `  l'ALLOWLIST de tests/toast-provider-coverage.test.ts avec le mode correspondant.`,
    ).toEqual([])
  })

  it("l'allowlist ne contient pas d'entrées mortes (chaque entrée appelle encore useToast)", () => {
    const stale = Object.keys(ALLOWLIST).filter((f) => !callers.includes(f))
    expect(stale).toEqual([])
  })

  it('chaque preuve de couverture TIENT (self/mount/layout/consumers re-vérifiés sur la source, commentaires exclus)', () => {
    // stripComments AVANT le test de présence : un provider mentionné dans un
    // COMMENTAIRE ne compte pas comme une preuve.
    const hasProvider = (rel: string) => /<ToastProvider>/.test(stripComments(read(rel)))
    for (const [caller, proof] of Object.entries(ALLOWLIST)) {
      if (proof.mode === 'self') {
        expect(hasProvider(caller), `${caller} : provider auto-enveloppé absent`).toBe(true)
      } else if (proof.mode === 'mount') {
        const site = stripComments(read(proof.file))
        const wrapped = new RegExp(`<ToastProvider>\\s*<${proof.wraps}`).test(site)
        expect(wrapped, `${proof.file} : <ToastProvider> n'enveloppe plus <${proof.wraps}>`).toBe(true)
      } else if (proof.mode === 'layout') {
        expect(hasProvider(proof.file), `${proof.file} : provider de layout absent`).toBe(true)
      } else {
        for (const f of proof.files) {
          expect(hasProvider(f), `${f} : consommateur du hook non auto-enveloppé`).toBe(true)
        }
      }
    }
  })

  it("le hook lui-même throw toujours hors provider (le filet reste tendu — c'est LUI qui rend le test nécessaire)", () => {
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
