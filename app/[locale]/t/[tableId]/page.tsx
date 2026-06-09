import { notFound } from 'next/navigation'
import { unstable_setRequestLocale } from 'next-intl/server'
import { Receipt } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import TableBillClient from '@/components/eat/TableBillClient'

// ── /t/[tableId] — public "table bill" landing (QR target, Sunday-style) ──────
// The short, FIXED URL a table QR encodes. PUBLIC + consumer-side (served bare via
// AppChrome, reachable without login via middleware). No payment yet — this is the
// sober shell the amount + pay/share buttons will plug into later WITHOUT changing
// the URL (so QR codes never need reprinting). Reads the DB by table id → dynamic.
export const dynamic = 'force-dynamic'

export default async function TableBillPage({
  params,
}: {
  params: { locale: string; tableId: string }
}) {
  unstable_setRequestLocale(params.locale)

  const table = await prisma.restaurantTable.findUnique({
    where:  { id: params.tableId },
    select: {
      name:       true,
      active:     true,
      restaurant: { select: { name: true, archivedAt: true } },
    },
  })

  // Unknown or deactivated table → sober 404 (see not-found.tsx).
  if (!table || !table.active) notFound()

  // Graceful fallback: if the establishment link is missing or archived we still
  // show the table label (never crash) — just without an establishment name.
  const establishmentName =
    table.restaurant && !table.restaurant.archivedAt ? table.restaurant.name : null

  return (
    <main className="flex min-h-[100dvh] flex-col bg-background px-6 py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">

        {/* Sober wordmark */}
        <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          Grubano
        </p>

        {/* Identity — establishment + table */}
        <div className="mt-12 text-center">
          {establishmentName && (
            <h1 className="font-display text-3xl font-bold tracking-tight">
              {establishmentName}
            </h1>
          )}
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-semibold">
            <Receipt size={14} className="text-primary" />
            {table.name}
          </span>
        </div>

        {/* Bill — Agent 14 brique 2. The client island fetches the open
            ticket, renders items + total, and walks through the real charge
            via the factored <StripeTicketPayment /> component. Server side
            still owns identity (Prisma lookup above), so an unknown /
            deactivated table 404s BEFORE any JS runs. */}
        <TableBillClient tableId={params.tableId} />

        <p className="mt-auto pt-10 text-center text-[11px] text-muted-foreground">
          Propulsé par Grubano
        </p>
      </div>
    </main>
  )
}
