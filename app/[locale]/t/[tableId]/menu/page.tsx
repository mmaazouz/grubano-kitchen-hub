import { notFound } from 'next/navigation'
import { unstable_setRequestLocale } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import TableMenuClient from '@/components/eat/TableMenuClient'
import './menu.css'
// gb-* design FOUNDATION (Agent 168) — this route renders OUTSIDE EatShell (it's a
// /t/* QR-flow page served bare by AppChrome), so it imports the foundation tokens +
// Material `.ms` font itself. The `.gb` root carries the tokens; `.gb-tablemenu`
// scopes the menu component CSS (menu.css). No globals touched. Same frame the bill
// (/t/[tableId]) uses.
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

// ── /t/[tableId]/menu — « Menu à table » (dine-in MENU, screen A of the CD dine-in
// ×4) — VERBATIM reproduction of the FROZEN CD ref (Notion 38efd2c9-…-81db). The
// full-screen MENU route the LINKED guest opens from the bill (« Commander »). This
// server shell owns IDENTITY only (the same Prisma table lookup the bill uses, so an
// unknown / deactivated table 404s BEFORE any JS runs). The client island fetches the
// real menu (GET /api/restaurants/[id]) + submits the EXISTING POST /api/t/[tableId]/order
// (byte-identical). No money math here.
export const dynamic = 'force-dynamic'

export default async function TableMenuPage({
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
      restaurantId: true,
      restaurant: { select: { name: true, archivedAt: true } },
    },
  })

  // Unknown or deactivated table → sober 404 (shared not-found.tsx).
  if (!table || !table.active) notFound()

  // Graceful fallback: a missing / archived establishment link still shows the
  // table label (never crash) — just without an establishment name. The menu
  // needs the restaurantId; if it's missing the client renders a sober empty state.
  const establishmentName =
    table.restaurant && !table.restaurant.archivedAt ? table.restaurant.name : null

  return (
    <main className="gb gb-tablemenu">
      <div className="tm-wrap">
        <TableMenuClient
          tableId={params.tableId}
          restaurantId={table.restaurantId ?? ''}
          establishmentName={establishmentName}
          tableName={table.name}
        />
      </div>
    </main>
  )
}
