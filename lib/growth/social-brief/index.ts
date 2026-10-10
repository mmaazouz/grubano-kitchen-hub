// Public surface of the Grubano social brief contract.
//
// Keep this module strictly pure: no outbox, no cron, no Prisma schema, no
// HTTP client, no Postiz adapter. All of those live behind the server-authed
// path described in docs/ops/GROWTH-SOCIAL-BRIEF-INTEGRATION.md and must stay
// out of this file.

export { buildSocialBrief } from './build';
export { deriveIdempotencyKey, deriveKeysForBrief, IdempotencyInputError } from './idempotency';
export { validateInput } from './validate';
export {
  BRAND_GRUBANO,
  FACT_KINDS,
  FORMATS,
  PILLARS,
  PLATFORMS,
} from './types';
export type {
  AssetRef,
  BrandGrubano,
  BriefReason,
  BriefStatus,
  FactKind,
  FactRef,
  LegalChecks,
  Pillar,
  Platform,
  ReasonCode,
  SocialBriefConfig,
  SocialBriefDraft,
  SocialBriefInput,
  SocialFormat,
  ValidatedBrief,
} from './types';
