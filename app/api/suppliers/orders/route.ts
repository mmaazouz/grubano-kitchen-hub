import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import nodemailer from 'nodemailer'
import { z } from 'zod'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'

export const dynamic = 'force-dynamic'

// 🔒 SEC. This route had NO auth: GET returned every operator's purchase-order
// history (+ supplier email) to anonymous callers, and POST forged orders + sent
// real supplier emails. Now gated restaurant/admin. NB: SupplierOrder has no
// operatorId, so an authenticated operator still sees the shared order pool — a
// true per-operator scoping needs a schema column (flagged for follow-up).

const orderItemSchema = z.object({
  name:     z.string(),
  quantity: z.number(),
  unit:     z.string(),
  price:    z.number(),
})

const createSchema = z.object({
  supplierId: z.string(),
  items:      z.array(orderItemSchema).min(1),
  total:      z.number().min(0),
})

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST   ?? 'mail.grubano.com',
  port:   587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER ?? 'contact@grubano.com',
    pass: process.env.SMTP_PASS,
  },
})

// ── GET /api/suppliers/orders?supplierId= ─────────────────────────────────────

export async function GET(req: Request) {
  const scope = await resolveEstablishmentScope(null)
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status })
  }
  try {
    const { searchParams } = new URL(req.url)
    const supplierId = searchParams.get('supplierId') ?? undefined

    const orders = await prisma.supplierOrder.findMany({
      where:   supplierId ? { supplierId } : undefined,
      include: { supplier: { select: { name: true, email: true } } },
      orderBy: { sentAt: 'desc' },
      take:    50,
    })

    return NextResponse.json({ orders })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── POST /api/suppliers/orders ────────────────────────────────────────────────

export async function POST(req: Request) {
  const scope = await resolveEstablishmentScope(null)
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status })
  }
  try {
    const body = await req.json()
    const { supplierId, items, total } = createSchema.parse(body)

    const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } })
    if (!supplier) {
      return NextResponse.json({ error: 'Fournisseur introuvable' }, { status: 404 })
    }

    const order = await prisma.supplierOrder.create({
      data: {
        supplierId,
        items: items as unknown as import('@prisma/client').Prisma.InputJsonValue,
        total,
        status: 'pending',
      },
    })

    // Send order email if supplier has email
    if (supplier.email && process.env.SMTP_PASS) {
      const itemsHtml = items
        .map(i => `<tr><td style="padding:4px 8px">${i.name}</td><td style="padding:4px 8px;text-align:right">${i.quantity} ${i.unit}</td><td style="padding:4px 8px;text-align:right">€${(i.price * i.quantity).toFixed(2)}</td></tr>`)
        .join('')

      await transporter.sendMail({
        from:    '"Grubano" <contact@grubano.com>',
        to:      supplier.email,
        subject: `Bon de commande Grubano — ${new Date().toLocaleDateString('fr-FR')}`,
        html: `
          <h2 style="font-family:sans-serif">Bon de commande</h2>
          <p style="font-family:sans-serif">Bonjour,<br>Veuillez trouver ci-dessous notre commande du jour.</p>
          <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px">
            <thead>
              <tr style="background:#1a1a2e;color:white">
                <th style="padding:8px">Produit</th>
                <th style="padding:8px;text-align:right">Quantité</th>
                <th style="padding:8px;text-align:right">Total</th>
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
            <tfoot>
              <tr style="font-weight:bold;border-top:2px solid #1a1a2e">
                <td colspan="2" style="padding:8px">Total</td>
                <td style="padding:8px;text-align:right">€${total.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
          <p style="font-family:sans-serif;color:#666;font-size:12px;margin-top:16px">
            Livraison estimée sous ${supplier.leadTime}.<br>
            Référence commande : ${order.id}<br><br>
            L'équipe Grubano
          </p>
        `,
      })

      await prisma.supplierOrder.update({
        where: { id: order.id },
        data:  { status: 'sent' },
      })
    }

    return NextResponse.json({ order }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
