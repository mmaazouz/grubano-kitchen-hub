import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ── WAVE 3 (2026-08-29) — LOGISTICS_SIGNUP_ENABLED ────────────────────────────
// Le reality check a prouvé que LOGISTICS_ENABLED gattait PAR ERREUR l'inscription
// en plus de l'opérationnel (réponse « C » à la question du fondateur). Ce fichier
// épingle la SÉPARATION : le flag signup ouvre la waitlist (landing + formulaire +
// POST register) et RIEN d'autre ; l'opérationnel reste verrouillé par
// LOGISTICS_ENABLED, et l'ACTIVATION par LOGISTICS_COURIER_ACTIVATION_ENABLED.

import { isLogisticsSignupEnabled, isLogisticsEnabled, isCourierActivationEnabled } from '@/lib/logistics-account'

const SAVED: Record<string, string | undefined> = {}
const FLAGS = ['LOGISTICS_ENABLED', 'LOGISTICS_SIGNUP_ENABLED', 'LOGISTICS_COURIER_ACTIVATION_ENABLED']

beforeEach(() => { for (const f of FLAGS) { SAVED[f] = process.env[f]; delete process.env[f] } })
afterEach(() => { for (const f of FLAGS) { if (SAVED[f] === undefined) delete process.env[f]; else process.env[f] = SAVED[f] } })

describe('isLogisticsSignupEnabled — séparation inscription / opérationnel', () => {
  it('défaut (tout OFF) → signup fermé, opérationnel fermé, activation fermée', () => {
    expect(isLogisticsSignupEnabled()).toBe(false)
    expect(isLogisticsEnabled()).toBe(false)
    expect(isCourierActivationEnabled()).toBe(false)
  })

  it('SIGNUP seul ON → inscription ouverte, opérationnel TOUJOURS fermé, activation TOUJOURS fermée', () => {
    process.env.LOGISTICS_SIGNUP_ENABLED = 'true'
    expect(isLogisticsSignupEnabled()).toBe(true)
    expect(isLogisticsEnabled()).toBe(false)          // les 17 rails opérationnels restent 404
    expect(isCourierActivationEnabled()).toBe(false)  // aucun compte ne peut devenir actif
  })

  it("non-régression : LOGISTICS_ENABLED=true implique l'inscription ouverte", () => {
    process.env.LOGISTICS_ENABLED = 'true'
    expect(isLogisticsSignupEnabled()).toBe(true)
  })

  it("valeurs non-'true' → fermé (patron strict des flags projet)", () => {
    process.env.LOGISTICS_SIGNUP_ENABLED = '1'
    expect(isLogisticsSignupEnabled()).toBe(false)
  })
})

describe('POST /api/logistics/register — gate signup (statique)', () => {
  // Le comportement runtime OFF=404 est déjà épinglé par tests/role-locks.test.ts
  // (LOGISTICS_ENABLED off ⇒ tous les verbes 404 — toujours vrai flags OFF).
  // Ici : la route lit bien le flag SIGNUP (plus le flag opérationnel) et le
  // chemin sans SIREN ne touche jamais le vérificateur PAYANT.
  const fs = require('fs') as typeof import('fs')
  const src = fs.readFileSync('app/api/logistics/register/route.ts', 'utf8')

  it('la route gate sur isLogisticsSignupEnabled (plus isLogisticsEnabled)', () => {
    expect(/isLogisticsSignupEnabled\(\)/.test(src)).toBe(true)
    expect(/if\s*\(!isLogisticsEnabled\(\)\)/.test(src)).toBe(false)
  })

  it('SIREN optionnel (independent) : requis société via superRefine, verifyBusiness SEULEMENT si siren', () => {
    expect(/superRefine/.test(src)).toBe(true)
    expect(/partnerType === 'company'/.test(src)).toBe(true)
    expect(/if \(siren\) \{[\s\S]*?verifyBusiness/.test(src)).toBe(true)
  })

  it('confirmations honnêtes sur le chemin FRESH uniquement (idempotentes, jamais honeypot/doublon)', () => {
    expect(/sendCourierWaitlistConfirmation/.test(src)).toBe(true)
    expect(/sendAdminNewPartnerEmail\(\{ role: 'logistics'/.test(src)).toBe(true)
    // l'appel est APRÈS le prisma.logisticsProfile.create (ordre du fichier)
    expect(src.indexOf('logisticsProfile.create')).toBeLessThan(src.indexOf('sendCourierWaitlistConfirmation({'))
  })
})
