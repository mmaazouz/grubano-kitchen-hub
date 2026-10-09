// ── Growth / business-engine — no-op adapter implementations ──────────────────────────
//
// PURE. No I/O, no `fetch`, no SDK import. Used by unit tests, by local dev when the real
// provider is OFF, and as the default export of each adapter module until the real one is
// implemented. Produces deterministic shapes so dashboards remain honest ("skipped: noop")
// instead of silently absent.
//
// The no-op NEVER sends. The no-op NEVER throws. The no-op always returns `status:
// 'skipped'` with a stable, deterministic `providerMessageId` derived from the
// idempotencyKey (so replay still looks idempotent in logs).

import type {
  Deliverable,
  EmailAdapter, EmailMessage,
  SmsAdapter,   SmsMessage,
  WhatsAppAdapter, WhatsAppMessage,
  SocialAdapter,   SocialPost,
  EnrichmentAdapter, EnrichmentLookup, EnrichmentResult,
  OrchestratorAdapter, OrchestratorFireInput, OrchestratorFireResult,
} from './types'

function skipped(idempotencyKey: string, note = 'noop'): Deliverable {
  return {
    status:            'skipped',
    providerMessageId: `noop:${idempotencyKey}`,
    reason:            note,
    retryAfterMs:      0,
  }
}

export const noopEmailAdapter: EmailAdapter = {
  channel: 'email',
  async send(message: EmailMessage): Promise<Deliverable> {
    return skipped(message.idempotencyKey, 'noop:email')
  },
}

export const noopSmsAdapter: SmsAdapter = {
  channel: 'sms',
  async send(message: SmsMessage): Promise<Deliverable> {
    return skipped(message.idempotencyKey, 'noop:sms')
  },
}

export const noopWhatsAppAdapter: WhatsAppAdapter = {
  channel: 'whatsapp',
  async send(message: WhatsAppMessage): Promise<Deliverable> {
    return skipped(message.idempotencyKey, 'noop:whatsapp')
  },
}

export const noopSocialAdapter: SocialAdapter = {
  channel: 'social',
  async publish(post: SocialPost): Promise<Deliverable> {
    return skipped(post.idempotencyKey, `noop:social:${post.platforms.join('+')}`)
  },
  async metrics(_providerMessageId: string) {
    return null
  },
}

export const noopEnrichmentAdapter: EnrichmentAdapter = {
  async lookup(_input: EnrichmentLookup): Promise<EnrichmentResult> {
    return { found: false }
  },
}

export const noopOrchestratorAdapter: OrchestratorAdapter = {
  async fire(input: OrchestratorFireInput): Promise<OrchestratorFireResult> {
    return { status: 'accepted', runId: `noop:${input.idempotencyKey}`, reason: 'noop' }
  },
  async cancel(_runId: string) {
    return { cancelled: true, reason: 'noop' }
  },
}
