/**
 * LLM GATEWAY — the SINGLE module through which every LLM call in the app passes
 * (cost-governance step 1, Agent 14). It is a pure TRANSPORT layer:
 *   - selects the MODEL per TASK TYPE (configurable map; Haiku is the cheap default,
 *     Sonnet only where the task currently needs it — see TASKS),
 *   - applies token CAPS (per-task max output + a high input ceiling/truncation),
 *   - METERS every call into LlmUsage (real tokens from the API response + an
 *     estimated cost via configurable PLACEHOLDER rates + task + optional operator),
 *   - exposes a global KILL-SWITCH (env LLM_DISABLED) that makes every call fail so
 *     each caller's EXISTING fail-safe applies (vetting → pending/doubt, etc.).
 *
 * It deliberately holds NO business logic: prompts, parsing, and fail-safes stay in
 * the task modules (creator-vetting, supplier-vetting, scan-dish…). This is the ONLY
 * file in the app that imports @anthropic-ai/sdk.
 *
 * BEHAVIOR-PRESERVING: per-task model + max-output reproduce each call site's prior
 * settings exactly, so existing features return identical results.
 */

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import { isOverQuota, LlmQuotaError } from '@/lib/llm/quota'

// Step-2 quota surface, re-exported so callers import everything LLM from '@/lib/llm'.
export { LlmQuotaError, QUOTA, getOperatorUsage, isOverQuota, getUsageOverview } from '@/lib/llm/quota'
export type { OperatorUsage, UsageRow } from '@/lib/llm/quota'

// Content the caller sends. Re-exported so task modules never import the SDK directly.
export type LlmContentBlock = Anthropic.Messages.ContentBlockParam
export type LlmContent = string | LlmContentBlock[]

// ── Task → model + caps (CONFIGURABLE, behavior-preserving) ───────────────────
// Frozen model ids (CLAUDE.md). Haiku = cheap default for short classification /
// generation. Sonnet is kept ONLY where the task currently uses it — vision
// (dish_moderation, dish_scan) and the richer text generations (stock_parse,
// review_reply, briefing, email_agent). NOTE: this map preserves today's behavior;
// cost-tiering text tasks down to Haiku is a deliberate LATER step (would change
// outputs), not done here.
export const HAIKU  = 'claude-haiku-4-5'
export const SONNET = 'claude-sonnet-4-5'

export type LlmTask =
  | 'creator_vetting'
  | 'dish_vetting'
  | 'supplier_vetting'
  | 'prestataire_vetting'
  | 'business_verification'
  | 'affiliate_caption'
  | 'dish_moderation'
  | 'dish_scan'
  | 'menu_extract'
  | 'site_extract'
  | 'stock_parse'
  | 'review_reply'
  | 'briefing'
  | 'email_agent'

interface TaskConfig { model: string; maxOutputTokens: number }

export const TASKS: Record<LlmTask, TaskConfig> = {
  creator_vetting:       { model: HAIKU,  maxOutputTokens: 300 },
  dish_vetting:          { model: HAIKU,  maxOutputTokens: 400 },
  supplier_vetting:      { model: HAIKU,  maxOutputTokens: 200 },
  prestataire_vetting:   { model: HAIKU,  maxOutputTokens: 200 },
  business_verification: { model: HAIKU,  maxOutputTokens: 200 },
  affiliate_caption:     { model: HAIKU,  maxOutputTokens: 700 },
  dish_moderation:   { model: SONNET, maxOutputTokens: 400 },
  dish_scan:         { model: SONNET, maxOutputTokens: 1024 },
  // Onboarding menu prefill (Agent 89): vision/PDF extraction of a WHOLE card → many
  // dishes, so a larger output cap than a single dish_scan. Sonnet (vision-capable).
  menu_extract:      { model: SONNET, maxOutputTokens: 4096 },
  // Onboarding profile prefill from a website (Agent 91): extract a small NON-LEGAL
  // marketing draft (name/description/cuisine) from bounded site TEXT. Cheap Haiku default.
  site_extract:      { model: HAIKU,  maxOutputTokens: 1024 },
  stock_parse:       { model: SONNET, maxOutputTokens: 512 },
  review_reply:      { model: SONNET, maxOutputTokens: 300 },
  briefing:          { model: SONNET, maxOutputTokens: 400 },
  email_agent:       { model: SONNET, maxOutputTokens: 600 },
}

