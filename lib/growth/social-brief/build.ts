// Orchestrator that turns raw input into a reviewable DRAFT. Pure function —
// no I/O, no outbox write, no HTTP, no Prisma. The returned object is the
// contract that upstream callers (future server route, review UI) can serialize
// AS-IS. Dispatching to the shared Synkia Social Engine happens on a separate,
// server-authed path that this module intentionally does NOT reference.

import { deriveKeysForBrief } from './idempotency';
import {
  BRAND_GRUBANO,
  type BriefReason,
  type BrandGrubano,
  type SocialBriefConfig,
  type SocialBriefDraft,
  type SocialBriefInput,
} from './types';
import { validateInput } from './validate';

const DEFAULT_FEATURE_ENABLED = false;

export function buildSocialBrief(
  rawInput: unknown,
  config: SocialBriefConfig = {},
): SocialBriefDraft {
  // Fail-closed when the feature is OFF: don't even run validation, so a
  // caller can't accidentally produce an "export-ready" record just because
  // the shape happened to pass. This also keeps the OFF-state side-effect
  // surface tiny — the function returns a constant-shape BLOCKED draft.
  const featureEnabled = config.featureEnabled ?? DEFAULT_FEATURE_ENABLED;
  const brand: BrandGrubano = BRAND_GRUBANO;

  if (!featureEnabled) {
    const reasons: readonly BriefReason[] = [
      { code: 'FEATURE_DISABLED', path: '', detail: 'GRUBANO_SOCIAL_BRIEF_EXPORT_ENABLED' },
    ];
    return {
      status: 'BLOCKED',
      dispatchAllowed: false,
      featureEnabled: false,
      brand,
      reasons,
      brief: null,
      idempotencyKeys: [],
    };
  }

  const now = (config.now ?? (() => new Date()))();
  const { brief, reasons } = validateInput(rawInput, {
    now,
    maxFactAgeDays: config.maxFactAgeDays,
  });

  if (!brief) {
    return {
      status: 'BLOCKED',
      dispatchAllowed: false,
      featureEnabled: true,
      brand,
      reasons,
      brief: null,
      idempotencyKeys: [],
    };
  }

  const idempotencyKeys = deriveKeysForBrief({
    brand: brief.brand,
    sourceEventId: brief.sourceEventId,
    pillar: brief.pillar,
    platforms: brief.platforms,
    formats: brief.formats,
  });

  // Even on a clean validation we stay in REVIEW: no path in this module ever
  // ships a brief past human approval. The downstream server route is the only
  // thing allowed to transition REVIEW → DISPATCHED, and only against an
  // authenticated Synkia Social Engine contract that today does not exist.
  return {
    status: 'REVIEW',
    dispatchAllowed: false,
    featureEnabled: true,
    brand,
    reasons: [],
    brief,
    idempotencyKeys,
  };
}
