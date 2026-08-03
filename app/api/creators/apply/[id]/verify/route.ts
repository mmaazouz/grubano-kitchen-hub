import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { makeVerifyCode } from '@/lib/verify-code'
import { resolveChannelId, getChannelStats, getRecentVideoTitles, hasYouTubeKey } from '@/lib/youtube'
import { vetCreator } from '@/lib/creator-vetting'
import { ensureCreatorOperator } from '@/lib/creator-account'
import { isCreatorEnabled } from '@/lib/creator-account'

// Orchestration route — does live network calls (YouTube) + a Claude vetting
// call, so it must always be server-rendered on demand.
export const dynamic = 'force-dynamic'

// Minimum subscriber count to earn the "verified" badge. Below it the profile is
// still created (just not verified) — the creator unlocks the badge as they grow.
// Tunable via env; defaults to 10 000.
const MIN_VERIFIED_SUBS = Number(process.env.CREATOR_MIN_VERIFIED_SUBS) || 10000

// ── POST /api/creators/apply/:id/verify ───────────────────────────────────────
// Auto-verification pipeline for a CREATOR application (backend only, no UI).
//
// Pipeline (idempotent, NEVER throws — any failure degrades to a generic 500):
//   1. Load the application. 404 if absent. If already processed (status not
//      "pending") → return the stored verdict, no side-effects.
//   2. If a YouTube channel is declared:
//        a. Resolve the channel id (null → youtube_unresolved, stays pending).
//        b. Fetch channel stats (null → youtube_unavailable, stays pending).
//        c. OWNERSHIP PROOF: the verify code must appear in the channel
//           description (missing → code_not_found, stays pending).
//        d. Claude vets the (title, description, bio, dish concepts).
//           reject → application rejected, NO Creator created.
//           pass   → Creator verified=true,  followers = subscriberCount, approved.
//           flag   → Creator verified=false, followers = subscriberCount, flagged.
//   3. If NO YouTube channel: Claude vets (bio, dish concepts) only.
//        reject       → application rejected, NO Creator created.
//        pass or flag → Creator verified=false, followers = declared, flagged.
//
// Creator creation is an UPSERT BY EMAIL: a fresh referralCode/slug is minted on
// first creation; on update we DO refresh bio/socials/followers but NEVER
// downgrade a verified=true creator and NEVER overwrite an existing code/slug.

type DishConcept = { name: string; description: string; cuisineType: string }

/** Coerce the stored Json dishConcepts into the strict shape vetCreator wants. */
function readDishConcepts(raw: unknown): DishConcept[] {
  if (!Array.isArray(raw)) return []
  return raw.map((d) => {
    const o = (d ?? {}) as Record<string, unknown>
    return {
      name:        String(o.name ?? ''),
      description: String(o.description ?? ''),
      cuisineType: String(o.cuisineType ?? ''),
    }
  })
}

/**
 * Mint a referral code that is unique across the Creator table.
 * Shape: <FIRST WORD OF NAME, UPPERCASE A-Z0-9> + short random suffix.
 */
async function generateUniqueReferralCode(name: string): Promise<{ code: string; slug: string }> {
  const base =
    (name || '')
      .trim()
      .split(/\s+/)[0]
      ?.toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 10) || 'CREATOR'

  for (let attempt = 0; attempt < 12; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase()
    const code   = `${base}${suffix}`
    const slug   = code.toLowerCase()
    const clash  = await prisma.creator.findFirst({
      where: { OR: [{ referralCode: code }, { referralLinkSlug: slug }] },
      select: { id: true },
    })
    if (!clash) return { code, slug }
  }
  // Astronomically unlikely fallback — append a time-based tail.
  const code = `${base}${Date.now().toString(36).toUpperCase().slice(-6)}`
  return { code, slug: code.toLowerCase() }
}

type ApplicationRow = NonNullable<Awaited<ReturnType<typeof prisma.creatorApplication.findUnique>>>

/**
 * Upsert the Creator by email and flip the application to its decided status.
 * Only ever called for an approved/flagged decision (reject creates no Creator).
 */
