import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { FileText } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readOperatorRoles } from '@/lib/operator-roles'
import Dac7AdminExport from '@/components/dac7/Dac7AdminExport'

// ── /admin/dac7 — admin-only DAC7 export console (P4.4-C, Agent 56) ─────────────────
// ADMIN-only. Double-gated: this server role check + the export endpoint re-checks the
// admin session (anti-leak: the aggregate carries every seller's fiscal identity +
// revenue). No flag (the page is inert unless you are an admin). READ-ONLY money side.
export const dynamic = 'force-dynamic'

export default async function AdminDac7Page(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('dac7.admin')

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/auth/magic')

  const operator = await prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!operator) redirect('/eat')
  const roles = await readOperatorRoles(operator.id, operator.role)
  if (!roles.includes('admin')) redirect('/eat')

  // Last completed calendar year down to 2020 — the years a report can cover.
  const lastCompleted = new Date().getUTCFullYear() - 1
  const years: number[] = []
  for (let y = lastCompleted; y >= 2020; y--) years.push(y)

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 space-y-6">
      <header className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
          <FileText size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-grubano-ink">{t('title')}</h1>
          <p className="text-sm text-grubano-ink-muted">{t('subtitle')}</p>
        </div>
      </header>

      <Dac7AdminExport years={years} />
    </div>
  )
}
