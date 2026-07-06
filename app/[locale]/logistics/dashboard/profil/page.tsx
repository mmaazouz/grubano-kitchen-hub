import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isCourierActivationEnabled } from '@/lib/logistics-account'
import LogisticsProfileForm from '@/components/logistics/LogisticsProfileForm'
import './logistics-profil.css'

// ── /logistics/dashboard/profil — the courier's EDITABLE profile (LO3, CD re-skin). ──
// Server component: resolves the REAL profile (owner-scoped, session email → LogisticsProfile),
// including the email (Operator liaison key — READ-ONLY) + createdAt + the derived status phase,
// and hands the initial data to the client form. The form persists via the REAL whitelist PATCH
// /api/logistics/profile (byte-identical — contact/missions/vehicles/zones editable; identity/
// email/SIREN stripped). Rendered inside the amber LogisticsShell (dashboard layout). RE-SKIN 0
// migration, flags OFF, moteur d'argent non touché.
export const dynamic = 'force-dynamic'

type Phase = 'wait' | 'active' | 'pending' | 'rejected' | 'suspended'
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export default async function LogisticsProfilePage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)

  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) redirect('/login')

  const p = await prisma.logisticsProfile.findUnique({ where: { email } }).catch(() => null)

  if (!p) {
    const t = await getTranslations('business.logistics.profilUi')
    return (
      <section>
        <div className="op-dash__head"><h1 className="op-dash__title">{t('title')}</h1></div>
        <div className="op-card" style={{ padding: '70px 20px', textAlign: 'center' }}>
          <span className="ms" style={{ fontSize: 44, color: 'var(--op-muted-2)' }}>badge</span>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 12 }}>{t('emptyTitle')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--op-muted)', marginTop: 5 }}>{t('emptyBody')}</div>
        </div>
      </section>
    )
  }

  const onWaitlist = p.status === 'pending' && !isCourierActivationEnabled()
  let phase: Phase = 'wait'
  if (p.status === 'active') phase = 'active'
  else if (p.status === 'rejected') phase = 'rejected'
  else if (p.status === 'suspended') phase = 'suspended'
  else phase = onWaitlist ? 'wait' : 'pending'

  return (
    <LogisticsProfileForm
      email={email}
      createdAtISO={p.createdAt.toISOString()}
      phase={phase}
      initial={{
        partnerType:  p.partnerType,
        contactName:  p.contactName,
        contactPhone: p.contactPhone ?? '',
        missionTypes: arr(p.missionTypes),
        vehicleTypes: arr(p.vehicleTypes),
        zones:        arr(p.zones),
        siren:              p.siren ?? null,
        officialName:       p.officialName ?? null,
        verificationStatus: p.verificationStatus ?? null,
        status:             p.status,
      }}
    />
  )
}