// Cost rates in CENTS per 1,000,000 tokens. PLACEHOLDERS — calibrate to the real
// Anthropic price list (NOTE). Used only for the LlmUsage cost ESTIMATE; never real money.
export const COST_PER_MTOK_CENTS: Record<string, { input: number; output: number }> = {
  [HAIKU]:  { input: 100,  output: 500 },   // ~$1 / $5 per Mtok (placeholder)
  [SONNET]: { input: 300,  output: 1500 },  // ~$3 / $15 per Mtok (placeholder)
}

// High input ceiling — a runaway-input BACKSTOP, not an active truncator: real
// prompts are far below it, so behavior is unchanged. Beyond it, trailing text is
// trimmed cleanly (images pass through untouched; their bytes are capped upstream).
export const MAX_INPUT_CHARS = 120_000

export class LlmDisabledError extends Error {
  constructor() { super('LLM gateway disabled (kill-switch)'); this.name = 'LlmDisabledError' }
}

export interface LlmResult {
  text:               string
  model:              string
  usage:              { inputTokens: number; outputTokens: number }
  estimatedCostCents: number
}

export interface LlmCallInput {
  task:             LlmTask
  content:          LlmContent
  operatorId?:      string | null
  /** Override the per-task default max output (rarely needed). */
  maxOutputTokens?: number
}

// One client for the whole app (reads ANTHROPIC_API_KEY from env, like before).
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/** Global kill-switch — LLM_DISABLED=1|true|yes blocks every call. */
export function isLlmDisabled(): boolean {
  const v = (process.env.LLM_DISABLED || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

function truncate(s: string): string {
  return s.length > MAX_INPUT_CHARS ? `${s.slice(0, MAX_INPUT_CHARS)}\n[…troncature gateway…]` : s
}

/** Cap input size (backstop). Text content + any text blocks are bounded; images untouched. */
function capInput(content: LlmContent): LlmContent {
  if (typeof content === 'string') return truncate(content)
  return content.map((b) =>
    b.type === 'text' && typeof b.text === 'string' ? { ...b, text: truncate(b.text) } : b,
  )
}

function firstText(content: Anthropic.Messages.ContentBlock[]): string {
  for (const b of content) if (b.type === 'text' && typeof b.text === 'string') return b.text
  return ''
}

export function estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const rate = COST_PER_MTOK_CENTS[model] ?? { input: 0, output: 0 }
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000
}

// Metering write — BEST-EFFORT: a logging failure must never break the LLM call or
// change the result the caller sees.
async function recordUsage(
  task: LlmTask, model: string,
  inputTokens: number, outputTokens: number, estimatedCostCents: number,
  operatorId: string | null,
): Promise<void> {
  try {
    await prisma.llmUsage.create({
      data: { task, model, inputTokens, outputTokens, estimatedCostCents, operatorId },
    })
  } catch (e) {
    console.error('[llm-gateway] usage logging failed (non-fatal):', e instanceof Error ? e.message : e)
  }
}

/**
 * The ONE entry point for an LLM completion. Picks model + caps by task, calls the
 * SDK, meters the call, and returns the first text block. THROWS on the kill-switch
 * (LlmDisabledError) and on any SDK/transport error — by design, so the caller's
 * existing try/catch fail-safe takes over (e.g. vetting → 'doubt'/'pending').
 */
export async function llmComplete(input: LlmCallInput): Promise<LlmResult> {
  if (isLlmDisabled()) throw new LlmDisabledError()

  // Per-partner quota (step 2) — ONLY for operator-attributed calls. System/cron and
  // pre-account vetting pass no operatorId and are never blocked here. isOverQuota is
  // FAIL-OPEN, so a transient metering error allows the call rather than breaking it.
  if (input.operatorId && (await isOverQuota(input.operatorId))) {
    throw new LlmQuotaError()
  }

  const cfg    = TASKS[input.task]
  const maxOut = input.maxOutputTokens ?? cfg.maxOutputTokens

  const msg = await claude.messages.create({
    model:      cfg.model,
    max_tokens: maxOut,
    messages:   [{ role: 'user', content: capInput(input.content) }],
  })

  const inputTokens  = msg.usage?.input_tokens  ?? 0
  const outputTokens = msg.usage?.output_tokens ?? 0
  const estimatedCostCents = estimateCostCents(cfg.model, inputTokens, outputTokens)

  await recordUsage(input.task, cfg.model, inputTokens, outputTokens, estimatedCostCents, input.operatorId ?? null)

  return { text: firstText(msg.content), model: cfg.model, usage: { inputTokens, outputTokens }, estimatedCostCents }
}
