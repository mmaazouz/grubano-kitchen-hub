import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// ── OperatorShell truth locks (beta-truth train, B2) ──────────────────────────
// Two product lies were removed from the operator shell before the first pilot:
//  1. A dead "Ouvert/Fermé" toggle (local useState with NO backend) that let an
//     operator believe they had paused orders. Removed entirely — a real order
//     pause is a separate post-beta ticket.
//  2. The establishment badge labeled `isActive` (admin-controlled PUBLICATION
//     state) as "Ouvert/Fermé" (opening hours). It now uses honest publication
//     wording: status.published / status.unpublished.
// These are SOURCE locks: they fail if either lie is reintroduced.

const SHELL = readFileSync(path.join(process.cwd(), 'components/operator/OperatorShell.tsx'), 'utf8')
const CSS = readFileSync(path.join(process.cwd(), 'components/operator/operator-shell.css'), 'utf8')

describe('OperatorShell — dead Open/Closed toggle stays removed', () => {
  it('has no local isOpen/open toggle state', () => {
    expect(SHELL).not.toMatch(/useState[^\n]*\bisOpen\b/)
    expect(SHELL).not.toMatch(/\bsetIsOpen\b/)
    expect(SHELL).not.toMatch(/useState\(\s*['"]open['"]/)
  })

  it('renders no op-openclosed button', () => {
    expect(SHELL).not.toContain('op-openclosed')
  })

  it('operator-shell.css carries no orphan .op-openclosed rules', () => {
    expect(CSS).not.toContain('op-openclosed')
  })
})

describe('OperatorShell — establishment badge tells the publication truth', () => {
  it('never labels isActive with status.open/status.closed', () => {
    expect(SHELL).not.toMatch(/status\.open\b/)
    expect(SHELL).not.toMatch(/status\.closed\b/)
  })

  it('uses the honest publication keys on the isActive badge (header + switcher panel)', () => {
    const published = SHELL.match(/isActive \? t\('status\.published'\) : t\('status\.unpublished'\)/g) ?? []
    expect(published.length).toBeGreaterThanOrEqual(2)
  })

  it('the green dot follows the same publication truth (isActive), not a local toggle', () => {
    expect(SHELL).toMatch(/current\.isActive && <i className="dot" \/>/)
  })
})

// ── Same truth on the establishments LIST (review fix) ───────────────────────
// The badge B2 fixed in the shell also lived in EstablishmentsManager: isActive
// rendered as « Ouvert/Fermé » one click away from the shell's « Publié ». Lock
// the list to the same publication wording, including the stat counter (the old
// « Ouverts maintenant » label counted the publication flag as opening hours).
const MANAGER = readFileSync(
  path.join(process.cwd(), 'components/dashboard/EstablishmentsManager.tsx'), 'utf8')

describe('EstablishmentsManager — publication truth on the list badge + counter', () => {
  it('never labels isActive with status.open/status.closed', () => {
    expect(MANAGER).not.toMatch(/status\.open\b/)
    expect(MANAGER).not.toMatch(/status\.closed\b/)
  })

  it('uses the honest publication keys on the isActive badge', () => {
    expect(MANAGER).toMatch(/isActive \? to\('status\.published'\) : to\('status\.unpublished'\)/)
  })

  it('the stat counter no longer claims « Ouverts maintenant » for the publication flag', () => {
    expect(MANAGER).not.toContain('statOpenNow')
    expect(MANAGER).not.toContain('openCount')
  })
})
