import { Link } from '@/navigation'
import { WF_CART, eur } from '../mock'

// WIREFRAME 7/7 — SUIVI. Reached from the checkout mock ("Confirmer" → here). Shows the
// "commande passée" confirmation + a status timeline (reçue → préparation → prête → en
// route → livrée) + ETA + a MOCK courier card. Reassurance. Server, static mock, no money.
export const dynamic = 'force-dynamic'

const STEPS = ['Commande reçue', 'En préparation', 'Prête', 'En route', 'Livrée'] as const
const CURRENT = 1 // mock: "en préparation"

export default function EatNextTrack() {
  const r = WF_CART.restaurant
  const total = WF_CART.lines.reduce((s, l) => s + l.priceEur * l.qty, 0) + r.deliveryFeeEur

  return (
    <div className="space-y-5 p-4">
      <div className="rounded-xl border border-neutral-300 bg-neutral-50 p-4 text-center">
        <p className="text-2xl" aria-hidden>✅</p>
        <p className="font-bold text-neutral-900">Commande passée&nbsp;!</p>
        <p className="text-sm text-neutral-600">{r.name} · {eur(total)} · arrivée estimée dans {r.etaMin} min</p>
        <p className="mt-1 text-xs text-neutral-400">Référence GRB-WF-0000 (maquette)</p>
      </div>

      <ol className="space-y-3">
        {STEPS.map((s, i) => {
          const done = i < CURRENT
          const active = i === CURRENT
          return (
            <li key={s} className="flex items-center gap-3">
              <span className={`grid h-7 w-7 place-items-center rounded-full text-xs ${done ? 'bg-neutral-800 text-white' : active ? 'border-2 border-neutral-800 text-neutral-800' : 'border border-neutral-300 text-neutral-400'}`}>
                {done ? '✓' : i + 1}
              </span>
              <span className={active ? 'font-semibold text-neutral-900' : done ? 'text-neutral-700' : 'text-neutral-400'}>{s}</span>
            </li>
          )
        })}
      </ol>

      {/* Mock courier reassurance card. */}
      <div className="flex items-center gap-3 rounded-xl border border-neutral-300 bg-white p-3">
        <div className="h-12 w-12 rounded-full bg-neutral-200" aria-hidden />
        <div className="flex-1">
          <p className="text-sm font-semibold text-neutral-900">Votre livreur (maquette)</p>
          <p className="text-xs text-neutral-500">En route vers le restaurant · vélo</p>
        </div>
        <span className="rounded-lg border border-neutral-300 px-3 py-1 text-sm text-neutral-700">Appeler</span>
      </div>

      <div className="h-40 w-full rounded-xl bg-neutral-200" aria-hidden />

      <Link href="/eat-next" className="block rounded-xl border border-neutral-800 py-3 text-center font-semibold text-neutral-800">
        Retour à l’accueil
      </Link>
    </div>
  )
}
