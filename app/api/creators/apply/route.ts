import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { makeVerifyCode } from '@/lib/verify-code'
import { ensureCreatorOperator } from '@/lib/creator-account'

const dishConceptSchema = z.object({
  name:        z.string().min(1),
  description: z.string().min(1),
  cuisineType: z.string().min(1),
})

const applySchema = z.object({
  name:         z.string().min(2),
  email:        z.string().email(),
  bio:          z.string().min(10),
  instagram:    z.string().optional(),
  tiktok:       z.string().optional(),
  youtube:      z.string().optional(),
  followers:    z.number().int().min(0).default(0),
  // Mission 14 — the dish-concepts portfolio is CHEF-only. The blanket
  // `.min(1)` is gone (it blocked a pure influencer who submits zero concepts);
  // the per-role minimum is re-enforced in the superRefine below, so the CHEF
  // contract is byte-for-byte unchanged (still rejects an empty portfolio).
  dishConcepts: z.array(dishConceptSchema).max(3).default([]),
  // Mission 2 — role choice (chef/influencer, cumulable, both default true).
  // VALIDATED here for contract clarity; the durable storage point is the
  // Creator upsert at VERIFY time (the wizard forwards the same choice there —
  // the application row stays untouched: zero extra migration, the vetting
  // JSON unpolluted). Noted in the mission report.
  roles: z.object({
    chef:       z.boolean().default(true),
    influencer: z.boolean().default(true),
  }).optional(),
}).superRefine((data, ctx) => {
  // Mission 14 — at least one complete dish concept is required UNLESS the
  // candidate is a pure influencer (influencer ✔ / chef ✘). Chef, chef+
  // influencer, and any legacy client that omits `roles` all keep the ≥1 rule.
  const influencerOnly = data.roles?.influencer === true && data.roles?.chef === false
  if (!influencerOnly && data.dishConcepts.length < 1) {
    ctx.addIssue({
      code:    z.ZodIssueCode.custom,
      path:    ['dishConcepts'],
      message: 'Au moins un concept de plat est requis.',
    })
  }
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const data = applySchema.parse(body)

    const application = await prisma.creatorApplication.create({
      data: {
        name:         data.name,
        email:        data.email,
        bio:          data.bio,
        instagram:    data.instagram,
        tiktok:       data.tiktok,
        youtube:      data.youtube,
        followers:    data.followers,
        dishConcepts: data.dishConcepts,
      },
    })

    // The applicant proves channel ownership by pasting this code into their
    // YouTube description; POST /api/creators/apply/[id]/verify re-derives it.
    const verifyCode = makeVerifyCode(application.id)

    // Auth bridge (Phase 0 → Phase 3) — provision the creator's login account.
    // Fresh email → a PASSWORDLESS Operator(role='creator', pending). Existing
    // account (any role) → left untouched here; the 'creator' role is ADDED to it
    // on approval (Phase 3 cumul). Best-effort: never blocks the application.
    // `accountExists` is purely informational (the email already had an account);
    // it no longer blocks — the role is simply added at verify time.
    const bridge = await ensureCreatorOperator(data.email, data.name, { activate: false })
    const accountExists = bridge.ok === true && bridge.created === false

    return NextResponse.json({ applicationId: application.id, verifyCode, accountExists }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/creators/apply]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