async function finalize(
  application:    ApplicationRow,
  decidedStatus:  'approved' | 'flagged',
  verified:       boolean,
  followers:      number,
  reason:         string,
  subscriberCount?: number,
) {
  const email    = application.email
  const existing = await prisma.creator.findUnique({ where: { email } })

  // Reuse an existing code/slug if the creator already has one — never overwrite.
  let referralCode:     string
  let referralLinkSlug: string
  if (existing?.referralCode) {
    referralCode     = existing.referralCode
    referralLinkSlug = existing.referralLinkSlug ?? existing.referralCode.toLowerCase()
  } else {
    const gen        = await generateUniqueReferralCode(application.name)
    referralCode     = gen.code
    referralLinkSlug = gen.slug
  }

  // Never downgrade a creator who is already verified.
  const finalVerified = existing?.verified === true ? true : verified

  // Agent 120 (unification « recommander » incr. 3/3) — decision B: a creator is now
  // purely a CHEF (recipes → royalties); the recommend/influencer rail moved to the
  // Affiliate programme (/affiliate/apply). A NEW creator (existing === null) is therefore
  // CHEF-ONLY (isInfluencer=false). An EXISTING creator is GRANDFATHERED — both flags are
  // PRESERVED EXACTLY (null treated as true, matching lib/creator-roles.readCreatorRoles),
  // so an existing isInfluencer creator keeps their /chef link attribution + dashboard.
  // The wizard no longer sends a role choice; influencer is NEVER (re)granted here.
  const finalIsChef       = existing ? existing.isChef       !== false : true
  const finalIsInfluencer = existing ? existing.isInfluencer !== false : false

  const creator = await prisma.creator.upsert({
    where: { email },
    create: {
      name:             application.name,
      email,
      bio:              application.bio,
      instagram:        application.instagram,
      tiktok:           application.tiktok,
      youtube:          application.youtube,
      followers,
      verified,
      // New creators are CHEF-ONLY (decision B).
      isChef:       finalIsChef,
      isInfluencer: finalIsInfluencer,
      referralCode,
      referralLinkSlug,
    },
    update: {
      // Refresh editable profile fields on re-verification…
      bio:              application.bio,
      instagram:        application.instagram,
      tiktok:           application.tiktok,
      youtube:          application.youtube,
      followers,
      // …but never downgrade verified, never clobber an existing code/slug.
      verified:         finalVerified,
      // GRANDFATHER — preserve the existing role flags EXACTLY (never downgrade an
      // existing influencer, never auto-grant influencer to a chef-only creator).
      isChef:       finalIsChef,
      isInfluencer: finalIsInfluencer,
      referralCode,
      referralLinkSlug,
    },
  })

  await prisma.creatorApplication.update({
    where: { id: application.id },
    data:  { status: decidedStatus },
  })

  // Phase 0 auth bridge — the creator is now approved/flagged: ACTIVATE their
  // passwordless Operator(role='creator') so they can sign in via magic-link and
  // reach /creators/dashboard. Both 'approved' and 'flagged' get an active login
  // (flagged = created + connectable, just no verified badge). Best-effort: a
  // bridge failure must never undo the Creator. Never clobbers a non-creator
  // Operator that already owns this email (cumul = Phase 1).
  await ensureCreatorOperator(email, application.name, { activate: true })

  return NextResponse.json({
    ok:               true,
    status:           decidedStatus,
    verified:         creator.verified,
    referralLinkSlug: creator.referralLinkSlug ?? undefined,
    ...(subscriberCount !== undefined ? { subscriberCount } : {}),
    reason,
  })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isCreatorEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const id          = params.id
    // Mission 2 — role choice forwarded by the wizard (the application row is
    // a transient vetting artifact; the durable truth is the Creator upsert).
    // Tolerant: missing/invalid body → both roles (compat with old clients);
    // both false → coerced to both true (the wizard prevents it anyway).
    // Agent 120 (unification incr. 3/3) — CHEF-ONLY by default (decision B): the vetCreator
    // barème uses the CHEF (culinary) lens for new creators. `influencer` is true ONLY if
    // EXPLICITLY requested true (legacy/compat); it no longer auto-defaults on. The DURABLE
    // isInfluencer write is decided in finalize() (new = false; existing preserved), so this
    // barème choice never grants the recommend rail.
    const rawBody = await req.json().catch(() => null) as { roles?: { chef?: unknown; influencer?: unknown } } | null
    let roles = {
      chef:       rawBody?.roles?.chef       !== false,
      influencer: rawBody?.roles?.influencer === true,
    }
    if (!roles.chef && !roles.influencer) roles = { chef: true, influencer: false }
    const application = await prisma.creatorApplication.findUnique({ where: { id } })
    if (!application) {
      return NextResponse.json({ ok: false, error: 'Candidature introuvable' }, { status: 404 })
    }

    // Idempotent: a decided application is never re-processed.
    if (application.status !== 'pending') {
      return NextResponse.json({ ok: true, status: application.status, alreadyProcessed: true })
    }

    const verifyCode    = makeVerifyCode(id)
    const dishConcepts  = readDishConcepts(application.dishConcepts)
    const youtube       = (application.youtube ?? '').trim()

    // ── Path A: a YouTube channel was declared — prove ownership + count subs ──
    if (youtube) {
      // Distinct, actionable failure buckets (Mission 14B-A) — the wizard maps
      // each to its own message instead of one generic "introuvable":
      //   youtube_config      → no YOUTUBE_API_KEY server-side (env/config issue)
      //   youtube_unresolved  → the link/handle didn't match any channel
      //   youtube_unavailable → channel found but stats unreadable (API/quota/hidden)
      if (!hasYouTubeKey()) {
        return NextResponse.json({ ok: false, reason: 'youtube_config' })
      }

      const resolved = await resolveChannelId(youtube)
      if (!resolved) {
        return NextResponse.json({ ok: false, reason: 'youtube_unresolved' })
      }
      const { channelId, viaSearch } = resolved

      const stats = await getChannelStats(channelId)
      if (!stats) {
        return NextResponse.json({ ok: false, reason: 'youtube_unavailable' })
      }

      // Ownership proof: the code must be present in the channel description.
      if (!stats.description.includes(verifyCode)) {
        // A fuzzy SEARCH match is low-confidence — a missing code most likely
        // means we matched the WRONG channel (a stranger's), not that the user
        // forgot to add it. Send them back to paste an EXACT link instead of
        // stranding them on the "retry" screen forever (adversarial-review fix).
        if (viaSearch) {
          return NextResponse.json({ ok: false, reason: 'youtube_unresolved' })
        }
        return NextResponse.json({
          ok:      false,
          reason:  'code_not_found',
          message: 'Code pas encore détecté dans la description de ta chaîne, réessaie.',
        })
      }

      // Pull the channel's real content signal (latest uploads) so vetting is
      // judged on what the channel actually publishes, not the self-declared bio.
      const recentVideoTitles = await getRecentVideoTitles(channelId)

      const vet = await vetCreator({
        channelTitle:       stats.title,
        channelDescription: stats.description,
        bio:                application.bio,
        dishConcepts,
        channelTopics:      stats.topicCategories,
        recentVideoTitles,
        // Mission 14 — role-aware barème: influencer-only → OPEN brand-safety
        // (accept any real/owned niche); chef / chef+influencer → culinary (unchanged).
        roles,
      })

      if (vet.verdict === 'reject') {
        await prisma.creatorApplication.update({ where: { id }, data: { status: 'rejected' } })
        return NextResponse.json({ ok: false, status: 'rejected', reason: vet.reason })
      }

      // Claude is happy with the content. The verified BADGE additionally needs
      // a minimum audience: below the threshold the profile is created but stays
      // un-verified (and flagged) until the channel grows — never a publish block.
      if (vet.verdict === 'pass' && stats.subscriberCount < MIN_VERIFIED_SUBS) {
        const reason =
          `Profil créé ✅. Le badge vérifié s'active dès ` +
          `${MIN_VERIFIED_SUBS.toLocaleString('fr-FR')} abonnés ` +
          `(tu en as ${stats.subscriberCount.toLocaleString('fr-FR')}).`
        return finalize(application, 'flagged', false, stats.subscriberCount, reason, stats.subscriberCount)
      }

      const verified = vet.verdict === 'pass'
      return finalize(
        application,
        verified ? 'approved' : 'flagged',
        verified,
        stats.subscriberCount,
        vet.reason,
        stats.subscriberCount,
      )
    }

    // ── Path B: no YouTube channel — vet on bio + concepts only ────────────────
    // Same role-aware barème (Mission 14): influencer-only is judged on brand
    // safety, not culinary content.
    const vet = await vetCreator({ bio: application.bio, dishConcepts, roles })

    if (vet.verdict === 'reject') {
      await prisma.creatorApplication.update({ where: { id }, data: { status: 'rejected' } })
      return NextResponse.json({ ok: false, status: 'rejected', reason: vet.reason })
    }

    // No channel = no ownership/sub-count proof → never auto-verified, always flagged.
    return finalize(application, 'flagged', false, application.followers, vet.reason, undefined)
  } catch (err) {
    console.error('[POST /api/creators/apply/[id]/verify]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
