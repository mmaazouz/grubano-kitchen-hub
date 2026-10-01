import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as React from 'react'

// ── P0-38 — masquage serveur des PAGES des 4 rôles gelés (doctrine Q8) ────────
// P0-06 avait gaté les routes API ; en session restaurateur réelle, les PAGES
// répondaient encore (landing, tableau de bord, redirections). Le correctif est
// un layout SERVEUR gate par arbre : flag OFF → notFound() AVANT tout rendu —
// couvre les 14 pages CLIENT (qui ne peuvent pas lire le flag) et les pages
// futures. Ce test prouve, pour CHAQUE arbre : OFF → NEXT_NOT_FOUND, jamais les
// enfants ; ON → les enfants rendent, jamais notFound.
vi.stubGlobal('React', React)

const { notFoundMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))
vi.mock('next/navigation', () => ({ notFound: notFoundMock }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import CreatorsGate from '@/app/[locale]/creators/layout'
import SupplierGate from '@/app/[locale]/supplier/layout'
import FranchiseGate from '@/app/[locale]/franchise/layout'
import LogisticsGate from '@/app/[locale]/logistics/layout'
import BizLogisticsGate from '@/app/[locale]/business/logistics/layout'
import ChefGate from '@/app/[locale]/chef/layout'
import EatChefGate from '@/app/[locale]/eat/c/layout'

const TREES: Array<[string, string, (p: { children: React.ReactNode }) => React.ReactNode]> = [
  ['/creators (arbre entier)',          'CREATOR_ENABLED',   CreatorsGate],
  ['/supplier (arbre entier)',          'SUPPLIER_ENABLED',  SupplierGate],
  ['/franchise (arbre entier)',         'FRANCHISE_ENABLED', FranchiseGate],
  ['/logistics (espace livreur)',       'LOGISTICS_ENABLED', LogisticsGate],
  ['/business/logistics (inscription)', 'LOGISTICS_ENABLED', BizLogisticsGate],
  ['/chef/[slug] (page chef publique)', 'CREATOR_ENABLED',   ChefGate],
  ['/eat/c/[slug] (page chef conso)',   'CREATOR_ENABLED',   EatChefGate],
]
const FLAGS = ['CREATOR_ENABLED', 'SUPPLIER_ENABLED', 'FRANCHISE_ENABLED', 'LOGISTICS_ENABLED']

beforeEach(() => { FLAGS.forEach((f) => delete process.env[f]); notFoundMock.mockClear() })
afterEach(() => { FLAGS.forEach((f) => delete process.env[f]) })

const CHILD = React.createElement('span', null, 'enfant')

describe('P0-38 — flag OFF → INTROUVABLE (notFound) avant tout rendu', () => {
  for (const [name, flag, Gate] of TREES) {
    it(`${name} — OFF (${flag})`, () => {
      expect(() => Gate({ children: CHILD })).toThrow('NEXT_NOT_FOUND')
      expect(notFoundMock).toHaveBeenCalledTimes(1)
    })
  }
})

describe('P0-38 — flag ON → les enfants rendent (comportement inchangé)', () => {
  for (const [name, flag, Gate] of TREES) {
    it(`${name} — ON (${flag})`, () => {
      process.env[flag] = 'true'
      const el = Gate({ children: CHILD }) as React.ReactElement
      expect(notFoundMock).not.toHaveBeenCalled()
      // le layout rend un fragment contenant EXACTEMENT les enfants
      expect((el.props as { children: React.ReactNode }).children).toBe(CHILD)
    })
  }
})

describe("P0-38 — seule la chaîne exacte 'true' ouvre un arbre", () => {
  it("'1' / 'TRUE' ne suffisent pas", () => {
    process.env.CREATOR_ENABLED = '1'
    expect(() => CreatorsGate({ children: CHILD })).toThrow('NEXT_NOT_FOUND')
    process.env.CREATOR_ENABLED = 'TRUE'
    expect(() => CreatorsGate({ children: CHILD })).toThrow('NEXT_NOT_FOUND')
  })
})
