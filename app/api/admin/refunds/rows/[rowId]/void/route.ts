import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { rateLimit } from '@/lib/rate-limit'
import { recordAdminAudit } from '@/lib/admin-audit'
import { sendAdminMoneyReviewAlert } from '@/lib/admin-alerts'
import { proveRowStranded, voidStrandedRefundRow, VOID_SUCCESS_NOTE } from '@/lib/refund-row-void'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/admin/refunds/rows/[rowId]/void — MODE B commit B ────────────────────────
//
// LA PORTE QUI MANQUAIT. Le moteur insère une ligne `Refund` 'pending' AVANT d'appeler Stripe ; si
// Stripe ne crée jamais rien, cette ligne reste 'pending' à vie et sa clé @unique — le curseur de
// cumul — tue le rail de remboursement de la COMMANDE (P2002 sur toute tentative, tout montant).
// Aucun code ne la retirait : `markRefundRowFailed` exige un objet Stripe Refund réel, et rien n'est
// jamais supprimé. La réclamation pouvait se clore par déclaration ; le client, lui, ne pouvait plus
// être payé par l'application. C'est cette impasse que cette route ouvre.
//
// GET  = la PREUVE, lecture seule (aucune écriture, jamais).
// POST = la libération, après re-preuve, en UN compare-and-set.
//
// DEUX DÉCISIONS EXPLICITES :
//  1. PAS de jeton machine. `/api/admin/refunds/run` accepte INTERNAL_CRON_TOKEN ; ici, non : aucune
//     machine ne rend un curseur de cumul. Session admin uniquement.
//  2. PAS derrière REFUNDS_ENABLED. La libération n'initie AUCUN mouvement d'argent ; le bail T-48
//     gouverne ce qui DÉCLENCHE un paiement. Coupler la réparation à une fenêtre de 30 minutes
//     rendrait la réparation impossible hors fenêtre — c'est la maladie elle-même. Elle a son propre
//     drapeau, REFUND_VOID_ENABLED, fermé par défaut.
const bodySchema = z.object({
  orderId:               z.string().min(1),
  expectedIdempotencyKey: z.string().min(1),
  confirm:               z.literal('LIBERER'),
})

function isVoidRailEnabled(): boolean {
  return process.env.REFUND_VOID_ENABLED === 'true'
}

async function guard(req: Request): Promise<{ ok: true; actorId: string; actorEmail: string } | { ok: false; res: NextResponse }> {
  const limited = rateLimit(req, 'admin_refund_row_void', { limitDefault: 10, windowDefault: 60 })
  if (limited) return { ok: false, res: limited as NextResponse }
  if (!isVoidRailEnabled()) {
    return { ok: false, res: NextResponse.json({ error: 'Libération de ligne indisponible', gated: true }, { status: 403 }) }
  }
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return { ok: false, res: NextResponse.json({ error: 'Authentification requise' }, { status: 401 }) }
  const operator = await prisma.operator.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } })
  if (!operator || operator.role !== 'admin') return { ok: false, res: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) }
  return { ok: true, actorId: operator.id, actorEmail: session.user.email }
}

/** GET — la preuve, sans aucune écriture. C'est l'étape obligatoire avant toute libération. */
export async function GET(req: Request, { params }: { params: { rowId: string } }) {
  const g = await guard(req)
  if (!g.ok) return g.res
  const orderId = new URL(req.url).searchParams.get('orderId') ?? ''
  if (!orderId) return NextResponse.json({ error: 'orderId requis (recoupement anti-faute de frappe).' }, { status: 400 })
  const proved = await proveRowStranded({ rowId: params.rowId, orderId })
  if (!proved.ok) return NextResponse.json({ voidable: false, code: proved.code, error: proved.error, proof: proved.proof }, { status: proved.status })
  return NextResponse.json({ voidable: true, proof: proved.proof, note: VOID_SUCCESS_NOTE })
}

/** POST — libère la ligne. Aucun argent ne bouge ici ; le rail de la commande est simplement rouvert. */
export async function POST(req: Request, { params }: { params: { rowId: string } }) {
  const g = await guard(req)
  if (!g.ok) return g.res
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide (orderId, expectedIdempotencyKey et confirm="LIBERER" requis).' }, { status: 400 })
  }
  const out = await voidStrandedRefundRow({
    rowId: params.rowId, orderId: parsed.data.orderId, expectedIdempotencyKey: parsed.data.expectedIdempotencyKey,
  })
  if (!out.ok) return NextResponse.json({ ok: false, code: out.code, error: out.error, proof: out.proof }, { status: out.status })

  // Trace APRÈS l'écriture gagnée uniquement, et jamais bloquante.
  try {
    await recordAdminAudit({
      actorId: g.actorId, actorEmail: g.actorEmail, action: 'refund.row_void',
      targetType: 'refund', targetId: out.proof.rowId,
      metadata: { ...out.proof, keyBefore: out.keyBefore, keyAfter: out.keyAfter },
    })
  } catch { /* la trace ne doit jamais annuler une réparation réussie */ }
  try {
    await sendAdminMoneyReviewAlert({
      kind: 'refund_reconciliation_incomplete',
      dedupeKey: `refund_row_void:${out.proof.rowId}`,
      title: 'Ligne de remboursement LIBÉRÉE (aucun argent déplacé)',
      facts: {
        rowId: out.proof.rowId, orderId: out.proof.orderId, amountCents: out.proof.amountCents,
        cursorCents: out.proof.cursorCents, stripeAmountRefundedCents: out.proof.stripeAmountRefundedCents,
        boundClaims: out.proof.boundClaimIds.join(',') || 'none',
        otherPendingRows: out.proof.otherPendingRowIds.join(',') || 'none',
        action: 'le client n’a PAS été payé : relancer un remboursement sur cette commande, puis clôturer la réclamation en déclarant le paiement',
      },
    })
  } catch { /* idem */ }

  return NextResponse.json({
    ok: true, proof: out.proof, keyBefore: out.keyBefore, keyAfter: out.keyAfter,
    note: VOID_SUCCESS_NOTE,
    remainingPendingRows: out.proof.otherPendingRowIds,
  })
}
