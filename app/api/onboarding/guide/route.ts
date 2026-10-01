import { NextResponse } from 'next/server'
import { isOnboardingGuideEnabled } from '@/lib/onboarding-progress'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/onboarding/guide — feature-flag probe (anti-abandon guide, Agent 93) ─────
// Returns ONLY { enabled } so the self-gating <OnboardingGuide> client mounts (and then
// reads the EXISTING owner-scoped GET /api/business/activation) only when ON. No user data
// is exposed here → no IDOR surface. Gated by ONBOARDING_GUIDE_ENABLED (default OFF →
// enabled:false → the establishment space is byte-identical).
export async function GET() {
  return NextResponse.json({ enabled: isOnboardingGuideEnabled() })
}
