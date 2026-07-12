import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Truck, PackageCheck, Store, ArrowRight, LogIn } from 'lucide-react'
import { Link } from '@/navigation'
import { Card } from '@/components/design-system'

// ── /supplier — public B2B supplier landing (Slice 0, Agent 14) ───────────────
// Recruitment / self-serve entry for the supply marketplace's OFFER side. Public
// (middleware): a register CTA + a magic-link login prompt. No catalogue here.
export const dynamic = 'force-dynamic'

export default async function SupplierLandingPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('supplier')

  const benefits = [
    { icon: <Store size={18} />,        text: t('landingBenefit1') },
    { icon: <Truck size={18} />,        text: t('landingBenefit2') },
    { icon: <PackageCheck size={18} />, text: t('landingBenefit3') },
  ]

  return (
    <div className="min-h-screen bg-grubano-bg">
      <header className="bg-grubano-ink text-white">
        <div className="mx-auto max-w-2xl px-5 py-12 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-grubano-xl bg-grubano-primary/20">
            <Truck size={26} className="text-grubano-primary" />
          </span>
          <h1 className="font-display text-3xl font-extrabold leading-tight">{t('landingTitle')}</h1>
          <p className="mx-auto mt-2 max-w-md text-white/70">{t('landingSubtitle')}</p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-8 space-y-6">
        <ul className="space-y-3">
          {benefits.map((b, i) => (
            <li key={i}>
              <Card elevation="sm" padding="md">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-grubano-lg bg-grubano-tint text-grubano-primary">
                    {b.icon}
                  </span>
                  <span className="text-sm font-medium text-grubano-ink">{b.text}</span>
                </div>
              </Card>
            </li>
          ))}
        </ul>

        <Link
          href="/supplier/register"
          className="flex w-full items-center justify-center gap-2 rounded-grubano-lg bg-grubano-primary px-5 py-3.5 font-semibold text-white shadow-grubano-sm transition-transform active:scale-[0.99]"
        >
          {t('registerCta')} <ArrowRight size={18} />
        </Link>

        <p className="text-center text-sm text-grubano-ink-muted">
          {t('loginPrompt')}{' '}
          <Link href="/auth/magic" className="inline-flex items-center gap-1 font-semibold text-grubano-primary">
            <LogIn size={14} /> {t('loginCta')}
          </Link>
        </p>
      </main>
    </div>
  )
}
