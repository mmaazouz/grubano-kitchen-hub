import { describe, it, expect } from 'vitest'
import {
  canTransitionMission, allowedMissionTransitions, isTerminalMission,
  SERVICE_MISSION_STATUSES, TERMINAL_MISSION_STATUSES,
} from '@/lib/service-mission'

// ── lib/service-mission — pure DEVIS→MISSION state machine (P3, Agent 76) ─────
// The single source of "who may move a mission where". NO money — a transition only
// changes status; the quote amount is set alongside as data.

describe('happy path — requested → quoted → accepted → done (a)', () => {
  it('each step is allowed for the correct actor', () => {
    expect(canTransitionMission('prestataire', 'requested', 'quoted')).toBe(true)   // chiffrer
    expect(canTransitionMission('restaurant', 'quoted', 'accepted')).toBe(true)     // accepter
    expect(canTransitionMission('prestataire', 'accepted', 'done')).toBe(true)      // réaliser
  })
})

describe('off-ramps — declined / cancelled', () => {
  it('prestataire declines a request; resto cancels a request; resto declines a quote', () => {
    expect(canTransitionMission('prestataire', 'requested', 'declined')).toBe(true)
    expect(canTransitionMission('restaurant', 'requested', 'cancelled')).toBe(true)
    expect(canTransitionMission('restaurant', 'quoted', 'declined')).toBe(true)
  })
})

describe('invalid transitions are refused (b)', () => {
  it('cannot accept an un-quoted (still requested) mission', () => {
    expect(canTransitionMission('restaurant', 'requested', 'accepted')).toBe(false)
  })
  it('cannot mark done a non-accepted mission', () => {
    expect(canTransitionMission('prestataire', 'quoted', 'done')).toBe(false)
    expect(canTransitionMission('prestataire', 'requested', 'done')).toBe(false)
  })
  it('no transition leaves a TERMINAL state', () => {
    for (const s of TERMINAL_MISSION_STATUSES) {
      expect(allowedMissionTransitions('prestataire', s)).toEqual([])
      expect(allowedMissionTransitions('restaurant', s)).toEqual([])
    }
  })
})

describe('roles never perform each other\'s transitions (c)', () => {
  it('the restaurant cannot quote or mark done', () => {
    expect(canTransitionMission('restaurant', 'requested', 'quoted')).toBe(false)
    expect(canTransitionMission('restaurant', 'accepted', 'done')).toBe(false)
  })
  it('the prestataire cannot accept or cancel', () => {
    expect(canTransitionMission('prestataire', 'quoted', 'accepted')).toBe(false)
    expect(canTransitionMission('prestataire', 'requested', 'cancelled')).toBe(false)
  })
})

describe('terminal + status set', () => {
  it('done/declined/cancelled are terminal; in-flight states are not', () => {
    expect(isTerminalMission('done')).toBe(true)
    expect(isTerminalMission('declined')).toBe(true)
    expect(isTerminalMission('cancelled')).toBe(true)
    expect(isTerminalMission('requested')).toBe(false)
    expect(isTerminalMission('quoted')).toBe(false)
    expect(isTerminalMission('accepted')).toBe(false)
  })
  it('exposes exactly the 6 statuses', () => {
    expect([...SERVICE_MISSION_STATUSES].sort()).toEqual(
      ['accepted', 'cancelled', 'declined', 'done', 'quoted', 'requested'],
    )
  })
})
