import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/dishes/withdraw  — a restaurateur withdraws an adopted recipe.
//
// Business rule (validated by Mohammed):
//   • Success threshold = cumulative revenue ≥ AdoptionConfig.successThresholdEur.
//   • Minimum commitment = AdoptionConfig.minCommitmentDays (default 60).
//   • Withdrawing a WORKING recipe BEFORE the commitment ends does NOT block the
//     restaurateur — instead we compute an exit settlement (the creator earnings
//     they would have generated over the remaining days, extrapolated from the
//     observed daily average) and store it on the adoption. We do NOT charge it
//     (no payment system yet) — we only compute + persist + return the amount due.
//   • Otherwise (below the threshold, or past the commitment) withdrawal is free.
//
// In all cases the adoption is marked ended and its linked MenuItem is disabled
// (available=false) — never deleted, so historical orders keep their reference.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_ROLES = ['restaurant', 'admin'] as const

const CONFIG_DEFAULTS = {
  minCommitmentDays:   60,
  successThresholdEur: 300,
}

const DAY = 24 * 60 * 60 * 1000
const round2 = (n: number) => Math.round(n * 100) / 100

const bodySchema = z.object({
  adoptionId: z.string().min(1),
})

export async function POST(req: Request) {
  try {
    // ── Auth + role ─────────────────────────────────────────────────────────────
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const user       = session.user as { id?: string; role?: string }
    const operatorId = user.id
    if (!operatorId) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const isAdmin = user.role === 'admin'
    if (!ALLOWED_ROLES.includes((user.role ?? '') as (typeof ALLOWED_ROLES)[number])) {
      return NextResponse.json({ error: 'Accès réservé aux restaurateurs' }, { status: 403 })
    }

    // ── Body ──────────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => null)
    const { adoptionId } = bodySchema.parse(body)

    // ── Load the adoption + its sales + owning brand ──────────────────────────────
    const adoption = await prisma.dishAdoption.findUnique({
      where:   { id: adoptionId },
      include: { sales: true, brand: true },
    })
    if (!adoption) {
      return NextResponse.json({ error: 'Adoption introuvable' }, { status: 404 })
    }
    // Ownership: the adoption's brand must belong to this operator (admins bypass).
    if (!isAdmin && adoption.brand.operatorId !== operatorId) {
      return NextResponse.json({ error: 'Cette adoption ne vous appartient pas' }, { status: 403 })
    }

    // ── Config (or safe defaults) ─────────────────────────────────────────────────
    const config = await prisma.adoptionConfig.findFirst({
      where:   { active: true },
      orderBy: { createdAt: 'asc' },
    })
    const minCommitmentDays   = config?.minCommitmentDays   ?? CONFIG_DEFAULTS.minCommitmentDays
    const successThresholdEur = config?.successThresholdEur ?? CONFIG_DEFAULTS.successThresholdEur

    // ── Metrics ───────────────────────────────────────────────────────────────────
    const cumulativeRevenue       = adoption.sales.reduce((s, sale) => s + sale.amount, 0)
    const cumulativeCreatorEarn   = adoption.sales.reduce((s, sale) => s + sale.creatorEarning, 0)
    const daysElapsed             = Math.max(0, Math.floor((Date.now() - adoption.adoptedAt.getTime()) / DAY))
    const works                   = cumulativeRevenue >= successThresholdEur
    const beforeCommitment        = daysElapsed < minCommitmentDays

    // ── Exit settlement rule ────────────────────────────────────────────────────
    // Only owed when a WORKING recipe is pulled before the commitment ends.
    let earlyExitSettlement = 0
    if (works && beforeCommitment) {
      const dailyAvgEarning = cumulativeCreatorEarn / Math.max(daysElapsed, 1)
      const daysRemaining   = Math.max(0, minCommitmentDays - daysElapsed)
      earlyExitSettlement   = round2(dailyAvgEarning * daysRemaining)
    }

    // ── End the adoption + disable its MenuItem (transaction) ─────────────────────
    await prisma.$transaction(async (tx) => {
      await tx.dishAdoption.update({
        where: { id: adoption.id },
        data:  { status: 'ended', endedAt: new Date(), earlyExitSettlement },
      })
      if (adoption.menuItemId) {
        await tx.menuItem.update({
          where: { id: adoption.menuItemId },
          data:  { available: false },
        })
      }
    })

    return NextResponse.json({
      withdrawn: true,
      works,
      earlyExitSettlement,
      daysElapsed,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/dishes/withdraw]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
