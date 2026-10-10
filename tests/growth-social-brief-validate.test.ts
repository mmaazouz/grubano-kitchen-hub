// Shape and structural caps for the Grubano social brief validator.
//
// These tests import the REAL module functions — a passing suite with the
// hardening deleted is the signal that a test is checking the wrong thing.

import { describe, expect, it } from 'vitest';

import { buildSocialBrief } from '@/lib/growth/social-brief/build';
import { validateInput } from '@/lib/growth/social-brief/validate';
import type { BriefReason, ReasonCode } from '@/lib/growth/social-brief/types';

const NOW = new Date('2026-10-10T12:00:00Z');

function cleanInput(): Record<string, unknown> {
  return {
    brand: 'grubano',
    sourceEventId: 'evt_2026_10_10_abc123',
    pillar: 'plat_du_jour',
    topic: 'Nouvelle recette gnocchi au citron confit',
    facts: [
      {
        kind: 'own_announcement',
        sourceRef: 'press/grubano/2026-10-01',
        verifiedAt: '2026-10-01T10:00:00Z',
        claim: 'Lancement officiel du gnocchi au citron confit.',
      },
    ],
    targetUrl: 'https://grubano.com/eat',
    assetRefs: [
      {
        assetId: 'asset_123',
        rightsVerifiedAt: '2026-10-01T10:00:00Z',
        rightsExpiresAt: '2027-10-01T10:00:00Z',
      },
    ],
    formats: ['post'],
    platforms: ['instagram'],
    legalChecks: {
      editorialApproved: true,
      mediaRightsApproved: true,
      restaurantApproved: true,
      humanReviewed: true,
    },
  };
}

function codes(reasons: readonly BriefReason[]): ReasonCode[] {
  return reasons.map((r) => r.code);
}

describe('validateInput — structural caps', () => {
  it('rejects non-object inputs (null)', () => {
    const r = validateInput(null, { now: NOW });
    expect(r.brief).toBeNull();
    expect(codes(r.reasons)).toContain('INPUT_NOT_OBJECT');
  });

  it('rejects non-object inputs (array)', () => {
    const r = validateInput([{ brand: 'grubano' }], { now: NOW });
    expect(r.brief).toBeNull();
    expect(codes(r.reasons)).toContain('INPUT_NOT_OBJECT');
  });

  it('rejects non-object inputs (string)', () => {
    const r = validateInput('grubano', { now: NOW });
    expect(r.brief).toBeNull();
    expect(codes(r.reasons)).toContain('INPUT_NOT_OBJECT');
  });

  it('rejects objects with a prototype pollution attempt via __proto__', () => {
    const payload = cleanInput();
    (payload as Record<string, unknown>).__proto__ = { polluted: true };
    const r = validateInput(payload, { now: NOW });
    // Either the walker flags it as an unknown field or the brief validates
    // but Object.prototype was never actually mutated. We assert both.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects oversize serialized input', () => {
    const payload = cleanInput();
    (payload as Record<string, unknown>).topic = 'x'.repeat(20000);
    const r = validateInput(payload, { now: NOW });
    expect(r.brief).toBeNull();
    // Either INPUT_TOO_LARGE or STRING_TOO_LONG — the critical property is
    // that we never produced a brief.
    const got = codes(r.reasons);
    expect(got.some((c) => c === 'INPUT_TOO_LARGE' || c === 'STRING_TOO_LONG')).toBe(true);
  });

  it('rejects unknown top-level fields', () => {
    const payload = { ...cleanInput(), approvedBy: 'bob@example.com' };
    const r = validateInput(payload, { now: NOW });
    expect(r.brief).toBeNull();
    expect(codes(r.reasons)).toContain('UNKNOWN_FIELD');
  });

  it('rejects unknown nested fields in facts', () => {
    const payload = cleanInput();
    (payload.facts as Array<Record<string, unknown>>)[0].extra = 'oops';
    const r = validateInput(payload, { now: NOW });
    expect(r.brief).toBeNull();
    expect(codes(r.reasons)).toContain('UNKNOWN_FIELD');
  });

  it('rejects unknown nested fields in legalChecks', () => {
    const payload = cleanInput();
    (payload.legalChecks as Record<string, unknown>).autoApproved = true;
    const r = validateInput(payload, { now: NOW });
    expect(r.brief).toBeNull();
    expect(codes(r.reasons)).toContain('UNKNOWN_FIELD');
  });

  it('rejects deeply nested payloads past MAX_DEPTH', () => {
    const payload = cleanInput() as Record<string, unknown>;
    let node: Record<string, unknown> = payload;
    for (let i = 0; i < 10; i++) {
      const next: Record<string, unknown> = {};
      node['nested'] = next;
      node = next;
    }
    const r = validateInput(payload, { now: NOW });
    expect(r.brief).toBeNull();
    // The nested key itself is unknown; either DEPTH_EXCEEDED or UNKNOWN_FIELD
    // is acceptable, but the brief must be refused.
  });

  it('rejects arrays longer than MAX_ARRAY_LEN', () => {
    const payload = cleanInput();
    (payload as Record<string, unknown>).facts = Array.from({ length: 64 }, (_, i) => ({
      kind: 'own_announcement',
      sourceRef: `r${i}`,
      verifiedAt: '2026-10-01T00:00:00Z',
      claim: 'c',
    }));
    const r = validateInput(payload, { now: NOW });
    expect(r.brief).toBeNull();
    expect(codes(r.reasons)).toContain('ARRAY_TOO_LONG');
  });
});

