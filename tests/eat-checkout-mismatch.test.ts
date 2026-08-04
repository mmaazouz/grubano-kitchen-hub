import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── P0-29 (suite revue adversariale) — le 409 « non-carte » du rail /pay ne doit
// JAMAIS s'afficher comme « Cette commande est déjà payée ». La page checkout
// mappait TOUT 409 sur le stage 'already-paid' (coche verte + CTA suivi) : une
// commande cash héritée NON payée aurait été présentée comme payée — fausse
// validation d'encaissement côté UI, la classe exacte de défaut visée par la
// mission. La branche dédiée affiche le message serveur VERBATIM (pattern des
// 400 de la même fonction). Source-scan style (composant 'use client' — même
// style maison que tests/eat-cart-card-only.test.ts), commentaires strippés.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const CHECKOUT = 'app/[locale]/eat/checkout/[orderId]/page.tsx'

describe('P0-29 — la page checkout distingue payment_method_mismatch de « déjà payée »', () => {
  const code = stripComments(read(CHECKOUT))

  it("⭐ une branche dédiée au code 'payment_method_mismatch' existe et affiche le message serveur (setError), pas la coche verte", () => {
    expect(/body\?\.code === 'payment_method_mismatch'/.test(code)).toBe(true)
    // La branche mismatch appelle setError puis return — asserté par la forme du bloc.
    expect(/payment_method_mismatch'\)\s*\{\s*setError\(\(body\?\.error as string\) \|\| t\('errPayInit'\)\)\s*return\s*\}/.test(code)).toBe(true)
  })

  it("le garde mismatch court-circuite AVANT setStage('already-paid') dans le bloc 409", () => {
    const idxMismatch = code.indexOf("payment_method_mismatch")
    const idxAlreadyPaid = code.indexOf("setStage('already-paid')", code.indexOf('startPayment'))
    expect(idxMismatch).toBeGreaterThan(-1)
    expect(idxAlreadyPaid).toBeGreaterThan(-1)
    expect(idxMismatch).toBeLessThan(idxAlreadyPaid)
  })

  it("le chemin « déjà payée » légitime survit : setStage('already-paid') reste présent pour le 409 sans code", () => {
    expect(/setStage\('already-paid'\)/.test(code)).toBe(true)
  })
})
