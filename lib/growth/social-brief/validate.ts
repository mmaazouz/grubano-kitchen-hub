// Structural validator for incoming Grubano social briefs.
//
// Pure, deterministic, no I/O. Fail-closed on any ambiguity: every rejected
// field surfaces a stable ReasonCode so the caller can either repair the input
// or block the brief. Human review is still required even when this returns
// zero reasons — the free-text PII scanner is defense-in-depth, not a proof of
// absence of PII.

import {
  BRAND_GRUBANO,
  FACT_KINDS,
  FORMATS,
  PILLARS,
  PLATFORMS,
  type AssetRef,
  type BriefReason,
  type FactKind,
  type FactRef,
  type LegalChecks,
  type Pillar,
  type Platform,
  type ReasonCode,
  type SocialBriefInput,
  type SocialFormat,
  type ValidatedBrief,
} from './types';

// ---------- Hard limits ----------

const MAX_INPUT_BYTES = 16 * 1024;
const MAX_STRING_LEN = 2000;
const MAX_ARRAY_LEN = 32;
const MAX_DEPTH = 5;
const MAX_TOPIC_LEN = 240;
const MAX_SOURCE_EVENT_ID_LEN = 128;
const MAX_OPAQUE_ID_LEN = 128;
const DEFAULT_MAX_FACT_AGE_DAYS = 365;

// ---------- Top-level allowlist ----------

const ALLOWED_INPUT_KEYS = new Set<string>([
  'brand',
  'sourceEventId',
  'pillar',
  'topic',
  'facts',
  'restaurantId',
  'targetUrl',
  'assetRefs',
  'formats',
  'platforms',
  'legalChecks',
]);

const ALLOWED_FACT_KEYS = new Set<string>(['kind', 'sourceRef', 'verifiedAt', 'claim']);
const ALLOWED_ASSET_KEYS = new Set<string>(['assetId', 'rightsVerifiedAt', 'rightsExpiresAt']);
const ALLOWED_LEGAL_KEYS = new Set<string>([
  'editorialApproved',
  'mediaRightsApproved',
  'restaurantApproved',
  'humanReviewed',
]);

// ---------- URL allowlist ----------
//
// Only public Grubano landing/legal routes that ACTUALLY exist in the
// consumer tree today (app/[locale]/eat and app/[locale]/legal/*). Any new
// landing page added for a campaign must be reviewed and added here
// deliberately — never widen with a regex.

const ALLOWED_TARGET_URLS: ReadonlySet<string> = new Set([
  'https://grubano.com',
  'https://grubano.com/',
  'https://grubano.com/eat',
  'https://grubano.com/eat/',
  'https://grubano.com/legal/cgv',
  'https://grubano.com/legal/confidentialite',
  'https://grubano.com/legal/cookies',
  'https://grubano.com/legal/mentions-legales',
]);

// ---------- PII patterns ----------

// Email: deliberately permissive — we want to CATCH anything plausibly email-ish.
const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}/i;

// Phone: either (a) 10+ consecutive digits with no separators (`0612345678`),
// or (b) a `+NN` / `00NN` country code followed by 7+ more digits, or (c) at
// least three groups of 2-3 digits separated by whitespace/dash/dot (French
// `06 12 34 56 78`). ISO-8601 timestamps have groups of 2 or 4 digits
// separated by `-` / `:` and only reach 2 adjacent groups before a `T` or `Z`
// breaks the chain, so they do NOT false-positive here.
const PHONE_RE =
  /(?:\d{10,}|(?:\+|00)\d{1,3}[\s.\-]?(?:\d{1,4}[\s.\-]?){2,}\d{2,}|(?:\d{2,3}[\s.\-]){3,}\d{2,3})/;

// Forbidden object keys (case-insensitive, substring match). Covers caller
// mistakes like `customerEmail`, `userId`, `shippingAddress`, `authToken`.
const FORBIDDEN_KEY_SUBSTRINGS: readonly string[] = [
  'email',
  'phone',
  'user',
  'customer',
  'order',
  'shipping',
  'address',
  'token',
  'secret',
  'password',
  'cookie',
  'session',
  'ssn',
  'iban',
  'card',
  'cvv',
  'postal',
  'zipcode',
];

// Keys declared legal in the brief shape even if they contain a forbidden
// substring (none today, but keep the hook explicit).
const PII_KEY_EXCEPTIONS: ReadonlySet<string> = new Set();

// ---------- Helpers ----------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function pushReason(
  reasons: BriefReason[],
  code: ReasonCode,
  path: string,
  detail?: string,
): void {
  reasons.push(detail !== undefined ? { code, path, detail } : { code, path });
}