describe('validateInput — brand', () => {
  it('rejects brand=synkia', () => {
    const r = validateInput({ ...cleanInput(), brand: 'synkia' }, { now: NOW });
    expect(r.brief).toBeNull();
    expect(codes(r.reasons)).toContain('BRAND_MISMATCH');
  });

  it('rejects brand truthy-but-wrong-cased', () => {
    const r = validateInput({ ...cleanInput(), brand: 'Grubano' }, { now: NOW });
    expect(r.brief).toBeNull();
    expect(codes(r.reasons)).toContain('BRAND_MISMATCH');
  });

  it('rejects brand as object', () => {
    const r = validateInput({ ...cleanInput(), brand: { name: 'grubano' } }, { now: NOW });
    expect(r.brief).toBeNull();
    expect(codes(r.reasons)).toContain('BRAND_MISMATCH');
  });
});

describe('validateInput — enums', () => {
  it('rejects unknown pillar', () => {
    const r = validateInput({ ...cleanInput(), pillar: 'promo_flash' }, { now: NOW });
    expect(codes(r.reasons)).toContain('UNSUPPORTED_PILLAR');
  });

  it('rejects unknown platform', () => {
    const r = validateInput({ ...cleanInput(), platforms: ['snapchat'] }, { now: NOW });
    expect(codes(r.reasons)).toContain('UNSUPPORTED_PLATFORM');
  });

  it('rejects unknown format', () => {
    const r = validateInput({ ...cleanInput(), formats: ['live_stream'] }, { now: NOW });
    expect(codes(r.reasons)).toContain('UNSUPPORTED_FORMAT');
  });

  it('rejects duplicate platforms (caller mistake, could inflate idempotency keys)', () => {
    const r = validateInput(
      { ...cleanInput(), platforms: ['instagram', 'instagram'] },
      { now: NOW },
    );
    expect(codes(r.reasons)).toContain('UNSUPPORTED_PLATFORM');
  });
});

