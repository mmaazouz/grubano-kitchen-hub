import { describe, it, expect } from 'vitest'
import {
  KITCHEN_STATUSES,
  KITCHEN_COLUMNS,
  isKitchenStatus,
  bumpTarget,
  elapsedMin,
  ageOf,
} from '@/lib/kds'

// ── Phase 3 KDS pure helpers ──────────────────────────────────────────────────
// The kitchen board only reads the Order state machine + derives a real timer from
// the server createdAt. These tests lock: the kitchen slice of statuses, the
// forward-only bump (never backward — the real state machine forbids it), and the
// elapsed-time maths (clamped, integer minutes, invalid-safe).

describe('KDS kitchen statuses', () => {
  it('covers exactly the three cooking statuses, in flow order', () => {
    expect(KITCHEN_STATUSES).toEqual(['received', 'preparing', 'ready'])
    expect(KITCHEN_COLUMNS).toEqual(['received', 'preparing', 'ready'])
  })
  it('isKitchenStatus keeps cooking, drops dispatch/history', () => {
    expect(isKitchenStatus('received')).toBe(true)
    expect(isKitchenStatus('preparing')).toBe(true)
    expect(isKitchenStatus('ready')).toBe(true)
    for (const s of ['picked_up', 'delivered', 'cancelled', 'awaiting_payment', 'expired', 'nonsense']) {
      expect(isKitchenStatus(s)).toBe(false)
    }
  })
})

describe('bumpTarget — forward-only, mirrors the server TRANSITIONS', () => {
  it('advances received → preparing → ready then stops', () => {
    expect(bumpTarget('received')).toBe('preparing')
    expect(bumpTarget('preparing')).toBe('ready')
    expect(bumpTarget('ready')).toBeNull() // cooking done; no backward, no self-loop
  })
  it('never targets a backward or non-kitchen status', () => {
    for (const s of ['ready', 'picked_up', 'delivered', 'cancelled', 'awaiting_payment', '']) {
      const target = bumpTarget(s)
      expect(target === null || target === 'preparing' || target === 'ready').toBe(true)
    }
  })
})

describe('elapsedMin — real timer from server createdAt', () => {
  const now = Date.parse('2026-07-02T12:00:00.000Z')
  it('returns whole minutes elapsed', () => {
    expect(elapsedMin('2026-07-02T11:56:00.000Z', now)).toBe(4)
    expect(elapsedMin('2026-07-02T11:34:30.000Z', now)).toBe(25) // floored
    expect(elapsedMin('2026-07-02T12:00:00.000Z', now)).toBe(0)
  })
  it('clamps a future timestamp (clock skew) to 0, never negative', () => {
    expect(elapsedMin('2026-07-02T12:05:00.000Z', now)).toBe(0)
  })
  it('is invalid-safe (returns 0, never NaN)', () => {
    expect(elapsedMin('not-a-date', now)).toBe(0)
    expect(elapsedMin('', now)).toBe(0)
  })
})

describe('ageOf — colour buckets', () => {
  it('fresh < 10 ≤ warn < 20 ≤ late', () => {
    expect(ageOf(0)).toBe('fresh')
    expect(ageOf(9)).toBe('fresh')
    expect(ageOf(10)).toBe('warn')
    expect(ageOf(19)).toBe('warn')
    expect(ageOf(20)).toBe('late')
    expect(ageOf(120)).toBe('late')
  })
})
