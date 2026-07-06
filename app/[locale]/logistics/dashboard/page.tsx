import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isCourierActivationEnabled } from '@/lib/logistics-account'
import { Link } from '@/navigation'
import CourierJustificatifs from '@/components/logistics/CourierJustificatifs'
import './logistics-dashboard.css'

// ── /logistics/dashboard — courier dashboard (LO1, CD re-skin). ───────────────
// Status-ADAPTIVE landing rendered SERVER-SIDE from the REAL courier status (the CD's
// wait/pending/active demo selector is a mockup tool — here the phase is derived from
// LogisticsProfile.status + the activation flag). CHROME is the amber LogisticsShell
// (dashboard layout). Sections: status hero + progress stepper + documents checklist
// (REAL badges) + declaration form + GPS placeholder (inert) + pay banner (inert, zero €)
// + missions teaser + read-only profile summary. NO money is read/computed (priceCents
// stays inert; no amount/total/date shown). RE-SKIN 0 migration, flags OFF, moteur d'argent
// non touché.
export const dynamic = 'force-dynamic'

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

const VEHICLE_LABEL: Record<string, string> = {
  velo: 'vehicleVelo', scooter: 'vehicleScooter', voiture: 'vehicleVoiture', camionnette: 'vehicleCamionnette', frigorifique: 'vehicleFrigorifique',
}

type Phase = 'wait' | 'pending' | 'active' | 'rejected' | 'suspended'
type DocState = 'ok' | 'pending' | 'todo'

