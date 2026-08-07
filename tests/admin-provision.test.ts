import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mission U — provisionnement d'un administrateur (scripts/server) ──────────
// Le cœur (provisionAdmin) est un module CommonJS AUTONOME (aucun alias @/, le
// client prisma est INJECTÉ) précisément pour être exécutable sur le serveur
// ET testable ici avec un mock. Les critères d'acceptation mesurables de la
// mission sont chacun couverts par un test nommé.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { provisionAdmin, parseArgs } = require('../scripts/server/provision-admin.js')

type Db = {
  operator:      { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
  operatorRole:  { upsert: ReturnType<typeof vi.fn> }
  adminAuditLog: { create: ReturnType<typeof vi.fn> }
}
let db: Db

beforeEach(() => {
  db = {
    operator:      { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    operatorRole:  { upsert: vi.fn().mockResolvedValue({}) },
    adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
  }
})

describe('provisionAdmin — création (compte absent)', () => {
  it('crée un admin actif, passwordless, avec notifPrefs {} VALIDE (piège 4025), et trace l’audit', async () => {
    db.operator.findUnique.mockResolvedValueOnce(null)
    db.operator.create.mockResolvedValue({ id: 'op1' })

    const r = await provisionAdmin(db, 'Admin@Grubano.com', { name: 'Mohammed' })
    expect(r.mode).toBe('created')

    const data = db.operator.create.mock.calls[0][0].data
    expect(data).toMatchObject({ email: 'admin@grubano.com', role: 'admin', status: 'active', password: null, name: 'Mohammed' })
    expect(data.notifPrefs).toEqual({}) // jamais de chaîne vide — la leçon Mission L
    expect(db.adminAuditLog.create).toHaveBeenCalledTimes(1)
    expect(db.adminAuditLog.create.mock.calls[0][0].data).toMatchObject({
      actorId: 'system:ops-script', action: 'admin.provision', targetType: 'operator', targetId: 'op1',
    })
    expect(r.auditWritten).toBe(true)
  })
})

describe('provisionAdmin — promotion (compte existant)', () => {
  it('AJOUTE le rôle via OperatorRole (INSERT) : AUCUN update de la ligne Operator → passe même notifPrefs cassé', async () => {
    db.operator.findUnique.mockResolvedValueOnce({ id: 'op2', role: 'restaurant', status: 'active', name: 'Resto' })

    const r = await provisionAdmin(db, 'resto@grubano.com')
    expect(r.mode).toBe('promoted')
    expect(db.operatorRole.upsert).toHaveBeenCalledWith({
      where:  { operatorId_role: { operatorId: 'op2', role: 'admin' } },
      update: {},
      create: { operatorId: 'op2', role: 'admin' },
    })
    // critère central : le rôle primaire / password / prefs ne sont JAMAIS touchés
    expect(db.operator.update).not.toHaveBeenCalled()
    expect(db.operator.create).not.toHaveBeenCalled()
  })

  it('déjà admin → mode "already", idempotent, zéro écriture Operator', async () => {
    db.operator.findUnique.mockResolvedValueOnce({ id: 'op3', role: 'admin', status: 'active', name: 'A' })
    const r = await provisionAdmin(db, 'a@b.fr')
    expect(r.mode).toBe('already')
    expect(db.operatorRole.upsert).not.toHaveBeenCalled()
    expect(db.operator.update).not.toHaveBeenCalled()
  })

  it('compte pending SAIN → activé, sonde notifPrefs lue sans réparation', async () => {
    db.operator.findUnique
      .mockResolvedValueOnce({ id: 'op4', role: 'restaurant', status: 'pending', name: 'R' }) // lecture principale
      .mockResolvedValueOnce({ notifPrefs: { a: 1 } })                                        // sonde OK
    const r = await provisionAdmin(db, 'p@b.fr')
    expect(r.statusActivated).toBe(true)
    expect(r.notifPrefsRepaired).toBe(false)
    // un seul update : le status — les préférences saines ne sont pas écrasées
    expect(db.operator.update).toHaveBeenCalledTimes(1)
    expect(db.operator.update.mock.calls[0][0].data).toEqual({ status: 'active' })
  })

  it('compte pending à notifPrefs INVALIDE → réparé en {} PUIS activé (le piège 4025 traité)', async () => {
    db.operator.findUnique
      .mockResolvedValueOnce({ id: 'op5', role: 'restaurant', status: 'pending', name: 'R' })
      .mockRejectedValueOnce(new Error('P2023 inconsistent column data')) // sonde : Json illisible
    const r = await provisionAdmin(db, 'casse@b.fr')
    expect(r.notifPrefsRepaired).toBe(true)
    expect(r.statusActivated).toBe(true)
    expect(db.operator.update).toHaveBeenNthCalledWith(1, { where: { id: 'op5' }, data: { notifPrefs: {} } })
    expect(db.operator.update).toHaveBeenNthCalledWith(2, { where: { id: 'op5' }, data: { status: 'active' } })
  })
})

describe('provisionAdmin — échecs COMPRÉHENSIBLES, jamais du SQL brut', () => {
  it('email invalide → message français explicite', async () => {
    await expect(provisionAdmin(db, 'pas-un-email')).rejects.toThrow(/n'est pas une adresse email valide/)
  })

  it('activation qui échoue malgré la réparation → message qui NOMME notifPrefs et renvoie à la doc', async () => {
    db.operator.findUnique
      .mockResolvedValueOnce({ id: 'op6', role: 'restaurant', status: 'pending', name: 'R' })
      .mockResolvedValueOnce({ notifPrefs: {} })
    db.operator.update.mockRejectedValueOnce(new Error("CONSTRAINT `Operator.notifPrefs` failed"))
    await expect(provisionAdmin(db, 'x@b.fr')).rejects.toThrow(/notifPrefs.*docs\/ops\/provision-admin\.md/s)
  })

  it('OperatorRole indisponible → erreur explicite, rien de modifié ensuite', async () => {
    db.operator.findUnique.mockResolvedValueOnce({ id: 'op7', role: 'restaurant', status: 'active', name: 'R' })
    db.operatorRole.upsert.mockRejectedValueOnce(new Error('no such table'))
    await expect(provisionAdmin(db, 'y@b.fr')).rejects.toThrow(/rôle admin a échoué/)
    expect(db.operator.update).not.toHaveBeenCalled()
  })

  it("journal d'audit indisponible → l'opération RÉUSSIT mais auditWritten=false (le CLI l'affiche)", async () => {
    db.operator.findUnique.mockResolvedValueOnce(null)
    db.operator.create.mockResolvedValue({ id: 'op8' })
    db.adminAuditLog.create.mockRejectedValueOnce(new Error('table absente'))
    const r = await provisionAdmin(db, 'z@b.fr')
    expect(r.mode).toBe('created')
    expect(r.auditWritten).toBe(false)
  })
})

describe('sécurité structurelle — jamais déclenchable depuis le web', () => {
  it("le module n'exporte AUCUN handler HTTP (GET/POST/…) et vit hors de app/", () => {
    const mod = require('../scripts/server/provision-admin.js')
    for (const verb of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(mod[verb], verb).toBeUndefined()
    }
    expect(Object.keys(mod).sort()).toEqual(['parseArgs', 'provisionAdmin'])
  })
})

describe('V4-3 — parseArgs : la forme documentée (--email) ET la positionnelle marchent', () => {
  it('--email + --name (la forme de la doc et de l’aide)', () => {
    expect(parseArgs(['--email', 'a@b.fr', '--name', 'Mo'])).toEqual({ email: 'a@b.fr', name: 'Mo' })
  })
  it('positionnelle (tolérance — l’ancienne forme ne devient pas un piège)', () => {
    expect(parseArgs(['a@b.fr'])).toEqual({ email: 'a@b.fr', name: undefined })
    expect(parseArgs(['--name', 'Mo', 'a@b.fr'])).toEqual({ email: 'a@b.fr', name: 'Mo' })
  })
  it('sans argument → ni email ni name (le CLI affiche l’aide copiable)', () => {
    expect(parseArgs([])).toEqual({ email: undefined, name: undefined })
  })
})
