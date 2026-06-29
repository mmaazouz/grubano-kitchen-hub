import { notFound } from 'next/navigation'
import { unstable_setRequestLocale } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import TableBillClient from '@/components/eat/TableBillClient'
import './t.css'
// gb-* design FOUNDATION (Agent 168) — this route renders OUTSIDE EatShell, so it
// imports the foundation tokens + Material `.ms` font itself. The `.gb` root carries
// the tokens; `.gb-table` scopes the bill component CSS (t.css). No globals touched.
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

// ── /t/[tableId] — public "table bill" landing (QR target) — CD dine-in « addition » ──
// The short, FIXED URL a table QR encodes. PUBLIC + consumer-side (served bare via
// AppChrome, reachable without login via middleware). Reads the DB by table id → dynamic.
// 🔒 MONEY: the bill fetch + the pay action + the Stripe flow live in <TableBillClient/>
// and are byte-identical — this server shell only owns identity (Prisma lookup) +
// the gb- frame (table banner + « L'addition » title row).
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
    <main className="gb gb-table">
      <div className="tb-wrap">
        {/* Bill — the client island fetches the open ticket, renders the CD
            « addition » markup (table banner + items + totals) and walks through
            the real charge via <StripeTicketPayment />. Server side still owns
            identity (Prisma lookup above), so an unknown / deactivated table 404s
            BEFORE any JS runs. Banner identity is passed in as props. */}
        <TableBillClient
          tableId={params.tableId}
          establishmentName={establishmentName}
          tableName={table.name}
        />
      </div>
    </main>
  )
}
