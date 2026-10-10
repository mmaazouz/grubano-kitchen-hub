// Adversarial inputs: URL allowlist, PII smuggling, feature flag, dispatch
// invariant. If any of these turn green with the hardening deleted, the test
// is checking the wrong property.

import { describe, expect, it } from 'vitest';

import { buildSocialBrief } from '@/lib/growth/social-brief/build';
import { validateInput } from '@/lib/growth/social-brief/validate';
import type { BriefReason, ReasonCode } from '@/lib/growth/social-brief/types';

const NOW = new Date('2026-10-10T12:00:00Z');

function cleanInput(): Record<string, unknown> {
  return {
    brand: 'grubano',
    sourceEventId: 'evt_abc',
    pillar: 'plat_du_jour',
    topic: 'Nouveau gnocchi',
    facts: [
      {
        kind: 'own_announcement',
        sourceRef: 'press/x',
        verifiedAt: '2026-10-01T10:00:00Z',
        claim: 'Lancement officiel.',
      },
    ],
    targetUrl: 'https://grubano.com/eat',
    assetRefs: [],
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

describe('URL allowlist — hostile inputs', () => {
  const hostile: ReadonlyArray<readonly [string, string, ReasonCode | 'ANY']> = [
    ['plain http', 'http://grubano.com/eat', 'URL_NOT_HTTPS'],
    [
      'userinfo smuggling',
      'https://attacker.com@grubano.com/eat',
      'URL_HAS_CREDENTIALS',
    ],
    ['non-standard port', 'https://grubano.com:4443/eat', 'URL_HAS_PORT'],
    ['query parameter', 'https://grubano.com/eat?utm_source=x', 'URL_HAS_QUERY'],
    ['fragment', 'https://grubano.com/eat#section', 'URL_HAS_FRAGMENT'],
    ['IDN homograph (fake grubáno)', 'https://xn--grubno-9ya.com/eat', 'URL_UNICODE_HOSTNAME'],
    [
      'subdomain not in allowlist',
      'https://app.grubano.com/eat',
      'URL_NOT_ALLOWLISTED',
    ],
    [
      'path traversal',
      'https://grubano.com/eat/../etc/passwd',
      'URL_NOT_ALLOWLISTED',
    ],
    [
      'open redirect lookalike',
      'https://grubano.com.evil.com/eat',
      'URL_NOT_ALLOWLISTED',
    ],
    ['data URI', 'data:text/html,<h1>x</h1>', 'ANY'],
    ['javascript URI', 'javascript:alert(1)', 'ANY'],
    ['empty', '', 'INVALID_TARGET_URL'],
    ['not a URL at all', '/eat', 'INVALID_TARGET_URL'],
    ['path with CRLF injection', 'https://grubano.com/eat%0d%0a', 'URL_NOT_ALLOWLISTED'],
    [
      'legal route not in allowlist',
      'https://grubano.com/legal/retention',
      'URL_NOT_ALLOWLISTED',
    ],
  ];

  for (const [label, url, expected] of hostile) {
    it(`rejects: ${label}`, () => {
      const r = validateInput({ ...cleanInput(), targetUrl: url }, { now: NOW });
      expect(r.brief).toBeNull();
      if (expected !== 'ANY') {
        expect(codes(r.reasons)).toContain(expected);
      }
    });
  }

  const allowed = [
    'https://grubano.com',
    'https://grubano.com/',
    'https://grubano.com/eat',
    'https://grubano.com/legal/cgv',
    'https://grubano.com/legal/confidentialite',
    'https://grubano.com/legal/cookies',
    'https://grubano.com/legal/mentions-legales',
  ];
  for (const url of allowed) {
    it(`accepts allowlisted URL: ${url}`, () => {
      const r = validateInput({ ...cleanInput(), targetUrl: url }, { now: NOW });
      expect(r.brief).not.toBeNull();
    });
  }
});

describe('PII smuggling — strings', () => {
  it('rejects an email hidden in topic', () => {
    const r = validateInput(
      { ...cleanInput(), topic: 'Contact chef at chef@grubano.com for details' },
      { now: NOW },
    );
    expect(r.brief).toBeNull();
    expect(codes(r.reasons)).toContain('PII_DETECTED_EMAIL');
  });

  it('rejects a phone number hidden in a fact claim', () => {
    const payload = cleanInput();
    (payload.facts as Array<Record<string, unknown>>)[0].claim =
      'Call 06 12 34 56 78 to reserve a tasting';
    const r = validateInput(payload, { now: NOW });
    expect(r.brief).toBeNull();
    expect(codes(r.reasons)).toContain('PII_DETECTED_PHONE');
  });

  it('rejects an international phone number', () => {
    const payload = cleanInput();
    (payload.facts as Array<Record<string, unknown>>)[0].claim =
      'Reserve at +33 (0)1 23 45 67 89 today';
    const r = validateInput(payload, { now: NOW });
    expect(r.brief).toBeNull();
    expect(codes(r.reasons)).toContain('PII_DETECTED_PHONE');
  });
});

describe('PII smuggling — keys', () => {
  const forbiddenKeys = [
    'customerEmail',
    'userId',
    'orderId',
    'shippingAddress',
    'authToken',
    'sessionCookie',
    'postalCode',
  ];
  for (const k of forbiddenKeys) {
    it(`rejects forbidden key: ${k}`, () => {
      const payload = { ...cleanInput(), [k]: 'anything' };
      const r = validateInput(payload, { now: NOW });
      expect(r.brief).toBeNull();
      const got = codes(r.reasons);
      // Either PII_DETECTED_KEY or UNKNOWN_FIELD — both are fail-closed.
      expect(got.some((c) => c === 'PII_DETECTED_KEY' || c === 'UNKNOWN_FIELD')).toBe(true);
    });
  }
});

describe('feature flag — OFF by default', () => {
  it('is BLOCKED with no config at all', () => {
    const d = buildSocialBrief(cleanInput());
    expect(d.status).toBe('BLOCKED');
    expect(d.featureEnabled).toBe(false);
    expect(d.brief).toBeNull();
    expect(d.idempotencyKeys).toEqual([]);
    expect(codes(d.reasons)).toContain('FEATURE_DISABLED');
  });

  it('is BLOCKED when explicitly disabled', () => {
    const d = buildSocialBrief(cleanInput(), { featureEnabled: false });
    expect(d.status).toBe('BLOCKED');
    expect(d.featureEnabled).toBe(false);
    expect(d.brief).toBeNull();
  });

  it('skips validation entirely when OFF (so a garbage payload still returns BLOCKED with FEATURE_DISABLED)', () => {
    const d = buildSocialBrief({ brand: 'synkia', nonsense: true });
    // Must not expose structural shape information when the feature is off.
    expect(d.featureEnabled).toBe(false);
    expect(codes(d.reasons)).toEqual(['FEATURE_DISABLED']);
  });
});

describe('dispatch invariant', () => {
  it('never allows dispatch, even on a clean brief', () => {
    const d = buildSocialBrief(cleanInput(), {
      featureEnabled: true,
      now: () => NOW,
    });
    expect(d.status).toBe('REVIEW');
    // Compile-time guarantee: dispatchAllowed is the literal `false`.
    expect(d.dispatchAllowed).toBe(false);
  });
});

describe('ReasonCode is actionable', () => {
  it('every reason carries a dotted path', () => {
    const r = validateInput(
      {
        ...cleanInput(),
        legalChecks: {
          editorialApproved: true,
          mediaRightsApproved: false,
          restaurantApproved: true,
          humanReviewed: true,
        },
      },
      { now: NOW },
    );
    expect(r.brief).toBeNull();
    for (const reason of r.reasons) {
      expect(typeof reason.path).toBe('string');
    }
    const missing = r.reasons.find((rr) => rr.code === 'MISSING_LEGAL_CHECK');
    expect(missing?.path).toBe('legalChecks.mediaRightsApproved');
  });
});
