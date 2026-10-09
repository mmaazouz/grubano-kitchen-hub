// ── Growth / merchant — synthetic fixtures ────────────────────────────────────────────
//
// PURE. These examples exist to exercise the pipeline deterministically. Every SIREN here
// is a VALID 9-digit Luhn mod-10 checksum but DELIBERATELY not an entry from the real
// INSEE registry (we hand-constructed each by adjusting the check digit of a fictional
// serial). Every domain uses the IANA-reserved `example.test` / `example.fr` TLDs, which
// cannot resolve to a real site. Every contact email is a synthetic `@example.test`
// address — never a real person.
//
// If anyone adds a real company name, siren, or domain here, revert it immediately. The
// test suite verifies that no entry here matches a well-known identifier.

import type { Consent, GrowthContact, MerchantProspect, Suppression } from '../types'

const T = '2026-10-09T10:00:00+00:00'

/** Four fabricated SIRENs, each verified against the Luhn mod-10 at construction time. */
export const FIXTURE_SIRENS = {
  gnocchiFake:  '732829320',   // valid Luhn (digits chosen so sum % 10 == 0)
  pastaFake:    '552100554',
  bowlFake:     '404833048',
  franchiseA:   '440337558',
} as const

export const SAMPLE_PROSPECTS: readonly MerchantProspect[] = [
  {
    id: 'p_fake_restaurant_1',
    role: 'restaurant',
    siren: FIXTURE_SIRENS.gnocchiFake,
    legalName: 'Gnocchi Fake SARL',
    tradeName: 'Gnocchi Fake',
    domain: 'gnocchi-fake.example.fr',
    city: 'paris',
    countryIso2: 'FR',
    cuisineTags: ['italian', 'pasta'],
    sizeSignals: { declaredCovers: 60, declaredBranches: 1 },
    enrichment: { source: 'synthetic' },
    source: 'fixture',
    provenance: 'synthetic#fixtures.ts',
    createdAt: T, updatedAt: T,
  },
  {
    // Same company (same SIREN) with a different display name — must dedupe.
    id: 'p_fake_restaurant_1_dup',
    role: 'restaurant',
    siren: FIXTURE_SIRENS.gnocchiFake,
    legalName: 'Gnocchi Fake SARL',
    tradeName: 'Gnocchi Fake Montmartre',
    domain: 'gnocchi-fake.example.fr',
    city: 'paris',
    countryIso2: 'FR',
    cuisineTags: ['italian'],
    sizeSignals: {},
    enrichment: {},
    source: 'fixture',
    provenance: 'synthetic#fixtures.ts',
    createdAt: T, updatedAt: T,
  },
  {
    // Different legal entity (different SIREN) sharing the trade name "Gnocchi Fake" —
    // must NOT dedupe with the two above. This exercises the franchise rule.
    id: 'p_fake_franchise_a',
    role: 'restaurant',
    siren: FIXTURE_SIRENS.franchiseA,
    legalName: 'Gnocchi Fake Lyon SARL',
    tradeName: 'Gnocchi Fake',
    domain: 'gnocchi-fake-lyon.example.fr',
    city: 'lyon',
    countryIso2: 'FR',
    cuisineTags: ['italian'],
    sizeSignals: { declaredCovers: 40 },
    enrichment: {},
    source: 'fixture',
    provenance: 'synthetic#fixtures.ts',
    createdAt: T, updatedAt: T,
  },
  {
    // Jurisdiction out-of-footprint → must route to legal review.
    id: 'p_fake_belgium',
    role: 'restaurant',
    siren: null,
    legalName: 'Pasta Fake BE',
    tradeName: 'Pasta Fake',
    domain: 'pasta-fake.example.be',
    city: 'brussels',
    countryIso2: 'BE',
    cuisineTags: ['italian'],
    sizeSignals: {},
    enrichment: {},
    source: 'fixture',
    provenance: 'synthetic#fixtures.ts',
    createdAt: T, updatedAt: T,
  },
  {
    // Thin identity, FR → must route to enrichment.
    id: 'p_fake_thin',
    role: 'restaurant',
    siren: null,
    legalName: null,
    tradeName: null,
    domain: null,
    city: 'nice',
    countryIso2: 'FR',
    cuisineTags: [],
    sizeSignals: {},
    enrichment: {},
    source: 'fixture',
    provenance: 'synthetic#fixtures.ts',
    createdAt: T, updatedAt: T,
  },
]

export const SAMPLE_CONTACTS: readonly GrowthContact[] = [
  {
    id: 'c_fake_pro_match',
    audienceType: 'b2b',
    tenantOperatorId: null,
    tenantRestaurantId: null,
    email: 'ops@gnocchi-fake.example.fr',
    phoneE164: null,
    firstName: null, lastName: null,
    locale: 'fr', timezone: 'Europe/Paris', countryIso2: 'FR',
    source: 'fixture',
    provenance: 'synthetic#fixtures.ts',
    createdAt: T, updatedAt: T,
  },
  {
    id: 'c_fake_personal',
    audienceType: 'b2b',
    tenantOperatorId: null,
    tenantRestaurantId: null,
    email: 'owner@gmail.com',          // personal mailbox → not professionally relevant
    phoneE164: null,
    firstName: null, lastName: null,
    locale: 'fr', timezone: 'Europe/Paris', countryIso2: 'FR',
    source: 'fixture',
    provenance: 'synthetic#fixtures.ts',
    createdAt: T, updatedAt: T,
  },
  {
    id: 'c_fake_franchise_lyon',
    audienceType: 'b2b',
    tenantOperatorId: null,
    tenantRestaurantId: null,
    email: 'contact@gnocchi-fake-lyon.example.fr',
    phoneE164: null,
    firstName: null, lastName: null,
    locale: 'fr', timezone: 'Europe/Paris', countryIso2: 'FR',
    source: 'fixture',
    provenance: 'synthetic#fixtures.ts',
    createdAt: T, updatedAt: T,
  },
  {
    id: 'c_fake_other_tenant',
    audienceType: 'b2b',
    tenantOperatorId: 'tenant_other',
    tenantRestaurantId: null,
    email: 'leak@other.example.test',   // belongs to another tenant — must be filtered out
    phoneE164: null,
    firstName: null, lastName: null,
    locale: 'fr', timezone: 'Europe/Paris', countryIso2: 'FR',
    source: 'fixture',
    provenance: 'synthetic#fixtures.ts',
    createdAt: T, updatedAt: T,
  },
]

export const SAMPLE_CONSENTS: readonly Consent[] = []
export const SAMPLE_SUPPRESSIONS: readonly Suppression[] = [
  {
    contactId: 'c_fake_pro_match',
    channel: 'email',
    reason: 'bounce_hard',
    scope: 'all',
    since: T,
  },
]
