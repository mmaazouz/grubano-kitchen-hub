// tests/growth-adapters-noop.test.ts — business-engine Phase 0/1 no-op adapters.
// A no-op MUST never send, never throw, and always return a deterministic shape so logs
// and dashboards remain honest. These tests also pin the public interface so a future
// real adapter cannot silently narrow it.

import { describe, it, expect } from 'vitest'
import {
  noopEmailAdapter, noopSmsAdapter, noopWhatsAppAdapter,
  noopSocialAdapter, noopEnrichmentAdapter, noopOrchestratorAdapter,
} from '@/lib/growth/adapters/noop'

describe('noop adapters — shape', () => {
  it('expose their channel tag', () => {
    expect(noopEmailAdapter.channel).toBe('email')
    expect(noopSmsAdapter.channel).toBe('sms')
    expect(noopWhatsAppAdapter.channel).toBe('whatsapp')
    expect(noopSocialAdapter.channel).toBe('social')
  })
})

describe('noop email adapter', () => {
  it('returns skipped with a deterministic providerMessageId', async () => {
    const r = await noopEmailAdapter.send({
      idempotencyKey: 'idem-1',
      tenantHint: { operatorId: null, restaurantId: null },
      to: { email: 'a@b.co' },
      from: { email: 'contact@grubano.com' },
      subject: 's',
      html: '<p>h</p>',
    })
    expect(r.status).toBe('skipped')
    expect(r.providerMessageId).toBe('noop:idem-1')
    expect(r.reason).toBe('noop:email')
    expect(r.retryAfterMs).toBe(0)
  })

  it('is idempotent — same key returns same providerMessageId', async () => {
    const first  = await noopEmailAdapter.send({
      idempotencyKey: 'same', tenantHint: { operatorId: null, restaurantId: null },
      to: { email: 'a@b.co' }, from: { email: 'f@b.co' }, subject: 's', html: 'h',
    })
    const second = await noopEmailAdapter.send({
      idempotencyKey: 'same', tenantHint: { operatorId: null, restaurantId: null },
      to: { email: 'a@b.co' }, from: { email: 'f@b.co' }, subject: 's', html: 'h',
    })
    expect(first.providerMessageId).toBe(second.providerMessageId)
  })
})

describe('noop sms adapter', () => {
  it('skips without network', async () => {
    const r = await noopSmsAdapter.send({
      idempotencyKey: 'sms-1', tenantHint: { operatorId: null, restaurantId: null },
      to: { phoneE164: '+33600000000' }, from: { phoneE164: '+33611111111' }, text: 't',
    })
    expect(r.status).toBe('skipped')
    expect(r.providerMessageId).toBe('noop:sms-1')
  })
})

describe('noop whatsapp adapter', () => {
  it('skips without network', async () => {
    const r = await noopWhatsAppAdapter.send({
      idempotencyKey: 'wa-1', tenantHint: { operatorId: null, restaurantId: null },
      to: { phoneE164: '+33600000000' }, from: { businessPhoneId: 'bpid' },
      templateKey: 'tpl', variables: { name: 'x' }, languageCode: 'fr',
    })
    expect(r.status).toBe('skipped')
    expect(r.reason).toBe('noop:whatsapp')
  })
})

describe('noop social adapter', () => {
  it('skips publish and records platforms in reason', async () => {
    const r = await noopSocialAdapter.publish({
      idempotencyKey: 'post-1', tenantHint: { operatorId: null, restaurantId: null },
      platforms: ['instagram', 'tiktok'], caption: 'c', mediaUrls: [], scheduledFor: null,
    })
    expect(r.status).toBe('skipped')
    expect(r.reason).toContain('instagram')
    expect(r.reason).toContain('tiktok')
  })

  it('metrics returns null (no provider state)', async () => {
    expect(await noopSocialAdapter.metrics('any')).toBeNull()
  })
})

describe('noop enrichment adapter', () => {
  it('returns found=false and no body', async () => {
    const r = await noopEnrichmentAdapter.lookup({ siren: '123456789' })
    expect(r.found).toBe(false)
  })
})

describe('noop orchestrator adapter', () => {
  it('fire returns accepted with a derived runId', async () => {
    const r = await noopOrchestratorAdapter.fire({ workflowKey: 'wk', payload: {}, idempotencyKey: 'orch-1' })
    expect(r.status).toBe('accepted')
    expect(r.runId).toBe('noop:orch-1')
  })

  it('cancel always succeeds', async () => {
    const r = await noopOrchestratorAdapter.cancel('any')
    expect(r.cancelled).toBe(true)
  })
})
