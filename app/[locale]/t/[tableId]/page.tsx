import { notFound } from 'next/navigation'
import { unstable_setRequestLocale } from 'next-intl/server'
import { Receipt, Clock } from 'lucide-react'
import { prisma } from '@/lib/prisma'

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

        {/* Status */}
        <div className="mt-14 flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent text-primary">
            <Clock size={22} />
          </span>
          <p className="mt-4 text-lg font-semibold">Votre addition arrive bientôt</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            Bientôt : réglez votre table directement ici.
          </p>
        </div>

        {/* ── FUTURE PAYMENT (placeholders — no payment exists yet) ───────────
            The URL /t/[tableId] is PERMANENT: the bill amount + actions plug in
            HERE without changing the QR. When the payment chantier lands:
              • AMOUNT  → fetch the live bill (e.g. GET /api/t/[tableId]/bill) and
                          render the total in a block right below the status;
              • ACTIONS → render the "Payer tout / Payer ma part / Partager"
                          buttons wired to the payment provider.
            Left intentionally absent today so the shell stays sober. */}

        <p className="mt-auto pt-10 text-center text-[11px] text-muted-foreground">
          Propulsé par Grubano
        </p>
      </div>
    </main>
  )
}
