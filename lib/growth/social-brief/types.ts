// Shared types for the Grubano social brief contract.
//
// Pure data types only — never import Prisma, next/*, node:fs, node:net or any
// Postiz/n8n/Social Engine client. This module stays strictly local and
// dry-run so the Synkia-side moving pieces (issue #4, multi-brand auth,
// Postiz OAuth) are free to change without rippling into Grubano.

export const BRAND_GRUBANO = 'grubano' as const;
export type BrandGrubano = typeof BRAND_GRUBANO;

export const PILLARS = [
  'restaurant_partenaire',
  'plat_du_jour',
  'decouverte_culinaire',
  'conseils',
  'service_livraison',
  'fidelisation',
] as const;
export type Pillar = (typeof PILLARS)[number];

export const PLATFORMS = [
  'instagram',
  'linkedin',
  'tiktok',
  'facebook',
  'youtube_shorts',
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const FORMATS = ['post', 'carousel', 'short_video'] as const;
export type SocialFormat = (typeof FORMATS)[number];

// Public, verifiable fact kinds. No consumer/order/CRM derived facts allowed.
export const FACT_KINDS = [
  'press_release',
  'public_website',
  'restaurant_contract',
  'legal_filing',
  'own_announcement',
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export interface FactRef {
  readonly kind: FactKind;
  readonly sourceRef: string; // opaque — URL, press release id, contract id
  readonly verifiedAt: string; // ISO-8601 UTC
  readonly claim: string; // short public claim derived from the source
}

export interface AssetRef {
  readonly assetId: string; // opaque reference to a Grubano-owned media record
  readonly rightsVerifiedAt: string; // ISO-8601 UTC
  readonly rightsExpiresAt: string; // ISO-8601 UTC
}

export interface LegalChecks {
  readonly editorialApproved: boolean;
  readonly mediaRightsApproved: boolean;
  readonly restaurantApproved: boolean;
  readonly humanReviewed: boolean;
}

export interface SocialBriefInput {
  readonly brand: unknown;
  readonly sourceEventId: unknown;
  readonly pillar: unknown;
  readonly topic: unknown;
  readonly facts: unknown;
  readonly restaurantId?: unknown;
  readonly targetUrl: unknown;
  readonly assetRefs?: unknown;
  readonly formats: unknown;
  readonly platforms: unknown;
  readonly legalChecks: unknown;
}

export type ReasonCode =
  | 'FEATURE_DISABLED'
  | 'INPUT_NOT_OBJECT'
  | 'INPUT_TOO_LARGE'
  | 'UNKNOWN_FIELD'
  | 'DEPTH_EXCEEDED'
  | 'STRING_TOO_LONG'
  | 'ARRAY_TOO_LONG'
  | 'BRAND_MISMATCH'
  | 'SOURCE_EVENT_ID_INVALID'
  | 'TOPIC_INVALID'
  | 'UNSUPPORTED_PILLAR'
  | 'UNSUPPORTED_PLATFORM'
  | 'UNSUPPORTED_FORMAT'
  | 'INVALID_TARGET_URL'
  | 'URL_NOT_ALLOWLISTED'
  | 'URL_HAS_QUERY'
  | 'URL_HAS_FRAGMENT'
  | 'URL_HAS_CREDENTIALS'
  | 'URL_HAS_PORT'
  | 'URL_UNICODE_HOSTNAME'
  | 'URL_NOT_HTTPS'
  | 'PII_DETECTED_EMAIL'
  | 'PII_DETECTED_PHONE'
  | 'PII_DETECTED_KEY'
  | 'FACTS_MISSING'
  | 'FACT_KIND_FORBIDDEN'
  | 'SOURCE_REF_MISSING'
  | 'VERIFIED_AT_INVALID'
  | 'VERIFIED_AT_FUTURE'
  | 'VERIFIED_AT_STALE'
  | 'MEDIA_RIGHTS_INVALID'
  | 'MEDIA_RIGHTS_EXPIRED'
  | 'ASSET_REF_INVALID'
  | 'MISSING_LEGAL_CHECK'
  | 'RESTAURANT_ID_INVALID';

export interface BriefReason {
  readonly code: ReasonCode;
  readonly path: string; // dotted path into the input, e.g. "facts.0.verifiedAt"
  readonly detail?: string;
}

export type BriefStatus = 'DRAFT' | 'REVIEW' | 'BLOCKED';

export interface ValidatedBrief {
  readonly brand: BrandGrubano;
  readonly sourceEventId: string;
  readonly pillar: Pillar;
  readonly topic: string;
  readonly facts: readonly FactRef[];
  readonly restaurantId: string | null;
  readonly targetUrl: string;
  readonly assetRefs: readonly AssetRef[];
  readonly formats: readonly SocialFormat[];
  readonly platforms: readonly Platform[];
  readonly legalChecks: LegalChecks;
}

export interface SocialBriefDraft {
  readonly status: BriefStatus;
  readonly dispatchAllowed: false; // invariant — this module never dispatches
  readonly featureEnabled: boolean;
  readonly brand: BrandGrubano;
  readonly reasons: readonly BriefReason[];
  readonly brief: ValidatedBrief | null;
  readonly idempotencyKeys: readonly string[]; // one per (platform, format) pair
}

export interface SocialBriefConfig {
  // Default FALSE — the shared engine endpoints are not yet multi-brand safe
  // (see Synkia issue #4). Even when enabled, no dispatch happens here.
  readonly featureEnabled?: boolean;
  // Server-provided clock so the validator is testable and does not touch Date.now at import time.
  readonly now?: () => Date;
  // Max staleness of verifiedAt / rightsVerifiedAt in days.
  readonly maxFactAgeDays?: number;
}
