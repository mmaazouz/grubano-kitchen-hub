import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/suppliers/coherence — ADMIN clears the marketplace coherence gate ──
// D2 (Agent 111). The lean-signup coherence check (lib/supplier-coherence) keeps a fresh
// supplier HIDDEN (marketplaceCoherencePending=true) until it passes; a 'doubt'/'bad'
// verdict leaves it pending for human review. This is the admin override: an admin
// reviews such a supplier and APPROVES it → marketplaceCoherencePending=false (visible).
//
// SAFETY: ADMIN-only (same session role/roles guard as /api/admin/suppliers, 401 then
// 403). Idempotent + ONE-DIRECTIONAL (clear only). NON-money, NON-status: it flips ONLY
// the visibility flag — it never touches status / auth / Operator / payouts (payouts stay
// hard-gated by Stripe Connect KYB; login + catalogue mutation stay on `status`).

function isAdmin(user: { role?: string; roles?: string[] } | undefined): boolean {
  return !!user && (user.role === 'admin' || (Array.isArray(user.roles) && user.roles.includes('admin')))
}

const bodySchema = z.object({ email: z.string().email() })

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string; roles?: string[] } | undefined
  if (!user)          return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!isAdmin(user)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    const email = parsed.data.email.trim().toLowerCase()

    const profile = await prisma.supplierProfile.findUnique({
      where:  { email },
      select: { id: true, marketplaceCoherencePending: true },
    })
    if (!profile) return NextResponse.json({ error: 'Fournisseur introuvable' }, { status: 404 })

    // Idempotent: only write when actually pending (clear → visible).
    if (profile.marketplaceCoherencePending) {
      await prisma.supplierProfile.update({
        where: { id: profile.id },
        data:  { marketplaceCoherencePending: false },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/admin/suppliers/coherence]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