function isIsoUtcString(s: string): boolean {
  // Accept 2026-10-10T12:34:56Z or 2026-10-10T12:34:56.789Z (always Z, never offset).
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(s)) return false;
  const t = Date.parse(s);
  return Number.isFinite(t);
}

function containsPiiText(s: string): ReasonCode | null {
  if (EMAIL_RE.test(s)) return 'PII_DETECTED_EMAIL';
  if (PHONE_RE.test(s)) return 'PII_DETECTED_PHONE';
  return null;
}

function keyHasPiiSubstring(key: string): boolean {
  if (PII_KEY_EXCEPTIONS.has(key)) return false;
  const lower = key.toLowerCase();
  for (const sub of FORBIDDEN_KEY_SUBSTRINGS) {
    if (lower.includes(sub)) return true;
  }
  return false;
}

// Recursive structural scan for PII keys and over-long strings. We DO NOT
// enforce the top-level shape here — this is a defense-in-depth pass that runs
// alongside the per-field validators.
function scanStructural(
  value: unknown,
  path: string,
  depth: number,
  reasons: BriefReason[],
): void {
  if (depth > MAX_DEPTH) {
    pushReason(reasons, 'DEPTH_EXCEEDED', path);
    return;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LEN) {
      pushReason(reasons, 'STRING_TOO_LONG', path, `len=${value.length}`);
    }
    const pii = containsPiiText(value);
    if (pii) pushReason(reasons, pii, path);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LEN) {
      pushReason(reasons, 'ARRAY_TOO_LONG', path, `len=${value.length}`);
    }
    for (let i = 0; i < value.length; i++) {
      scanStructural(value[i], `${path}.${i}`, depth + 1, reasons);
    }
    return;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (keyHasPiiSubstring(k)) {
        pushReason(reasons, 'PII_DETECTED_KEY', path === '' ? k : `${path}.${k}`, k);
      }
      scanStructural(v, path === '' ? k : `${path}.${k}`, depth + 1, reasons);
    }
  }
  // numbers / booleans / null → nothing to scan.
}

// ---------- Field validators ----------

function validateUrl(raw: unknown, reasons: BriefReason[]): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_STRING_LEN) {
    pushReason(reasons, 'INVALID_TARGET_URL', 'targetUrl');
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    pushReason(reasons, 'INVALID_TARGET_URL', 'targetUrl');
    return null;
  }
  if (parsed.protocol !== 'https:') {
    pushReason(reasons, 'URL_NOT_HTTPS', 'targetUrl');
    return null;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    pushReason(reasons, 'URL_HAS_CREDENTIALS', 'targetUrl');
    return null;
  }
  if (parsed.port !== '') {
    pushReason(reasons, 'URL_HAS_PORT', 'targetUrl');
    return null;
  }
  if (parsed.search !== '') {
    pushReason(reasons, 'URL_HAS_QUERY', 'targetUrl');
    return null;
  }
  if (parsed.hash !== '') {
    pushReason(reasons, 'URL_HAS_FRAGMENT', 'targetUrl');
    return null;
  }
  // The URL parser folds Unicode hostnames to punycode (xn--...). A caller
  // trying an IDN homograph attack would surface as xn--grubano-...; the
  // literal ASCII `grubano.com` is the only hostname we trust.
  const host = parsed.hostname;
  if (/[^a-z0-9.\-]/i.test(host) || host.startsWith('xn--') || host.includes('.xn--')) {
    pushReason(reasons, 'URL_UNICODE_HOSTNAME', 'targetUrl');
    return null;
  }
  if (host !== 'grubano.com') {
    pushReason(reasons, 'URL_NOT_ALLOWLISTED', 'targetUrl', host);
    return null;
  }
  // Normalize: compare without trailing slash drift against the explicit allowlist.
  if (!ALLOWED_TARGET_URLS.has(raw)) {
    pushReason(reasons, 'URL_NOT_ALLOWLISTED', 'targetUrl', raw);
    return null;
  }
  return raw;
}

