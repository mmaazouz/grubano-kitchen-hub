import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { buildAdminIdentity } from '@/lib/admin-identity'
import { isInfluencerEnabled } from '@/lib/influencer-verification'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { isCourierActivationEnabled } from '@/lib/logistics-account'
import AdminShell from '@/components/admin/AdminShell'
import Dac7AdminExport from '@/components/dac7/Dac7AdminExport'

// ── /admin/dac7 — admin-only DAC7 export console (P4.4-C, Agent 56) ─────────────────
// ADM6 harmonisation: mounts the AdminShell navy console + an --op- page header; the
// export WIDGET (Dac7AdminExport) is unchanged — the export endpoint, its admin re-check
// and every fiscal aggregate are byte-identical. Admin-only (resolveAdmin, equivalent to
// the prior inline gate). READ-ONLY money side.
export const dynamic = 'force-dynamic'

export default async function AdminDac7Page(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('dac7.admin')

  const admin = await resolveAdmin()
  if (!admin) redirect('/eat')

  const identity = buildAdminIdentity(admin)
  const flags = {
    influencer: isInfluencerEnabled(),
    prestataire: isPrestataireEnabled(),
    logistics: isCourierActivationEnabled(),
  }

  // Last completed calendar year down to 2020 — the years a report can cover.
  const lastCompleted = new Date().getUTCFullYear() - 1
  const years: number[] = []
  for (let y = lastCompleted; y >= 2020; y--) years.push(y)

  return (
    <AdminShell identity={identity} flags={flags}>
      <section>
        <div className="op-dash__head">
          <h1 className="op-dash__title">{t('title')}</h1>
          <p className="op-dash__sub">{t('subtitle')}</p>
        </div>
        <Dac7AdminExport years={years} />
      </section>
    </AdminShell>
  )
}