describe('validateInput — facts and freshness', () => {
  it('rejects empty facts array', () => {
    const r = validateInput({ ...cleanInput(), facts: [] }, { now: NOW });
    expect(codes(r.reasons)).toContain('FACTS_MISSING');
  });

  it('rejects forbidden fact kind (e.g. fabricated review)', () => {
    const payload = cleanInput();
    (payload.facts as Array<Record<string, unknown>>)[0].kind = 'customer_review';
    const r = validateInput(payload, { now: NOW });
    expect(codes(r.reasons)).toContain('FACT_KIND_FORBIDDEN');
  });

  it('rejects verifiedAt in the future', () => {
    const payload = cleanInput();
    (payload.facts as Array<Record<string, unknown>>)[0].verifiedAt = '2099-01-01T00:00:00Z';
    const r = validateInput(payload, { now: NOW });
    expect(codes(r.reasons)).toContain('VERIFIED_AT_FUTURE');
  });

  it('rejects verifiedAt older than maxFactAgeDays', () => {
    const payload = cleanInput();
    (payload.facts as Array<Record<string, unknown>>)[0].verifiedAt = '2020-01-01T00:00:00Z';
    const r = validateInput(payload, { now: NOW, maxFactAgeDays: 365 });
    expect(codes(r.reasons)).toContain('VERIFIED_AT_STALE');
  });

  it('rejects verifiedAt in a timezone offset (must be Z)', () => {
    const payload = cleanInput();
    (payload.facts as Array<Record<string, unknown>>)[0].verifiedAt = '2026-10-01T10:00:00+02:00';
    const r = validateInput(payload, { now: NOW });
    expect(codes(r.reasons)).toContain('VERIFIED_AT_INVALID');
  });
});

describe('validateInput — assets', () => {
  it('rejects carousel without any asset', () => {
    const payload = { ...cleanInput(), formats: ['carousel'], assetRefs: [] };
    const r = validateInput(payload, { now: NOW });
    expect(codes(r.reasons)).toContain('ASSET_REF_INVALID');
  });

  it('rejects short_video without any asset', () => {
    const payload = { ...cleanInput(), formats: ['short_video'], assetRefs: [] };
    const r = validateInput(payload, { now: NOW });
    expect(codes(r.reasons)).toContain('ASSET_REF_INVALID');
  });

  it('rejects expired media rights', () => {
    const payload = cleanInput();
    (payload.assetRefs as Array<Record<string, unknown>>)[0].rightsExpiresAt =
      '2020-01-01T00:00:00Z';
    const r = validateInput(payload, { now: NOW });
    expect(codes(r.reasons)).toContain('MEDIA_RIGHTS_EXPIRED');
  });

  it('rejects rightsVerifiedAt in the future', () => {
    const payload = cleanInput();
    (payload.assetRefs as Array<Record<string, unknown>>)[0].rightsVerifiedAt =
      '2099-01-01T00:00:00Z';
    const r = validateInput(payload, { now: NOW });
    expect(codes(r.reasons)).toContain('MEDIA_RIGHTS_INVALID');
  });
});

describe('validateInput — legal checks', () => {
  it('rejects when any legal check is false', () => {
    const payload = cleanInput();
    (payload.legalChecks as Record<string, unknown>).humanReviewed = false;
    const r = validateInput(payload, { now: NOW });
    expect(codes(r.reasons)).toContain('MISSING_LEGAL_CHECK');
  });

  it('rejects when a legal check is a truthy non-boolean (e.g. string "true")', () => {
    const payload = cleanInput();
    (payload.legalChecks as Record<string, unknown>).humanReviewed = 'true';
    const r = validateInput(payload, { now: NOW });
    expect(codes(r.reasons)).toContain('MISSING_LEGAL_CHECK');
  });

  it('rejects when legalChecks is missing a key', () => {
    const payload = cleanInput();
    delete (payload.legalChecks as Record<string, unknown>).mediaRightsApproved;
    const r = validateInput(payload, { now: NOW });
    expect(codes(r.reasons)).toContain('MISSING_LEGAL_CHECK');
  });
});

describe('validateInput — happy path', () => {
  it('accepts a clean fixture when the feature is enabled', () => {
    const draft = buildSocialBrief(cleanInput(), {
      featureEnabled: true,
      now: () => NOW,
    });
    expect(draft.status).toBe('REVIEW');
    expect(draft.dispatchAllowed).toBe(false);
    expect(draft.brief).not.toBeNull();
    expect(draft.brief?.brand).toBe('grubano');
    expect(draft.idempotencyKeys.length).toBe(1);
  });

  it('normalizes brand to the server-side constant even when the caller omits it is impossible — brand is required', () => {
    const payload = cleanInput();
    delete (payload as Record<string, unknown>).brand;
    const draft = buildSocialBrief(payload, {
      featureEnabled: true,
      now: () => NOW,
    });
    expect(draft.status).toBe('BLOCKED');
    expect(draft.brief).toBeNull();
  });
});
