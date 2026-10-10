// Deterministic idempotency keys for Grubano social briefs.
//
// Collision-resistant under hostile delimiter injection: a caller cannot
// forge a collision by stuffing `|`, `\0`, `\x1f`, UTF-16 surrogates, Unicode
// line separators or BOMs into any field. Every component is length-prefixed
// and null-separated, then hashed with SHA-256 from the Node standard library
// (no network, no external deps). The output is stable across OS, Node
// versions and process restarts.

import { createHash } from 'node:crypto';

import {
  BRAND_GRUBANO,
  type Platform,
  type SocialFormat,
} from './types';

export interface IdempotencyParts {
  readonly brand: typeof BRAND_GRUBANO;
  readonly sourceEventId: string;
  readonly pillar: string;
  readonly platform: Platform;
  readonly format: SocialFormat;
}

export class IdempotencyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyInputError';
  }
}

const MAX_COMPONENT_BYTES = 256;

// Length-prefixed, null-byte-separated, utf8-encoded. The length prefix is a
// 4-byte big-endian unsigned int on the UTF-8 BYTE length (not code points) —
// so a malicious string that smuggles a NUL byte or a `|` can never shorten
// another component into a sibling's bytes.
function encodeComponent(label: string, value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength > MAX_COMPONENT_BYTES) {
    throw new IdempotencyInputError(`${label} too long: ${bytes.byteLength} bytes`);
  }
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(bytes.byteLength, 0);
  // Label itself is static (compile-time constant from the caller) — we still
  // length-prefix it to defend against a future refactor that forwards a
  // caller-supplied label.
  const labelBytes = Buffer.from(label, 'utf8');
  const labelLen = Buffer.alloc(4);
  labelLen.writeUInt32BE(labelBytes.byteLength, 0);
  return Buffer.concat([labelLen, labelBytes, lenBuf, bytes]);
}

function assertSafeComponent(label: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new IdempotencyInputError(`${label} must be a string`);
  }
  if (value.length === 0) {
    throw new IdempotencyInputError(`${label} must be non-empty`);
  }
  // Reject lone surrogates — a half of a surrogate pair can serialize into
  // the replacement character and collide with any other string that
  // happens to produce one. Count surrogates manually since `for...of`
  // yields code points.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw new IdempotencyInputError(`${label} contains lone high surrogate`);
      }
      i++; // skip the paired low surrogate
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new IdempotencyInputError(`${label} contains lone low surrogate`);
    }
  }
  return value;
}

export function deriveIdempotencyKey(parts: IdempotencyParts): string {
  if (parts.brand !== BRAND_GRUBANO) {
    throw new IdempotencyInputError(`brand must be ${BRAND_GRUBANO}`);
  }
  const buffers: Buffer[] = [
    // Fixed-width magic header pins the hash to this specific derivation
    // scheme — if we ever change the layout, the magic changes with it and
    // all historical keys stop colliding by construction.
    Buffer.from('GRUBANO/social-brief/v1\0', 'utf8'),
    encodeComponent('brand', assertSafeComponent('brand', parts.brand)),
    encodeComponent('sourceEventId', assertSafeComponent('sourceEventId', parts.sourceEventId)),
    encodeComponent('pillar', assertSafeComponent('pillar', parts.pillar)),
    encodeComponent('platform', assertSafeComponent('platform', parts.platform)),
    encodeComponent('format', assertSafeComponent('format', parts.format)),
  ];
  const hash = createHash('sha256');
  for (const b of buffers) hash.update(b);
  // Namespace-tagged output so operators grepping logs can tell at a glance
  // what the string identifies.
  return `grubano:social-brief:${hash.digest('hex')}`;
}

export function deriveKeysForBrief(input: {
  readonly brand: typeof BRAND_GRUBANO;
  readonly sourceEventId: string;
  readonly pillar: string;
  readonly platforms: readonly Platform[];
  readonly formats: readonly SocialFormat[];
}): readonly string[] {
  const keys: string[] = [];
  for (const platform of input.platforms) {
    for (const format of input.formats) {
      keys.push(
        deriveIdempotencyKey({
          brand: input.brand,
          sourceEventId: input.sourceEventId,
          pillar: input.pillar,
          platform,
          format,
        }),
      );
    }
  }
  // Return a deduplicated, lexically-sorted list so the result is a stable
  // function of the (set of platforms × set of formats), independent of input
  // ordering. This lets upstream outbox code compare keys with a plain
  // string-equality join without worrying about array order.
  return Array.from(new Set(keys)).sort();
}