export default async function LogisticsDashboardPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('business.logistics')
  const d = (k: string) => t(`dashboard.${k}` as 'dashboard.welcome')

  const session = await getServerSession(authOptions)
  const email = session?.user?.email

  if (!email) {
    return (
      <section className="op-empty">
        <span className="ms">lock</span>
        <b>{d('noProfileTitle')}</b>
        <span>{d('noProfileBody')}</span>
      </section>
    )
  }

  const profile = await prisma.logisticsProfile.findUnique({ where: { email } }).catch(() => null)

  // No profile yet → the CD "empty" welcome (complete-your-profile CTA to the public register).
  if (!profile) {
    return (
      <section>
        <div className="op-dash__head"><div><h1 className="op-dash__title">{d('dashTitle')}</h1></div></div>
        <div className="op-card" style={{ padding: '70px 20px', textAlign: 'center' }}>
          <span className="ms" style={{ fontSize: 44, color: 'var(--op-muted-2)' }}>two_wheeler</span>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 12 }}>{d('emptyTitle')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--op-muted)', marginTop: 5, maxWidth: 400, marginInline: 'auto' }}>{d('emptyBody')}</div>
          <Link href="/business/logistics/register" className="op-btn-primary" style={{ marginTop: 18 }}>
            <span className="ms">badge</span>{d('emptyCta')}
          </Link>
        </div>
      </section>
    )
  }

  // ── REAL phase (never the demo selector). onWaitlist = pending && activation OFF. ──
  const onWaitlist = profile.status === 'pending' && !isCourierActivationEnabled()
  let phase: Phase = 'wait'
  if (profile.status === 'active') phase = 'active'
  else if (profile.status === 'rejected') phase = 'rejected'
  else if (profile.status === 'suspended') phase = 'suspended'
  else phase = onWaitlist ? 'wait' : 'pending'

  const HERO: Record<Phase, { icon: string; tone: string; title: string; body: string }> = {
    wait:      { icon: 'hourglass_top', tone: 'wait',    title: d('waitlistTitle'),  body: d('waitlistBody') },
    pending:   { icon: 'fact_check',    tone: 'pending', title: d('pendingTitle'),   body: d('pendingBody') },
    active:    { icon: 'check_circle',  tone: 'active',  title: d('activeTitle'),    body: d('activeBody') },
    rejected:  { icon: 'cancel',        tone: 'danger',  title: d('rejectedTitle'),  body: d('rejectedBody') },
    suspended: { icon: 'block',         tone: 'danger',  title: d('suspendedTitle'), body: d('suspendedBody') },
  }
  const hero = HERO[phase]

  const passedDocs = phase === 'pending' || phase === 'active' || phase === 'rejected' || phase === 'suspended'
  const stepDocs   = phase === 'wait' ? 'current' : passedDocs ? 'done' : ''
  const stepReview = phase === 'pending' ? 'current' : phase === 'active' ? 'done' : ''
  const stepActive = phase === 'active' ? 'current' : ''

  // Documents checklist — REAL badges from the 2 tracked fields; identity + vehicle-reg have
  // no backing field/upload yet → shown "À fournir" with an inert "Ajouter" (decision: option 1).
  const sirenState: DocState = profile.verificationStatus === 'verified' ? 'ok' : profile.verificationStatus === 'review' ? 'pending' : 'todo'
  const insuranceState: DocState = profile.justificatifsStatus === 'verified' ? 'ok' : profile.justificatifsStatus === 'submitted' ? 'pending' : 'todo'

  const vehicles = asStringArray(profile.vehicleTypes)
  const zones    = asStringArray(profile.zones)
  const vehicleLabel = (v: string) => (v in VEHICLE_LABEL ? t(VEHICLE_LABEL[v] as 'vehicleVelo') : v)
  const firstName = (profile.contactName || '').trim().split(/\s+/)[0] || ''

  return (
    <section>
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{d('dashTitle')}</h1>
          <p className="op-dash__sub">{firstName ? d('greetingNamed').replace('{name}', firstName) : d('greeting')}</p>
        </div>
        {phase !== 'active' && (
          <span className="ro-badge"><span className="ms">visibility</span>{d('readOnlyBadge')}</span>
        )}
      </div>

      {/* STATUS HERO */}
      <div className="op-card stat-hero">
        <span className={`stat-hero__ic ${hero.tone}`}><span className="ms">{hero.icon}</span></span>
        <div className="stat-hero__m"><h1>{hero.title}</h1><p>{hero.body}</p></div>
      </div>

      {/* PROGRESS */}
      <div className="op-card prog">
        <div className="pstep done"><span className="pstep__d"><span className="ms">check</span></span><span className="pstep__l">{d('stepSignup')}</span></div>
        <div className="pstep__line" />
        <div className={`pstep ${stepDocs}`}><span className="pstep__d"><span className="ms">description</span></span><span className="pstep__l">{d('stepDocs')}</span></div>
        <div className="pstep__line" />
        <div className={`pstep ${stepReview}`}><span className="pstep__d"><span className="ms">fact_check</span></span><span className="pstep__l">{d('stepReview')}</span></div>
        <div className="pstep__line" />
        <div className={`pstep ${stepActive}`}><span className="pstep__d"><span className="ms">two_wheeler</span></span><span className="pstep__l">{d('stepActive')}</span></div>
      </div>

      <div className="cols">
        {/* LEFT: documents + declaration + GPS */}
        <div>
          <div className="op-card card-pad">
            <div className="card-pad__hd"><h3>{d('docsTitle')}</h3></div>
            <div className="hint">{d('docsHint')}</div>
            <DocRow icon="badge"          name={d('docIdentity')}   sub={d('docIdentitySub')}   state="todo" d={d} />
            <DocRow icon="receipt_long"   name={d('docSiren')}      sub={d('docSirenSub')}      state={sirenState} d={d} />
            <DocRow icon="two_wheeler"    name={d('docInsurance')}  sub={d('docInsuranceSub')}  state={insuranceState} d={d} />
            <DocRow icon="local_shipping" name={d('docVehicleReg')} sub={d('docVehicleRegSub')} state="todo" d={d} />

            {/* REAL declaration (assurance + RC Pro) — submitting marks it 'submitted', never
                activates the account. Re-skinned to --op-. */}
            <div className="decl"><CourierJustificatifs /></div>
          </div>

          {/* GPS placeholder — inert, no real map/position/trace (decision 5). */}
          <div className="op-card card-pad" style={{ marginTop: 16 }}>
            <div className="card-pad__hd"><h3>{d('gpsTitle')}</h3><span className="ro-badge"><span className="ms">gps_off</span>{d('gpsPreview')}</span></div>
            <div className="hint">{d('gpsHint')}</div>
            <div className="gps">
              <div className="gps__c">
                <span className="ms">map</span>
                <b>{d('gpsCardTitle')}</b>
                <span>{d('gpsCardBody')}</span>
                <span className="gps__soon">{d('gpsSoon')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: pay (inert) + missions + profile summary */}
        <div>
          <div className="pay-soon">
            <span className="ms">payments</span>
            <div className="m">
              <b>{d('payTitle')} <span className="tag">{d('paySoonTag')}</span></b>
              <p>{d('payBody')}</p>
            </div>
          </div>

          <div className="op-card card-pad">
            <div className="card-pad__hd">
              <h3>{d('missionsCardTitle')}</h3>
              {phase === 'active' && <span className="ro-badge"><span className="ms">bolt</span>{d('missionsActiveBadge')}</span>}
            </div>
            <div className="hint">
              {phase === 'active' ? d('missionsActiveHint') : phase === 'pending' ? d('missionsPendingHint') : d('missionsWaitHint')}
            </div>
            {phase === 'active' ? (
              <Link href="/logistics/dashboard/missions" className="op-btn-primary" style={{ width: '100%' }}>
                <span className="ms">assignment</span>{d('missionsSeeCta')}
              </Link>
            ) : (
              <div className="mp-empty">
                <span className="ms">assignment_late</span>
                <b>{d('missionsEmptyTitle')}</b>
                <span>{phase === 'pending' ? d('missionsEmptyPending') : d('missionsEmptyWait')}</span>
              </div>
            )}
          </div>

          <div className="op-card card-pad" style={{ marginTop: 16 }}>
            <div className="card-pad__hd"><h3>{d('profileSummaryTitle')}</h3><span className="ro-badge"><span className="ms">lock</span>{d('summaryBadge')}</span></div>
            <div className="hint">{d('summaryHint')}</div>
            <div className="psum">
              <div className="psum-row"><span className="k"><span className="ms">person</span>{d('labelName')}</span><span className="v">{profile.contactName || profile.officialName || '—'}</span></div>
              <div className="psum-row"><span className="k"><span className="ms">two_wheeler</span>{d('labelVehicle')}</span><span className="v">{vehicles.length ? vehicles.map(vehicleLabel).join(' · ') : d('emptyValue')}</span></div>
              <div className="psum-row"><span className="k"><span className="ms">place</span>{d('labelZones')}</span><span className="v">{zones.length ? zones.join(' · ') : d('emptyValue')}</span></div>
              <div className="psum-row"><span className="k"><span className="ms">badge</span>{d('labelStatus')}</span><span className="v">{t(profile.partnerType === 'company' ? 'partnerTypeCompany' : 'partnerTypeIndependent')}</span></div>
            </div>
            <div className="psum-foot">
              <Link href="/logistics/dashboard/profil" className="op-btn-ghost" style={{ width: '100%' }}>
                <span className="ms">edit</span>{d('editProfileCta')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function DocRow({ icon, name, sub, state, d }: { icon: string; name: string; sub: string; state: DocState; d: (k: string) => string }) {
  return (
    <div className="doc-row">
      <span className="doc-ic"><span className="ms">{icon}</span></span>
      <div className="doc-m"><b>{name}</b><span>{sub}</span></div>
      {state === 'ok' ? (
        <span className="doc-badge ok"><span className="ms">check</span>{d('docReceived')}</span>
      ) : state === 'pending' ? (
        <span className="doc-badge pending"><span className="ms">schedule</span>{d('docChecking')}</span>
      ) : (
        <>
          <span className="doc-badge todo">{d('docTodo')}</span>
          <button type="button" className="doc-up" disabled title={d('docSoon')}><span className="ms">upload</span>{d('docAdd')}</button>
        </>
      )}
    </div>
  )
}
