import { Star, MessageSquare, Clock } from 'lucide-react'
import { Card } from '@/components/grubano/Card'

const reviews = [
  { p: 'UberEats',  n: 'Sarah K.',  r: 5, t: 'Best gnocchi in Paris!',       h: '1h',  answered: false              },
  { p: 'Deliveroo', n: 'Anonyme',   r: 1, t: 'Froid à la livraison, sans sauce.', h: '2h', answered: false, urgent: true },
  { p: 'Just Eat',  n: 'Tom B.',    r: 4, t: 'Bon mais un peu long.',         h: '5h',  answered: true               },
]

export default function ReviewsPage() {
  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Avis</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Toutes plateformes · Réponses IA
        <span className="ml-2 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success">92% de réponses</span>
      </p>

      <div className="mb-4 flex gap-2">
        {['Tous', '1★ seulement', 'Sans réponse'].map((f, i) => (
          <button key={f} className={`flex-1 rounded-xl py-2 text-[11px] font-semibold ${
            i === 0 ? 'bg-navy text-navy-foreground' : 'border border-border bg-card text-muted-foreground'
          }`}>
            {f}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {reviews.map((r) => (
          <Card key={r.t} className={r.urgent ? '!border-destructive/40' : ''}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase text-muted-foreground">{r.p}</span>
                <span className="text-xs font-semibold">{r.n}</span>
              </div>
              <span className="inline-flex items-center gap-0.5 text-xs font-bold">
                {Array.from({ length: r.r }).map((_, i) => (
                  <Star key={i} size={11} className="fill-warning text-warning" />
                ))}
              </span>
            </div>
            <p className="mt-2 text-sm">{r.t}</p>

            {!r.answered && (
              <>
                <div className="mt-3 rounded-lg bg-accent p-2.5">
                  <p className="text-[10px] font-bold uppercase text-primary">Brouillon IA</p>
                  <p className="mt-1 text-[12px] italic">
                    {r.r === 1
                      ? 'Désolé pour cette expérience — nous aimerions y remédier. Répondez pour réclamer un plat offert.'
                      : 'Merci beaucoup, à très bientôt !'}
                  </p>
                </div>
                <div className="mt-2 flex gap-2">
                  <button className="flex-1 rounded-lg bg-primary py-2 text-[11px] font-semibold text-primary-foreground">
                    Envoyer la réponse
                  </button>
                  <button className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] font-semibold">
                    Modifier
                  </button>
                </div>
              </>
            )}

            {r.urgent && (
              <p className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-destructive">
                <Clock size={10} /> Répondre dans les 2h
              </p>
            )}
            {r.answered && (
              <p className="mt-2 inline-flex items-center gap-1 text-[10px] text-success">
                <MessageSquare size={10} /> Répondu
              </p>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