function validateFact(
  raw: unknown,
  path: string,
  now: Date,
  maxAgeDays: number,
  reasons: BriefReason[],
): FactRef | null {
  if (!isPlainObject(raw)) {
    pushReason(reasons, 'FACTS_MISSING', path, 'not an object');
    return null;
  }
  // Nested unknown-key check.
  for (const k of Object.keys(raw)) {
    if (!ALLOWED_FACT_KEYS.has(k)) {
      pushReason(reasons, 'UNKNOWN_FIELD', `${path}.${k}`);
      return null;
    }
  }
  const kind = raw['kind'];
  const sourceRef = raw['sourceRef'];
  const verifiedAt = raw['verifiedAt'];
  const claim = raw['claim'];

  if (typeof kind !== 'string' || !(FACT_KINDS as readonly string[]).includes(kind)) {
    pushReason(reasons, 'FACT_KIND_FORBIDDEN', `${path}.kind`, String(kind));
    return null;
  }
  if (typeof sourceRef !== 'string' || sourceRef.length === 0 || sourceRef.length > MAX_STRING_LEN) {
    pushReason(reasons, 'SOURCE_REF_MISSING', `${path}.sourceRef`);
    return null;
  }
  if (typeof claim !== 'string' || claim.length === 0 || claim.length > MAX_STRING_LEN) {
    pushReason(reasons, 'SOURCE_REF_MISSING', `${path}.claim`);
    return null;
  }
  if (typeof verifiedAt !== 'string' || !isIsoUtcString(verifiedAt)) {
    pushReason(reasons, 'VERIFIED_AT_INVALID', `${path}.verifiedAt`);
    return null;
  }
  const t = Date.parse(verifiedAt);
  if (t > now.getTime()) {
    pushReason(reasons, 'VERIFIED_AT_FUTURE', `${path}.verifiedAt`);
    return null;
  }
  const ageMs = now.getTime() - t;
  if (ageMs > maxAgeDays * 24 * 60 * 60 * 1000) {
    pushReason(reasons, 'VERIFIED_AT_STALE', `${path}.verifiedAt`);
    return null;
  }
  return { kind: kind as FactKind, sourceRef, verifiedAt, claim };
}

function validateAsset(
  raw: unknown,
  path: string,
  now: Date,
  reasons: BriefReason[],
): AssetRef | null {
  if (!isPlainObject(raw)) {
    pushReason(reasons, 'ASSET_REF_INVALID', path, 'not an object');
    return null;
  }
  for (const k of Object.keys(raw)) {
    if (!ALLOWED_ASSET_KEYS.has(k)) {
      pushReason(reasons, 'UNKNOWN_FIELD', `${path}.${k}`);
      return null;
    }
  }
  const assetId = raw['assetId'];
  const rightsVerifiedAt = raw['rightsVerifiedAt'];
  const rightsExpiresAt = raw['rightsExpiresAt'];
  if (
    typeof assetId !== 'string' ||
    assetId.length === 0 ||
    assetId.length > MAX_OPAQUE_ID_LEN
  ) {
    pushReason(reasons, 'ASSET_REF_INVALID', `${path}.assetId`);
    return null;
  }
  if (typeof rightsVerifiedAt !== 'string' || !isIsoUtcString(rightsVerifiedAt)) {
    pushReason(reasons, 'MEDIA_RIGHTS_INVALID', `${path}.rightsVerifiedAt`);
    return null;
  }
  if (typeof rightsExpiresAt !== 'string' || !isIsoUtcString(rightsExpiresAt)) {
    pushReason(reasons, 'MEDIA_RIGHTS_INVALID', `${path}.rightsExpiresAt`);
    return null;
  }
  const verifiedT = Date.parse(rightsVerifiedAt);
  const expiresT = Date.parse(rightsExpiresAt);
  if (verifiedT > now.getTime()) {
    pushReason(reasons, 'MEDIA_RIGHTS_INVALID', `${path}.rightsVerifiedAt`, 'future');
    return null;
  }
  if (expiresT <= now.getTime()) {
    pushReason(reasons, 'MEDIA_RIGHTS_EXPIRED', `${path}.rightsExpiresAt`);
    return null;
  }
  if (expiresT <= verifiedT) {
    pushReason(reasons, 'MEDIA_RIGHTS_INVALID', `${path}.rightsExpiresAt`, 'before verified');
    return null;
  }
  return { assetId, rightsVerifiedAt, rightsExpiresAt };
}

function validateLegalChecks(raw: unknown, reasons: BriefReason[]): LegalChecks | null {
  if (!isPlainObject(raw)) {
    pushReason(reasons, 'MISSING_LEGAL_CHECK', 'legalChecks', 'not an object');
    return null;
  }
  for (const k of Object.keys(raw)) {
    if (!ALLOWED_LEGAL_KEYS.has(k)) {
      pushReason(reasons, 'UNKNOWN_FIELD', `legalChecks.${k}`);
      return null;
    }
  }
  const out: Partial<LegalChecks> = {};
  let ok = true;
  const legalKeys: readonly string[] = [
    'editorialApproved',
    'mediaRightsApproved',
    'restaurantApproved',
    'humanReviewed',
  ];
  for (const k of legalKeys) {
    const v = raw[k];
    if (typeof v !== 'boolean') {
      pushReason(reasons, 'MISSING_LEGAL_CHECK', `legalChecks.${k}`, 'not boolean');
      ok = false;
      continue;
    }
    if (v !== true) {
      pushReason(reasons, 'MISSING_LEGAL_CHECK', `legalChecks.${k}`);
      ok = false;
      continue;
    }
    (out as Record<string, boolean>)[k] = v;
  }
  return ok ? (out as LegalChecks) : null;
}

function validateStringEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  code: ReasonCode,
  path: string,
  reasons: BriefReason[],
): T | null {
  if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) {
    pushReason(reasons, code, path, String(raw));
    return null;
  }
  return raw as T;
}

function validateStringEnumArray<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  code: ReasonCode,
  path: string,
  reasons: BriefReason[],
): readonly T[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ARRAY_LEN) {
    pushReason(reasons, code, path, 'not a non-empty array');
    return null;
  }
  const seen = new Set<string>();
  const out: T[] = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
      pushReason(reasons, code, `${path}.${i}`, String(v));
      return null;
    }
    if (seen.has(v)) {
      pushReason(reasons, code, `${path}.${i}`, 'duplicate');
      return null;
    }
    seen.add(v);
    out.push(v as T);
  }
  return out;
}

// ---------- Public entry ----------

export interface ValidateOptions {
  readonly now: Date;
  readonly maxFactAgeDays?: number;
}

export interface ValidateResult {
  readonly brief: ValidatedBrief | null;
  readonly reasons: readonly BriefReason[];
}

export function validateInput(
  rawInput: unknown,
  opts: ValidateOptions,
): ValidateResult {
  const reasons: BriefReason[] = [];
  const maxFactAgeDays = opts.maxFactAgeDays ?? DEFAULT_MAX_FACT_AGE_DAYS;

  if (!isPlainObject(rawInput)) {
    pushReason(reasons, 'INPUT_NOT_OBJECT', '');
    return { brief: null, reasons };
  }

  // Size cap — JSON.stringify may fail on cycles; treat failures as oversized/malformed.
  let serialized: string;
  try {
    serialized = JSON.stringify(rawInput);
  } catch {
    pushReason(reasons, 'INPUT_NOT_OBJECT', '', 'not serializable');
    return { brief: null, reasons };
  }
  if (serialized === undefined) {
    pushReason(reasons, 'INPUT_NOT_OBJECT', '', 'not serializable');
    return { brief: null, reasons };
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_INPUT_BYTES) {
    pushReason(reasons, 'INPUT_TOO_LARGE', '', `${serialized.length}`);
    return { brief: null, reasons };
  }

  const input = rawInput as Record<string, unknown>;

  // Unknown top-level keys are a hard reject.
  for (const k of Object.keys(input)) {
    if (!ALLOWED_INPUT_KEYS.has(k)) {
      pushReason(reasons, 'UNKNOWN_FIELD', k);
    }
  }

  // Defense-in-depth PII / depth / length scan over the ENTIRE payload before
  // per-field checks — a payload with 10KB of nested arrays shouldn't slip
  // past because its brand field also happens to be invalid.
  scanStructural(input, '', 1, reasons);

  // Brand MUST be the literal constant. Server identity should also enforce
  // this upstream — the caller never gets to pick the brand.
  const brand = input['brand'];
  if (brand !== BRAND_GRUBANO) {
    pushReason(reasons, 'BRAND_MISMATCH', 'brand', String(brand));
  }

  // sourceEventId — opaque, non-empty, bounded.
  const sourceEventId = input['sourceEventId'];
  let validSourceEventId: string | null = null;
  if (
    typeof sourceEventId !== 'string' ||
    sourceEventId.length === 0 ||
    sourceEventId.length > MAX_SOURCE_EVENT_ID_LEN ||
    /[\x00-\x1f\x7f]/.test(sourceEventId)
  ) {
    pushReason(reasons, 'SOURCE_EVENT_ID_INVALID', 'sourceEventId');
  } else {
    validSourceEventId = sourceEventId;
  }

  // pillar.
  const pillar = validateStringEnum<Pillar>(
    input['pillar'],
    PILLARS,
    'UNSUPPORTED_PILLAR',
    'pillar',
    reasons,
  );

  // topic — plain string, length-capped, PII scan already handled by walker.
  const topic = input['topic'];
  let validTopic: string | null = null;
  if (typeof topic !== 'string' || topic.length === 0 || topic.length > MAX_TOPIC_LEN) {
    pushReason(reasons, 'TOPIC_INVALID', 'topic');
  } else {
    validTopic = topic;
  }

  // facts — non-empty array of FactRef.
  const factsRaw = input['facts'];
  let validFacts: FactRef[] | null = null;
  if (!Array.isArray(factsRaw) || factsRaw.length === 0 || factsRaw.length > MAX_ARRAY_LEN) {
    pushReason(reasons, 'FACTS_MISSING', 'facts', 'empty or non-array');
  } else {
    const acc: FactRef[] = [];
    let allOk = true;
    for (let i = 0; i < factsRaw.length; i++) {
      const fact = validateFact(
        factsRaw[i],
        `facts.${i}`,
        opts.now,
        maxFactAgeDays,
        reasons,
      );
      if (!fact) allOk = false;
      else acc.push(fact);
    }
    if (allOk) validFacts = acc;
  }

  // restaurantId — optional opaque string.
  const restaurantId = input['restaurantId'];
  let validRestaurantId: string | null = null;
  if (restaurantId !== undefined && restaurantId !== null) {
    if (
      typeof restaurantId !== 'string' ||
      restaurantId.length === 0 ||
      restaurantId.length > MAX_OPAQUE_ID_LEN ||
      /[\x00-\x1f\x7f]/.test(restaurantId)
    ) {
      pushReason(reasons, 'RESTAURANT_ID_INVALID', 'restaurantId');
    } else {
      validRestaurantId = restaurantId;
    }
  }

  // targetUrl.
  const validTargetUrl = validateUrl(input['targetUrl'], reasons);

  // assetRefs — optional; required when any format is 'carousel' or
  // 'short_video' (the orchestrator checks that pairing).
  const assetRefsRaw = input['assetRefs'];
  let validAssets: AssetRef[] | null = null;
  if (assetRefsRaw === undefined || assetRefsRaw === null) {
    validAssets = [];
  } else if (!Array.isArray(assetRefsRaw) || assetRefsRaw.length > MAX_ARRAY_LEN) {
    pushReason(reasons, 'ASSET_REF_INVALID', 'assetRefs', 'not an array');
  } else {
    const acc: AssetRef[] = [];
    let allOk = true;
    for (let i = 0; i < assetRefsRaw.length; i++) {
      const asset = validateAsset(assetRefsRaw[i], `assetRefs.${i}`, opts.now, reasons);
      if (!asset) allOk = false;
      else acc.push(asset);
    }
    if (allOk) validAssets = acc;
  }

  // formats.
  const formats = validateStringEnumArray<SocialFormat>(
    input['formats'],
    FORMATS,
    'UNSUPPORTED_FORMAT',
    'formats',
    reasons,
  );

  // platforms.
  const platforms = validateStringEnumArray<Platform>(
    input['platforms'],
    PLATFORMS,
    'UNSUPPORTED_PLATFORM',
    'platforms',
    reasons,
  );

  // Media required for carousel / short_video.
  if (formats && validAssets !== null) {
    const needsMedia = formats.some((f) => f === 'carousel' || f === 'short_video');
    if (needsMedia && validAssets.length === 0) {
      pushReason(
        reasons,
        'ASSET_REF_INVALID',
        'assetRefs',
        'carousel/short_video require at least one asset',
      );
    }
  }

  // legalChecks — all four flags must be true.
  const legal = validateLegalChecks(input['legalChecks'], reasons);

  if (reasons.length > 0) {
    return { brief: null, reasons };
  }

  // At this point every field is present AND valid. TypeScript doesn't narrow
  // across the aggregated reasons[] check, so we assert the invariants we just
  // established.
  const brief: ValidatedBrief = {
    brand: BRAND_GRUBANO,
    sourceEventId: validSourceEventId as string,
    pillar: pillar as Pillar,
    topic: validTopic as string,
    facts: validFacts as readonly FactRef[],
    restaurantId: validRestaurantId,
    targetUrl: validTargetUrl as string,
    assetRefs: validAssets as readonly AssetRef[],
    formats: formats as readonly SocialFormat[],
    platforms: platforms as readonly Platform[],
    legalChecks: legal as LegalChecks,
  };
  return { brief, reasons };
}

// Exported for tests only — do not consume directly from app code.
export const __test = {
  ALLOWED_TARGET_URLS,
  FORBIDDEN_KEY_SUBSTRINGS,
  MAX_INPUT_BYTES,
  MAX_STRING_LEN,
  MAX_ARRAY_LEN,
  MAX_DEPTH,
};
